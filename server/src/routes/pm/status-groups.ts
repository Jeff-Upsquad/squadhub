import { Router, Request, Response } from 'express';
import { requireAuth } from '../../middleware/auth';
import { supabaseAdmin } from '../../supabase';
import { resolveEffectiveGroup, getGroupStatuses, getGroupByKey } from '../../utils/statusGroups';

const router = Router();

router.use(requireAuth);

// GET /pm/status-groups/effective?space_id=&folder_id=&list_id=
// Resolves nearest status-group assignment (list > folder > space >
// template > default) and returns its statuses for board rendering.
router.get('/status-groups/effective', async (req: Request, res: Response) => {
  try {
    const spaceId = (req.query.space_id as string) || undefined;
    const folderId = (req.query.folder_id as string) || undefined;
    const listId = (req.query.list_id as string) || undefined;

    if (!spaceId && !folderId && !listId) {
      res.status(400).json({ success: false, error: 'space_id, folder_id or list_id is required' });
      return;
    }

    const resolved = await resolveEffectiveGroup({
      spaceId,
      folderId: folderId || null,
      listId: listId || null,
    });
    if (!resolved) {
      res.json({ success: true, data: { group: null, statuses: [] } });
      return;
    }
    res.json({
      success: true,
      data: {
        group: resolved.assignment?.status_groups || null,
        assignment: {
          group_id: resolved.assignment?.group_id,
          entity_type: resolved.assignment?.entity_type || null,
          entity_id: resolved.assignment?.entity_id || null,
          is_default_fallback: !!resolved.assignment?.is_default_fallback,
        },
        statuses: resolved.statuses,
      },
    });
  } catch (err) {
    console.error('Effective status group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/status-groups/by-key/:key — one enabled group + statuses.
// Powers the generic-task picker (key 'task_workflow'), which renders the
// managed group and falls back to the static catalog when unavailable.
router.get('/status-groups/by-key/:key', async (req: Request, res: Response) => {
  try {
    const group = await getGroupByKey(req.params.key as string);
    if (!group) {
      res.status(404).json({ success: false, error: 'Status group not found' });
      return;
    }
    res.json({ success: true, data: group });
  } catch (err) {
    console.error('Status group by-key error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/status-groups — enabled groups + statuses (for pickers)
router.get('/status-groups', async (_req: Request, res: Response) => {
  try {
    const { data: groups, error } = await supabaseAdmin
      .from('status_groups')
      .select('*')
      .eq('is_enabled', true)
      .order('position', { ascending: true });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    const out: any[] = [];
    for (const g of groups || []) {
      out.push({ ...g, statuses: await getGroupStatuses(g.id) });
    }
    res.json({ success: true, data: out });
  } catch (err) {
    console.error('List PM status groups error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
