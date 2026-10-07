import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import {
  getGroupTaskTypes,
  upsertAssignment,
} from '../utils/taskTypeGroups';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

const slugRegex = /^[a-z][a-z0-9_]*$/;
const ENTITY_TYPES = ['space', 'folder', 'list', 'template'] as const;

const groupCreateSchema = z.object({
  key: z.string().min(1).max(64).regex(slugRegex, 'Key must be lowercase letters, numbers and underscores'),
  name: z.string().min(1).max(100),
  description: z.string().nullable().optional(),
  icon: z.string().max(64).optional(),
  color: z.string().max(16).optional(),
});

const groupUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().nullable().optional(),
  icon: z.string().max(64).optional(),
  color: z.string().max(16).optional(),
});

const reorderSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), position: z.number().int().min(0) })),
});

const applySchema = z.object({
  entity_type: z.enum(ENTITY_TYPES),
  entity_id: z.string().uuid(),
});

const addTypeSchema = z.object({
  task_type_id: z.string().uuid().optional(),
  // Or create new task type directly
  name: z.string().min(1).max(100).optional(),
  key: z.string().max(64).regex(slugRegex, 'Key must be lowercase letters, numbers and underscores').optional(),
  description: z.string().nullable().optional(),
  icon: z.string().max(64).optional(),
  color: z.string().max(16).optional(),
});

async function getGroup(id: string) {
  const { data } = await supabaseAdmin
    .from('task_type_groups')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return data as any;
}

function slugify(s: string): string {
  return (s || 'type').toLowerCase()
    .replace(/[^a-z0-9_\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/^[^a-z]+/, '') || 'type';
}

function zodErr(err: unknown, res: Response) {
  if (err instanceof z.ZodError) {
    res.status(400).json({ success: false, error: err.errors[0].message });
    return true;
  }
  return false;
}

// ------------------------------------------------------------
// GET /admin/task-type-groups — list with nested task types + usage counts
// ------------------------------------------------------------
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data: groups, error } = await supabaseAdmin
      .from('task_type_groups')
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const { data: items } = await supabaseAdmin
      .from('task_type_group_items')
      .select('*, task_types(*)')
      .order('position', { ascending: true });

    const { data: assignments } = await supabaseAdmin
      .from('task_type_group_assignments')
      .select('id, group_id, entity_type, entity_id');

    const itemsByGroup = new Map<string, any[]>();
    for (const it of items || []) {
      if (!it.task_types) continue;
      const list = itemsByGroup.get(it.group_id) || [];
      list.push({
        ...it.task_types,
        item_id: it.id,
        group_position: it.position,
      });
      itemsByGroup.set(it.group_id, list);
    }

    const usageByGroup = new Map<string, number>();
    for (const a of assignments || []) {
      usageByGroup.set(a.group_id, (usageByGroup.get(a.group_id) || 0) + 1);
    }

    const result = (groups || []).map((g: any) => ({
      ...g,
      task_types: itemsByGroup.get(g.id) || [],
      usage_count: usageByGroup.get(g.id) || 0,
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('List task type groups error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /admin/task-type-groups — create group
// ------------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = groupCreateSchema.parse(req.body);

    const { data: maxRow } = await supabaseAdmin
      .from('task_type_groups')
      .select('position')
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = ((maxRow as any)?.position ?? -1) + 1;

    const { data, error } = await supabaseAdmin
      .from('task_type_groups')
      .insert({
        key: body.key,
        name: body.name,
        description: body.description ?? null,
        icon: body.icon || 'check-square',
        color: body.color || '#6b7280',
        position: nextPos,
      })
      .select()
      .single();

    if (error) {
      const status = error.code === '23505' ? 409 : 500;
      res.status(status).json({ success: false, error: error.message });
      return;
    }

    res.status(201).json({ success: true, data: { ...data, task_types: [], usage_count: 0 } });
  } catch (err) {
    if (zodErr(err, res)) return;
    console.error('Create task type group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// PUT /admin/task-type-groups/reorder
// ------------------------------------------------------------
router.put('/reorder', async (req: Request, res: Response) => {
  try {
    const { items } = reorderSchema.parse(req.body);
    for (const item of items) {
      const { error } = await supabaseAdmin
        .from('task_type_groups')
        .update({ position: item.position })
        .eq('id', item.id);
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
    }
    res.json({ success: true });
  } catch (err) {
    if (zodErr(err, res)) return;
    console.error('Reorder task type groups error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// GET /admin/task-type-groups/targets/search?type=space|folder|list|template&q=...
// ------------------------------------------------------------
router.get('/targets/search', async (req: Request, res: Response) => {
  try {
    const type = (req.query.type as string) || 'space';
    const q = ((req.query.q as string) || '').trim();
    if (!ENTITY_TYPES.includes(type as any)) {
      res.status(400).json({ success: false, error: 'Invalid target type' });
      return;
    }

    let rows: any[] = [];
    if (type === 'space') {
      let query = supabaseAdmin
        .from('spaces')
        .select('id, name, kind')
        .is('deleted_at', null)
        .order('name')
        .limit(30);
      if (q) query = query.ilike('name', `%${q}%`);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      rows = (data || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        detail: s.kind && s.kind !== 'normal' ? `Area · ${s.kind}` : 'Area',
      }));
    } else if (type === 'folder') {
      let query = supabaseAdmin
        .from('folders')
        .select('id, name, space_id, client_space_template_id, spaces(name)')
        .is('deleted_at', null)
        .order('name')
        .limit(30);
      if (q) query = query.ilike('name', `%${q}%`);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      rows = (data || []).map((f: any) => ({
        id: f.id,
        name: f.name,
        detail: `Space${f.spaces?.name ? ` · ${f.spaces.name}` : ''}${f.client_space_template_id ? ' · templated' : ''}`,
      }));
    } else if (type === 'list') {
      let query = supabaseAdmin
        .from('lists')
        .select('id, name, space_id, folder_id, spaces(name)')
        .is('deleted_at', null)
        .order('name')
        .limit(30);
      if (q) query = query.ilike('name', `%${q}%`);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      rows = (data || []).map((l: any) => ({
        id: l.id,
        name: l.name,
        detail: `List${l.spaces?.name ? ` · ${l.spaces.name}` : ''}${l.folder_id ? ' · in space' : ' · top-level'}`,
      }));
    } else {
      let query = supabaseAdmin
        .from('client_space_templates')
        .select('id, slug, name, category')
        .order('name')
        .limit(30);
      if (q) query = query.ilike('name', `%${q}%`);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      rows = (data || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        detail: `Space template · ${t.slug}`,
      }));
    }

    const pairs = rows.map((r) => r.id);
    let assigned = new Map<string, string>();
    if (pairs.length) {
      const { data } = await supabaseAdmin
        .from('task_type_group_assignments')
        .select('entity_id, group_id')
        .eq('entity_type', type)
        .in('entity_id', pairs);
      for (const a of data || []) assigned.set(a.entity_id, a.group_id);
    }
    res.json({
      success: true,
      data: rows.map((r) => ({ ...r, assigned_group_id: assigned.get(r.id) || null })),
    });
  } catch (err) {
    console.error('Search task-type-group targets error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// GET /admin/task-type-groups/templates — templates + their assigned group
// ------------------------------------------------------------
router.get('/templates', async (_req: Request, res: Response) => {
  try {
    const { data: templates, error } = await supabaseAdmin
      .from('client_space_templates')
      .select('id, slug, name, category, is_enabled')
      .order('name');
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    const ids = (templates || []).map((t: any) => t.id);
    let assignMap = new Map<string, any>();
    if (ids.length) {
      const { data: assigns } = await supabaseAdmin
        .from('task_type_group_assignments')
        .select('*, task_type_groups(id, key, name, color)')
        .eq('entity_type', 'template')
        .in('entity_id', ids);
      for (const a of assigns || []) assignMap.set(a.entity_id, a);
    }
    res.json({
      success: true,
      data: (templates || []).map((t: any) => ({
        ...t,
        assignment: assignMap.get(t.id) || null,
      })),
    });
  } catch (err) {
    console.error('List task-type-group templates error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// GET /admin/task-type-groups/:id/usage — where is this group applied?
// ------------------------------------------------------------
router.get('/:id/usage', async (req: Request, res: Response) => {
  try {
    const group = await getGroup((req.params.id as string));
    if (!group) {
      res.status(404).json({ success: false, error: 'Task type group not found' });
      return;
    }
    const { data: assignments, error } = await supabaseAdmin
      .from('task_type_group_assignments')
      .select('*')
      .eq('group_id', (req.params.id as string))
      .order('created_at', { ascending: false });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const byType = new Map<string, string[]>();
    for (const a of assignments || []) {
      const list = byType.get(a.entity_type) || [];
      list.push(a.entity_id);
      byType.set(a.entity_type, list);
    }

    async function namesFor(table: string, ids: string[], label: string) {
      if (!ids.length) return new Map<string, string>();
      const sel = table === 'client_space_templates' ? 'id, name, slug' : 'id, name';
      const { data } = await supabaseAdmin.from(table as any).select(sel).in('id', ids);
      const m = new Map<string, string>();
      for (const r of ((data || []) as any[])) {
        m.set(
          r.id,
          table === 'client_space_templates'
            ? `${r.name} (${label}: ${r.slug})`
            : r.name,
        );
      }
      return m;
    }

    const [spaceNames, folderNames, listNames, tplNames] = await Promise.all([
      namesFor('spaces', byType.get('space') || [], ''),
      namesFor('folders', byType.get('folder') || [], ''),
      namesFor('lists', byType.get('list') || [], ''),
      namesFor('client_space_templates', byType.get('template') || [], 'template'),
    ]);

    const typeLabel: Record<string, string> = {
      space: 'Area',
      folder: 'Space',
      list: 'List',
      template: 'Space template (future spaces)',
    };

    const usage = (assignments || []).map((a: any) => {
      let entity_name = a.entity_id;
      if (a.entity_type === 'space') entity_name = spaceNames.get(a.entity_id) || a.entity_id;
      if (a.entity_type === 'folder') entity_name = folderNames.get(a.entity_id) || a.entity_id;
      if (a.entity_type === 'list') entity_name = listNames.get(a.entity_id) || a.entity_id;
      if (a.entity_type === 'template') entity_name = tplNames.get(a.entity_id) || a.entity_id;
      return {
        ...a,
        entity_label: typeLabel[a.entity_type] || a.entity_type,
        entity_name,
      };
    });

    res.json({ success: true, data: usage });
  } catch (err) {
    console.error('Task type group usage error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// PUT /admin/task-type-groups/:id — update meta
// ------------------------------------------------------------
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const body = groupUpdateSchema.parse(req.body);
    const group = await getGroup((req.params.id as string));
    if (!group) {
      res.status(404).json({ success: false, error: 'Task type group not found' });
      return;
    }
    const patch: Record<string, any> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.icon !== undefined) patch.icon = body.icon;
    if (body.color !== undefined) patch.color = body.color;

    const { data, error } = await supabaseAdmin
      .from('task_type_groups')
      .update(patch)
      .eq('id', (req.params.id as string))
      .select()
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    if (zodErr(err, res)) return;
    console.error('Update task type group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// PUT /admin/task-type-groups/:id/enabled — toggle is_enabled
// ------------------------------------------------------------
router.put('/:id/enabled', async (req: Request, res: Response) => {
  try {
    const { is_enabled } = z.object({ is_enabled: z.boolean() }).parse(req.body);
    const group = await getGroup((req.params.id as string));
    if (!group) {
      res.status(404).json({ success: false, error: 'Task type group not found' });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('task_type_groups')
      .update({ is_enabled })
      .eq('id', (req.params.id as string))
      .select()
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    if (zodErr(err, res)) return;
    console.error('Toggle task type group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// PUT /admin/task-type-groups/:id/default — set as default
// ------------------------------------------------------------
router.put('/:id/default', async (req: Request, res: Response) => {
  try {
    const group = await getGroup((req.params.id as string));
    if (!group) {
      res.status(404).json({ success: false, error: 'Task type group not found' });
      return;
    }
    await supabaseAdmin.from('task_type_groups').update({ is_default: false }).eq('is_default', true);
    const { data, error } = await supabaseAdmin
      .from('task_type_groups')
      .update({ is_default: true })
      .eq('id', (req.params.id as string))
      .select()
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('Set default task type group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// DELETE /admin/task-type-groups/:id
// ------------------------------------------------------------
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const group = await getGroup((req.params.id as string));
    if (!group) {
      res.status(404).json({ success: false, error: 'Task type group not found' });
      return;
    }
    if (group.is_system) {
      res.status(400).json({ success: false, error: 'System task type groups cannot be deleted' });
      return;
    }
    if (group.is_default) {
      res.status(400).json({ success: false, error: 'The default group cannot be deleted. Set another group as default first.' });
      return;
    }
    const { error } = await supabaseAdmin.from('task_type_groups').delete().eq('id', (req.params.id as string));
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete task type group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// Types inside a group
// ------------------------------------------------------------

// POST /admin/task-type-groups/:id/types — add type to group
router.post('/:id/types', async (req: Request, res: Response) => {
  try {
    const body = addTypeSchema.parse(req.body);
    const group = await getGroup((req.params.id as string));
    if (!group) {
      res.status(404).json({ success: false, error: 'Task type group not found' });
      return;
    }

    let taskTypeId = body.task_type_id;

    // If creating a brand new task type:
    if (!taskTypeId) {
      if (!body.name) {
        res.status(400).json({ success: false, error: 'Name is required to create a new task type' });
        return;
      }
      const rawSlug = slugify(body.name);
      const canonicalKey = body.key || rawSlug;

      const { data: maxTypeRow } = await supabaseAdmin
        .from('task_types')
        .select('position')
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextTypePos = ((maxTypeRow as any)?.position ?? 0) + 1;

      const { data: newType, error: createErr } = await supabaseAdmin
        .from('task_types')
        .insert({
          key: canonicalKey,
          name: body.name,
          description: body.description ?? null,
          icon: body.icon || 'check-square',
          color: body.color || '#6b7280',
          position: nextTypePos,
          is_default: false,
          is_system: false,
          is_enabled: true,
          group_name: group.name,
        })
        .select()
        .single();

      if (createErr) {
        const status = createErr.code === '23505' ? 409 : 500;
        res.status(status).json({
          success: false,
          error: createErr.code === '23505' ? 'A task type with this key already exists' : createErr.message,
        });
        return;
      }
      taskTypeId = newType.id;
    }

    // Next position in group
    const { data: maxItemRow } = await supabaseAdmin
      .from('task_type_group_items')
      .select('position')
      .eq('group_id', group.id)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextItemPos = ((maxItemRow as any)?.position ?? -1) + 1;

    const { data: item, error: itemErr } = await supabaseAdmin
      .from('task_type_group_items')
      .insert({
        group_id: group.id,
        task_type_id: taskTypeId,
        position: nextItemPos,
      })
      .select('*, task_types(*)')
      .single();

    if (itemErr) {
      const status = itemErr.code === '23505' ? 409 : 500;
      res.status(status).json({
        success: false,
        error: itemErr.code === '23505' ? 'This task type is already in the group' : itemErr.message,
      });
      return;
    }

    res.status(201).json({
      success: true,
      data: {
        ...item.task_types,
        item_id: item.id,
        group_position: item.position,
      },
    });
  } catch (err) {
    if (zodErr(err, res)) return;
    console.error('Add task type to group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/task-type-groups/:id/types/:typeId — remove from group
router.delete('/:id/types/:typeId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('task_type_group_items')
      .delete()
      .eq('group_id', (req.params.id as string))
      .eq('task_type_id', (req.params.typeId as string));

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Remove task type from group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/task-type-groups/:id/types/reorder — reorder types within group
router.put('/:id/types/reorder', async (req: Request, res: Response) => {
  try {
    const { items } = reorderSchema.parse(req.body);
    for (const item of items) {
      const { error } = await supabaseAdmin
        .from('task_type_group_items')
        .update({ position: item.position })
        .eq('task_type_id', item.id)
        .eq('group_id', (req.params.id as string));

      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
    }
    res.json({ success: true });
  } catch (err) {
    if (zodErr(err, res)) return;
    console.error('Reorder group task types error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// Apply / unapply
// ------------------------------------------------------------

// POST /admin/task-type-groups/:id/apply {entity_type, entity_id}
router.post('/:id/apply', async (req: Request, res: Response) => {
  try {
    const { entity_type, entity_id } = applySchema.parse(req.body);
    const group = await getGroup((req.params.id as string));
    if (!group) {
      res.status(404).json({ success: false, error: 'Task type group not found' });
      return;
    }

    const targetTable =
      entity_type === 'space'
        ? 'spaces'
        : entity_type === 'folder'
          ? 'folders'
          : entity_type === 'list'
            ? 'lists'
            : 'client_space_templates';

    const { data: target } = await supabaseAdmin
      .from(targetTable)
      .select('id')
      .eq('id', entity_id)
      .maybeSingle();

    if (!target) {
      res.status(404).json({ success: false, error: 'Target not found' });
      return;
    }

    const assignment = await upsertAssignment(
      (req.params.id as string),
      entity_type,
      entity_id,
      (req as any).userId,
    );
    res.status(201).json({ success: true, data: assignment });
  } catch (err) {
    if (zodErr(err, res)) return;
    console.error('Apply task type group error:', err);
    res.status(500).json({ success: false, error: (err as Error).message || 'Internal server error' });
  }
});

// DELETE /admin/task-type-groups/:id/apply {entity_type, entity_id}
router.delete('/:id/apply', async (req: Request, res: Response) => {
  try {
    const { entity_type, entity_id } = applySchema.parse(req.body || {});
    const { error } = await supabaseAdmin
      .from('task_type_group_assignments')
      .delete()
      .eq('group_id', (req.params.id as string))
      .eq('entity_type', entity_type)
      .eq('entity_id', entity_id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    if (zodErr(err, res)) return;
    console.error('Unapply task type group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
