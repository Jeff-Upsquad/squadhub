import { Router, Request, Response } from 'express';
import { requireAuth } from '../../middleware/auth';
import { supabaseAdmin } from '../../supabase';
import {
  resolveEffectiveTaskTypeGroup,
  getGroupTaskTypes,
  getGroupByKey,
} from '../../utils/taskTypeGroups';

const router = Router();

router.use(requireAuth);

// GET /pm/task-type-groups/effective?space_id=&folder_id=&list_id=
// Resolves nearest task-type-group assignment (list > folder > space >
// template > default) and returns its task types.
router.get('/task-type-groups/effective', async (req: Request, res: Response) => {
  try {
    const spaceId = (req.query.space_id as string) || undefined;
    const folderId = (req.query.folder_id as string) || undefined;
    const listId = (req.query.list_id as string) || undefined;

    if (!spaceId && !folderId && !listId) {
      res.status(400).json({ success: false, error: 'space_id, folder_id or list_id is required' });
      return;
    }

    const resolved = await resolveEffectiveTaskTypeGroup({
      spaceId,
      folderId: folderId || null,
      listId: listId || null,
    });

    if (!resolved) {
      res.json({ success: true, data: { group: null, task_types: [] } });
      return;
    }

    res.json({
      success: true,
      data: {
        group: resolved.assignment?.task_type_groups || null,
        assignment: {
          group_id: resolved.assignment?.group_id,
          entity_type: resolved.assignment?.entity_type || null,
          entity_id: resolved.assignment?.entity_id || null,
          is_default_fallback: !!resolved.assignment?.is_default_fallback,
        },
        task_types: resolved.task_types,
      },
    });
  } catch (err) {
    console.error('Effective task type group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/task-type-groups/by-key/:key — one enabled group + task types.
router.get('/task-type-groups/by-key/:key', async (req: Request, res: Response) => {
  try {
    const group = await getGroupByKey(req.params.key as string);
    if (!group) {
      res.status(404).json({ success: false, error: 'Task type group not found' });
      return;
    }
    res.json({ success: true, data: group });
  } catch (err) {
    console.error('Task type group by-key error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/task-type-groups — enabled groups + task types (for pickers)
router.get('/task-type-groups', async (_req: Request, res: Response) => {
  try {
    const { data: groups, error } = await supabaseAdmin
      .from('task_type_groups')
      .select('*')
      .eq('is_enabled', true)
      .order('position', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const out: any[] = [];
    for (const g of groups || []) {
      out.push({ ...g, task_types: await getGroupTaskTypes(g.id) });
    }

    res.json({ success: true, data: out });
  } catch (err) {
    console.error('List PM task type groups error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
