import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { PARTNER_USER_TYPES } from '@squadhub/shared';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

const PERSONAL_SPACE_NAME = 'Personal';
const PERSONAL_LIST_NAME = 'Tasks';

// GET /pm/personal — get-or-create the caller's private personal space + its
// default list. Backs the "My Tasks" view and the desktop quick-add hotkey.
//
// The space is created with kind='personal' + is_private=true and is owned by
// the caller (created_by), so checkResourceAccess() always resolves the creator
// to 'manager' (POST /pm/tasks into the list therefore succeeds). It is excluded
// from GET /pm/spaces so it never appears in the normal Spaces sidebar.
//
// We insert directly with supabaseAdmin rather than calling POST /pm/spaces|lists
// because those are gated behind can_create_spaces/can_create_lists permissions —
// the personal space is system-provisioned for every user regardless of role.
//
// Idempotent: repeat calls return the same space + list.
router.get('/personal', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;

    // Resolve workspace: explicit ?workspace_id= wins, else the user's workspace
    // (all users auto-join the single SquadHub workspace).
    let workspaceId = req.query.workspace_id as string | undefined;
    if (!workspaceId) {
      const { data: membership } = await supabaseAdmin
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', userId)
        .order('id')
        .limit(1)
        .maybeSingle();
      workspaceId = (membership as any)?.workspace_id;
    }
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'No workspace found for user' });
      return;
    }

    // 1. Find or create the personal space. IMPORTANT: the spaces table has no
    //    created_at column — order by columns that DO exist (position, then id)
    //    so the lookup is deterministic and never errors. (Ordering by a missing
    //    column made this select fail silently, so the endpoint created a brand
    //    new personal space on every call — see migration 106.)
    const findSpace = () =>
      supabaseAdmin
        .from('spaces')
        .select('*, space_statuses(*)')
        .eq('workspace_id', workspaceId)
        .eq('created_by', userId)
        .eq('kind', 'personal')
        .is('deleted_at', null)
        .order('position')
        .order('id')
        .limit(1);

    const { data: foundSpaces, error: findErr } = await findSpace();
    if (findErr) {
      console.error('Personal space lookup error:', findErr);
      res.status(500).json({ success: false, error: findErr.message });
      return;
    }
    let space: any = foundSpaces?.[0] ?? null;

    if (!space) {
      const { count } = await supabaseAdmin
        .from('spaces')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId);

      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('spaces')
        .insert({
          workspace_id: workspaceId,
          name: PERSONAL_SPACE_NAME,
          color: '#6366f1',
          icon: 'user',
          kind: 'personal',
          is_private: true,
          created_by: userId,
          position: count || 0,
        })
        .select()
        .single();

      if (insertErr || !inserted) {
        // A concurrent request may have created it first (the unique index
        // rejects the duplicate) — re-select and use the winner instead of 500.
        const { data: retry } = await findSpace();
        if (retry && retry[0]) {
          space = retry[0];
        } else {
          console.error('Personal space insert error:', insertErr);
          res.status(500).json({ success: false, error: insertErr?.message || 'Failed to create personal space' });
          return;
        }
      } else {
        await supabaseAdmin.from('resource_memberships').insert({
          resource_type: 'space',
          resource_id: inserted.id,
          user_id: userId,
          access_level: 'manager',
        });

        // Re-fetch with statuses (seeded by the on-insert trigger, not visible in
        // the insert's RETURNING clause).
        const { data: hydrated } = await supabaseAdmin
          .from('spaces')
          .select('*, space_statuses(*)')
          .eq('id', inserted.id)
          .single();
        space = hydrated ?? inserted;
      }
    }

    // 2. Find or create the default list inside the personal space (first by
    // position — the user may add more personal lists later).
    let { data: list } = await supabaseAdmin
      .from('lists')
      .select('*')
      .eq('space_id', (space as any).id)
      .is('deleted_at', null)
      .order('position')
      .limit(1)
      .maybeSingle();

    if (!list) {
      const { data: insertedList, error: listErr } = await supabaseAdmin
        .from('lists')
        .insert({
          space_id: (space as any).id,
          folder_id: null,
          name: PERSONAL_LIST_NAME,
          is_private: true,
          created_by: userId,
          position: 0,
        })
        .select()
        .single();

      if (listErr || !insertedList) {
        console.error('Personal list insert error:', listErr);
        res.status(500).json({ success: false, error: listErr?.message || 'Failed to create personal list' });
        return;
      }

      await supabaseAdmin.from('resource_memberships').insert({
        resource_type: 'list',
        resource_id: insertedList.id,
        user_id: userId,
        access_level: 'manager',
      });

      list = insertedList;
    }

    res.json({ success: true, data: { space, list } });
  } catch (err) {
    console.error('Get personal space error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
