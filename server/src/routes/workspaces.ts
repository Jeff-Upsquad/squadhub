import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';
import { getMembership, getUserWorkspaceIds } from '../middleware/workspace';
import { addWorkspaceMember, createAccount, audit } from '../utils/accounts';
import { assertSeatAvailable, SeatLimitError } from '../utils/seats';

// Workspaces are the SaaS ACCOUNTS (business / talent / shared / internal_staff).
// A user can belong to many; shared workspaces resolve through
// shared_workspace_links (see middleware/workspace.ts).

const router = Router();

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(80),
  // Self-serve creation makes business or talent accounts only; shared and
  // internal_staff workspaces are created by the Hub over the bridge.
  kind: z.enum(['business', 'talent']).optional().default('business'),
});

const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(80),
});

const ROLE_VALUES = ['admin', 'member', 'guest'] as const;

async function requireAdminOf(req: Request, res: Response, workspaceId: string): Promise<boolean> {
  const m = await getMembership(req.userId!, workspaceId);
  if (!m) {
    res.status(403).json({ success: false, error: 'You are not a member of this workspace' });
    return false;
  }
  if (m.role !== 'owner' && m.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Workspace admin access required' });
    return false;
  }
  return true;
}

// GET /workspaces — every workspace the user can reach (own accounts plus the
// shared workspaces they're in), with my_role and, for shared workspaces, the
// host account's name so the web can group them in the sidebar.
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const ids = await getUserWorkspaceIds(req.userId!);
    if (!ids.length) {
      res.json({ success: true, data: [] });
      return;
    }

    const [{ data: rows, error }, { data: memberships }] = await Promise.all([
      supabaseAdmin
        .from('workspaces')
        .select('id, name, slug, kind, status, owner_user_id, plan_id, host_workspace_id, engagement_status, created_at')
        .in('id', ids), // tenant-scope: ids come from getUserWorkspaceIds (membership-verified)
      supabaseAdmin
        .from('workspace_members')
        .select('workspace_id, role')
        .eq('user_id', req.userId!)
        .in('workspace_id', ids),
    ]);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const roleBy = new Map((memberships || []).map((m: any) => [m.workspace_id as string, m.role as string]));
    const hostIds = [...new Set((rows || []).map((w: any) => w.host_workspace_id).filter(Boolean))] as string[];
    const hostNames = new Map<string, string>();
    if (hostIds.length) {
      const { data: hosts } = await supabaseAdmin
        .from('workspaces')
        .select('id, name')
        .in('id', hostIds); // tenant-scope: host names of shared workspaces the user already reaches
      for (const h of hosts || []) hostNames.set(h.id as string, h.name as string);
    }

    const data = (rows || [])
      .map((w: any) => ({
        ...w,
        my_role: roleBy.get(w.id) || 'member',
        via_shared_link: !roleBy.has(w.id),
        host_name: w.host_workspace_id ? hostNames.get(w.host_workspace_id) ?? null : null,
      }))
      .sort((a: any, b: any) => (a.kind === 'shared' ? 1 : 0) - (b.kind === 'shared' ? 1 : 0) || a.created_at.localeCompare(b.created_at));

    res.json({ success: true, data });
  } catch (err) {
    console.error('Get workspaces error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /workspaces — create an account; the creator becomes its owner.
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = createWorkspaceSchema.parse(req.body);
    const { id } = await createAccount({ kind: body.kind, name: body.name, ownerUserId: req.userId! });
    const { data } = await supabaseAdmin.from('workspaces').select('*').eq('id', id).single();
    res.status(201).json({ success: true, data: { ...data, my_role: 'owner' } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create workspace error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /workspaces/:id — rename (owner/admin of that workspace).
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!(await requireAdminOf(req, res, id))) return;
    const body = updateWorkspaceSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('workspaces')
      .update({ name: body.name })
      .eq('id', id)
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
    console.error('Update workspace error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /workspaces/:id/members — any member of the workspace.
router.get('/:id/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const wsId = req.params.id as string;
    if (!(await getMembership(req.userId!, wsId))) {
      res.status(403).json({ success: false, error: 'You are not a member of this workspace' });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('workspace_members')
      .select('*, users(id, email, display_name, avatar_url, created_at, user_type, status)')
      .eq('workspace_id', wsId)
      .order('id');

    if (error) {
      console.error('[workspaces] members select error:', error);
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const members = (data || []).map((m: any) => ({
      ...m,
      user: m.users,
      users: undefined,
    }));

    res.json({ success: true, data: members });
  } catch (err) {
    console.error('Get members error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /workspaces/:id/members — add an existing user by email, or raise an
// invitation that is applied when they sign up (owner/admin only).
router.post('/:id/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const wsId = req.params.id as string;
    if (!(await requireAdminOf(req, res, wsId))) return;
    const email = String(req.body?.email || '').trim().toLowerCase();
    const role = (ROLE_VALUES as readonly string[]).includes(req.body?.role) ? req.body.role : 'member';

    if (!email) {
      res.status(400).json({ success: false, error: 'Email is required' });
      return;
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id')
      .ilike('email', email)
      .maybeSingle();

    // Plan seat limit (admins/members; guests and Upsquad staff are free).
    const { data: already } = user
      ? await supabaseAdmin
          .from('workspace_members')
          .select('id')
          .eq('workspace_id', wsId)
          .eq('user_id', user.id)
          .maybeSingle()
      : { data: null };
    if (!already) {
      try {
        await assertSeatAvailable(wsId, role);
      } catch (e) {
        if (e instanceof SeatLimitError) {
          const { data: samePending } = user
            ? { data: null }
            : await supabaseAdmin
                .from('invitations')
                .select('id, role')
                .eq('workspace_id', wsId)
                .ilike('email', email)
                .eq('status', 'pending')
                .maybeSingle();
          // Re-sending an existing admin/member invitation doesn't take a new seat.
          if (!samePending || ((samePending as any).role !== 'admin' && (samePending as any).role !== 'member')) {
            res.status(403).json({ success: false, code: e.code, error: e.message, seats_used: e.used, seat_limit: e.limit });
            return;
          }
        } else throw e;
      }
    }

    if (!user) {
      const { data: pending } = await supabaseAdmin
        .from('invitations')
        .select('id')
        .eq('workspace_id', wsId)
        .ilike('email', email)
        .eq('status', 'pending')
        .maybeSingle();
      const { data: invitation, error } = pending
        ? await supabaseAdmin
            .from('invitations')
            .update({ role, invited_by: req.userId!, expires_at: new Date(Date.now() + 30 * 864e5).toISOString() })
            .eq('id', pending.id)
            .eq('workspace_id', wsId)
            .select()
            .single()
        : await supabaseAdmin
            .from('invitations')
            .insert({ workspace_id: wsId, email, role, invited_by: req.userId!, status: 'pending' })
            .select()
            .single();
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
      res.status(201).json({ success: true, data: { invitation } });
      return;
    }

    await addWorkspaceMember(wsId, user.id as string, role);
    await audit('member.added', { workspaceId: wsId, actorUserId: req.userId!, details: { user_id: user.id, role } });
    const { data } = await supabaseAdmin
      .from('workspace_members')
      .select('*, users(id, email, display_name, avatar_url, created_at, user_type, status)')
      .eq('workspace_id', wsId)
      .eq('user_id', user.id)
      .single();

    res.status(201).json({
      success: true,
      data: { ...data, user: (data as any)?.users, users: undefined },
    });
  } catch (err) {
    console.error('Add member error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /workspaces/:id/members/:userId — change a member's role (owner/admin).
router.put('/:id/members/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const wsId = req.params.id as string;
    const userId = req.params.userId as string;
    if (!(await requireAdminOf(req, res, wsId))) return;
    const { role } = req.body;

    if (!role || !(ROLE_VALUES as readonly string[]).includes(role)) {
      res.status(400).json({ success: false, error: 'Invalid role' });
      return;
    }

    const { data: target } = await supabaseAdmin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', wsId)
      .eq('user_id', userId)
      .maybeSingle();
    if (target?.role === 'owner') {
      res.status(400).json({ success: false, error: 'Ownership is transferred by Squad Hub support' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('workspace_members')
      .update({ role })
      .eq('workspace_id', wsId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Update member error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /workspaces/:id/members/:userId — remove a member (owner/admin, or
// yourself to leave). The owner can't be removed here.
router.delete('/:id/members/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const wsId = req.params.id as string;
    const userId = req.params.userId as string;
    if (userId !== req.userId && !(await requireAdminOf(req, res, wsId))) return;

    const { data: target } = await supabaseAdmin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', wsId)
      .eq('user_id', userId)
      .maybeSingle();
    if (target?.role === 'owner') {
      res.status(400).json({ success: false, error: 'The owner cannot be removed' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('workspace_members')
      .delete()
      .eq('workspace_id', wsId)
      .eq('user_id', userId);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    await audit('member.removed', { workspaceId: wsId, actorUserId: req.userId!, details: { user_id: userId } });
    res.json({ success: true, message: 'Member removed' });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
