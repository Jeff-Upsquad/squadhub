import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { PARTNER_USER_TYPES } from '@squadhub/shared';
import {
  getOrCreatePersonalSpaceId,
  getOrCreatePersonalDefaultListId,
} from '../../services/taskMirror';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

// GET /pm/personal — get-or-create the caller's private personal space + its
// default list. Backs the "My Tasks" view and the desktop quick-add hotkey.
//
// The space is created with kind='personal' + is_private=true and is owned by
// the caller (created_by), so checkResourceAccess() always resolves the creator
// to 'manager' (POST /pm/tasks into the list therefore succeeds). It is excluded
// from GET /pm/spaces so it never appears in the normal Spaces sidebar.
//
// The get-or-create logic lives in services/taskMirror so the mirror sync and
// this endpoint converge on the SAME space + list (a second copy of it once
// caused duplicate personal spaces — see migration 106). Idempotent.
router.get('/personal', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.query.workspace_id as string | undefined;

    const spaceId = await getOrCreatePersonalSpaceId(userId, workspaceId);
    if (!spaceId) {
      res.status(400).json({ success: false, error: 'No workspace found for user' });
      return;
    }

    const listId = await getOrCreatePersonalDefaultListId(spaceId, userId);
    if (!listId) {
      res.status(500).json({ success: false, error: 'Failed to create personal list' });
      return;
    }

    // Hydrate the space with its statuses (seeded by the on-insert trigger) and
    // the default list for the client.
    const [{ data: space }, { data: list }] = await Promise.all([
      supabaseAdmin.from('spaces').select('*, space_statuses(*)').eq('id', spaceId).single(),
      supabaseAdmin.from('lists').select('*').eq('id', listId).single(),
    ]);

    res.json({ success: true, data: { space, list } });
  } catch (err) {
    console.error('Get personal space error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
