import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';
import { isUserWorkLocked, resolveWorkAccess } from '../utils/workAccess';
import { getUserSkills } from '../utils/skills';
import { checkResourceAccess } from '../middleware/permissions';
import { getMembership, getUserWorkspaceIds } from '../middleware/workspace';
import { isDmParticipant } from '../utils/dmAccess';

const router = Router();

const updateProfileSchema = z.object({
  display_name: z.string().min(1).max(50).optional(),
  avatar_url: z.string().url().nullable().optional(),
});

// GET /users/search?q=&limit=10 — autocomplete users by display_name (mention picker)
router.get('/search', requireAuth, async (req: Request, res: Response) => {
  try {
    const q = ((req.query.q as string) || '').trim();
    const limit = Math.min(parseInt((req.query.limit as string) || '10', 10), 25);
    const channelId = (req.query.channel_id as string) || '';
    const dmConversationId = (req.query.dm_conversation_id as string) || '';
    const workspaceId = (req.query.workspace_id as string) || '';

    // Tenancy: the picker only ever returns people the caller shares a
    // workspace with. Channel → its members (+creator) after an access check;
    // DM → its participants (caller must be one); otherwise the members of the
    // requested/active workspace, or of all the caller's workspaces.
    let allowedIds: string[] | null = null;
    if (channelId) {
      const level = await checkResourceAccess(req.userId!, 'channel', channelId);
      if (!level) {
        res.status(403).json({ success: false, error: 'No access to this channel' });
        return;
      }
      const { data: ch } = await supabaseAdmin
        .from('channels')
        .select('created_by, workspace_id, is_private')
        .eq('id', channelId)
        .single();
      if ((ch as any)?.is_private === false) {
        const { data: wm } = await supabaseAdmin
          .from('workspace_members')
          .select('user_id')
          .eq('workspace_id', (ch as any).workspace_id);
        allowedIds = (wm || []).map((m: any) => m.user_id as string);
      } else {
        const { data: members } = await supabaseAdmin
          .from('resource_memberships')
          .select('user_id')
          .eq('resource_type', 'channel')
          .eq('resource_id', channelId); // tenant-scope: channel access checked above
        const ids = new Set<string>((members || []).map((m: any) => m.user_id));
        if ((ch as any)?.created_by) ids.add((ch as any).created_by);
        allowedIds = [...ids];
      }
    } else if (dmConversationId) {
      if (!(await isDmParticipant(req.userId!, dmConversationId))) {
        res.status(403).json({ success: false, error: 'No access to this conversation' });
        return;
      }
      const { data: parts } = await supabaseAdmin
        .from('dm_participants')
        .select('user_id')
        .eq('conversation_id', dmConversationId);
      allowedIds = [...new Set<string>((parts || []).map((p: any) => p.user_id))];
    } else {
      let wsIds: string[];
      if (workspaceId) {
        if (!(await getMembership(req.userId!, workspaceId))) {
          res.status(403).json({ success: false, error: 'You are not a member of this workspace' });
          return;
        }
        wsIds = [workspaceId];
      } else if (req.workspaceId) {
        wsIds = [req.workspaceId];
      } else {
        wsIds = await getUserWorkspaceIds(req.userId!);
      }
      const ids = new Set<string>();
      if (wsIds.length) {
        const { data: wm } = await supabaseAdmin
          .from('workspace_members')
          .select('user_id')
          .in('workspace_id', wsIds);
        for (const m of wm || []) ids.add(m.user_id as string);
      }
      allowedIds = [...ids];
    }

    if (allowedIds !== null && allowedIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    // Every other work surface is membership-scoped, so a pre-work partner sees
    // nothing in it. This one isn't: unscoped, it answers with the whole roster.
    // Keep it closed until they have work (see utils/workAccess).
    if (await isUserWorkLocked(req.userId!)) {
      res.json({ success: true, data: [] });
      return;
    }

    let query = supabaseAdmin
      .from('users')
      .select('id, display_name, avatar_url, user_type, email')
      .eq('status', 'active')
      .neq('id', req.userId!)
      .order('display_name', { ascending: true })
      .limit(limit);

    if (allowedIds !== null) {
      query = query.in('id', allowedIds);
    }

    if (q.length > 0) {
      query = query.ilike('display_name', `%${q}%`);
    }

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Attach each user's workspace role (name + color). Done as a separate
    // lookup so the user query above keeps its limit/ordering/scope intact
    // (a join could fan out rows for members with multiple memberships).
    const users = data || [];
    if (users.length > 0) {
      const ids = users.map((u: any) => u.id);
      const roleWs = workspaceId || req.workspaceId;
      let memberQuery = supabaseAdmin
        .from('workspace_members') // tenant-scope: ids already restricted to members of the caller's workspaces; role lookup narrowed when a workspace is named
        .select('user_id, role:role_id(name, color)')
        .in('user_id', ids);
      if (roleWs) memberQuery = memberQuery.eq('workspace_id', roleWs);
      const { data: members } = await memberQuery;
      const roleByUser = new Map<string, { name: string; color: string | null } | null>();
      for (const m of (members || []) as any[]) {
        // Keep the first role we see per user (primary membership).
        if (!roleByUser.has(m.user_id)) roleByUser.set(m.user_id, m.role || null);
      }
      for (const u of users as any[]) {
        u.role = roleByUser.get(u.id) || null;
      }
    }

    res.json({ success: true, data: users });
  } catch (err) {
    console.error('User search error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /users/me — get current user's profile
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', req.userId!)
      .single();

    if (error || !data) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // work_locked tells the apps whether to show the Work surface or the
    // Discover-only lock (see utils/workAccess).
    res.json({ success: true, data: await resolveWorkAccess(data) });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /users/me/skills — the caller's effective level of every skill (admin
// "Skills" module), e.g. { edit_logged_time: 'reduce' }. Drives which edit
// affordances the web shows; the server re-checks on every mutation.
router.get('/me/skills', requireAuth, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await getUserSkills(req.userId!) });
  } catch (err) {
    console.error('Get my skills error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /users/me — update current user's profile
router.put('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = updateProfileSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(body)
      .eq('id', req.userId!)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Hub-owned per-user data (client links, client subscription/job cards) used to
// live here. In the SaaS it is served by Squad Hub over the bridge.
// TODO(bridge): see docs/bridge-contract.md (GET /bridge/v1/business/:hubClientId/cards).

export default router;
