import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import {
  getGroupStatuses,
  getGroupSections,
  syncSpaceToGroup,
  syncAllSpacesForGroup,
  upsertAssignment,
  spaceHasSeedStatuses,
  loadTaskStatusOverrides,
} from '../utils/statusGroups';
import { isSystemStatus, isSystemStatusKey, SYSTEM_STATUS_PRESETS } from '@squadhub/shared';

// Fire-and-forget refresh of the shared Task Workflow override registry
// (same-process admin edits take effect immediately; never throws).
function refreshTaskOverrides() {
  loadTaskStatusOverrides();
}

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

const slugRegex = /^[a-z][a-z0-9_]*$/;
const CATEGORIES = ['todo', 'active', 'done', 'closed'] as const;
const ENTITY_TYPES = ['space', 'folder', 'list', 'template'] as const;

const sectionSchema = z.object({
  key: z.string().min(1).max(64).regex(slugRegex),
  label: z.string().trim().min(1).max(100),
  emoji: z.string().max(16),
});
const groupCreateSchema = z.object({
  key: z.string().min(1).max(64).regex(slugRegex, 'Key must be lowercase letters, numbers and underscores'),
  name: z.string().min(1).max(100),
  description: z.string().nullable().optional(),
  icon: z.string().max(64).optional(),
  color: z.string().max(16).optional(),
  base_group_id: z.string().uuid().nullable().optional(),
  custom_sections: z.array(sectionSchema).max(50).optional(),
});

const groupUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().nullable().optional(),
  icon: z.string().max(64).optional(),
  color: z.string().max(16).optional(),
  base_group_id: z.string().uuid().nullable().optional(),
  custom_sections: z.array(sectionSchema).max(50).optional(),
});

const statusCreateSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().max(16).optional(),
  category: z.enum(CATEGORIES).optional(),
  is_default: z.boolean().optional(),
  // Task Workflow extras: key is the stable identifier stored on tasks
  // (auto-slugified from name when omitted, immutable afterwards).
  key: z.string().max(64).regex(slugRegex, 'Key must be lowercase letters, numbers and underscores').optional(),
  description: z.string().max(500).nullable().optional(),
  section: z.string().max(64).optional(),
  section_label: z.string().max(100).nullable().optional(),
  section_emoji: z.string().max(16).nullable().optional(),
});

const statusUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().max(16).optional(),
  category: z.enum(CATEGORIES).optional(),
  is_default: z.boolean().optional(),
  description: z.string().max(500).nullable().optional(),
  section: z.string().max(64).optional(),
  section_label: z.string().max(100).nullable().optional(),
  section_emoji: z.string().max(16).nullable().optional(),
});

const reorderSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), position: z.number().int().min(0) })),
});

const applySchema = z.object({
  entity_type: z.enum(ENTITY_TYPES),
  entity_id: z.string().uuid(),
  // Replace flow: when the entity already has a different group, the caller
  // must pass allow_replace:true plus a status_mapping of
  // { <old task status string>: <new status id in the incoming group> }.
  allow_replace: z.boolean().optional(),
  status_mapping: z.record(z.string(), z.string().uuid()).optional(),
});

/** Resolve the list ids that own tasks for a given assignment target. */
async function getListIdsForEntity(entityType: string, entityId: string): Promise<string[]> {
  if (entityType === 'list') return [entityId];
  if (entityType === 'template') return [];
  if (entityType === 'folder') {
    const { data, error } = await supabaseAdmin
      .from('lists')
      .select('id')
      .eq('folder_id', entityId)
      .limit(2000);
    if (error) throw new Error(error.message);
    return (data || []).map((l: any) => l.id);
  }
  // space (= area): every list directly under the area. Folder-scoped
  // lists carry the same space_id, so one query covers them.
  const { data, error } = await supabaseAdmin
    .from('lists')
    .select('id')
    .eq('space_id', entityId)
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data || []).map((l: any) => l.id);
}

/** Count tasks in scope grouped by their exact status string. */
async function getTaskStatusBreakdown(listIds: string[]): Promise<{ status: string; count: number }[]> {
  if (!listIds.length) return [];
  const { data, error } = await supabaseAdmin
    .from('tasks')
    .select('status')
    .in('list_id', listIds)
    .limit(5000);
  if (error) throw new Error(error.message);
  const counts = new Map<string, number>();
  for (const t of (data || []) as any[]) {
    const key = (t.status ?? '').toString() || '(empty)';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
}

async function getEntityName(entityType: string, entityId: string): Promise<string> {
  const table = entityType === 'space' ? 'spaces'
    : entityType === 'folder' ? 'folders'
    : entityType === 'list' ? 'lists' : 'client_space_templates';
  const { data } = await supabaseAdmin.from(table).select('id, name').eq('id', entityId).maybeSingle();
  return (data as any)?.name || entityId;
}

async function getGroup(id: string) {
  const { data } = await supabaseAdmin
    .from('status_groups')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return data as any;
}

function slugify(s: string): string {
  return (s || 'status').toLowerCase()
    .replace(/[^a-z0-9_\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/^[^a-z]+/, '') || 'status';
}

function zodErr(err: unknown, res: Response) {
  if (err instanceof z.ZodError) {
    res.status(400).json({ success: false, error: err.errors[0].message });
    return true;
  }
  return false;
}

// ------------------------------------------------------------
// GET /admin/status-groups — list with nested statuses + usage counts
// ------------------------------------------------------------
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data: groups, error } = await supabaseAdmin
      .from('status_groups')
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) {
      res.status(error.code === 'P0001' ? 400 : 500).json({ success: false, error: error.message });
      return;
    }

    const { data: assignments, error: assignmentError } = await supabaseAdmin
      .from('status_group_assignments').select('id, group_id, entity_type, entity_id');
    if (assignmentError) throw new Error(assignmentError.message);

    const usageByGroup = new Map<string, number>();
    for (const a of assignments || []) {
      usageByGroup.set(a.group_id, (usageByGroup.get(a.group_id) || 0) + 1);
    }

    const result = await Promise.all((groups || []).map(async (g: any) => ({
      ...g,
      statuses: await getGroupStatuses(g.id),
      effective_sections: await getGroupSections(g),
      usage_count: usageByGroup.get(g.id) || 0,
    })));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('List status groups error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /admin/status-groups — create group
// ------------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = groupCreateSchema.parse(req.body);

    if (body.base_group_id) {
      const base = await getGroup(body.base_group_id);
      if (!base || base.key !== 'task_workflow') {
        res.status(400).json({ success: false, error: 'Primary group must be Default Task Statuses' });
        return;
      }
    }
    const { data: maxRow } = await supabaseAdmin
      .from('status_groups')
      .select('position')
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = ((maxRow as any)?.position ?? -1) + 1;

    const { data, error } = await supabaseAdmin
      .from('status_groups')
      .insert({
        key: body.key,
        name: body.name,
        description: body.description ?? '',
        icon: body.icon || 'flag',
        color: body.color || '#6b7280',
        position: nextPos,
        base_group_id: body.base_group_id || null,
        custom_sections: body.custom_sections || [],
      })
      .select()
      .single();

    if (error) {
      const status = error.code === '23505' ? 409 : error.code === 'P0001' ? 400 : 500;
      res.status(status).json({ success: false, error: error.message });
      return;
    }

    res.status(201).json({ success: true, data: { ...data, statuses: await getGroupStatuses(data.id), usage_count: 0 } });
  } catch (err) {
    if (zodErr(err, res)) return;
    console.error('Create status group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// Static routes (before :id)
// ------------------------------------------------------------

// PUT /admin/status-groups/reorder
router.put('/reorder', async (req: Request, res: Response) => {
  try {
    const { items } = reorderSchema.parse(req.body);
    for (const item of items) {
      const { error } = await supabaseAdmin
        .from('status_groups')
        .update({ position: item.position })
        .eq('id', item.id);
      if (error) {
        res.status(error.code === 'P0001' ? 400 : 500).json({ success: false, error: error.message });
        return;
      }
    }
    res.json({ success: true });
  } catch (err) {
    if (zodErr(err, res)) return;
    console.error('Reorder status groups error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/status-groups/targets/search?type=space|folder|list|template&q=...
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
      // template — "Designer Space", "Video Editor Space", etc.
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

    // Annotate current assignment (which group, if any, owns each entity)
    const pairs = rows.map((r) => r.id);
    let assigned = new Map<string, string>();
    if (pairs.length) {
      const { data } = await supabaseAdmin
        .from('status_group_assignments')
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
    console.error('Search status-group targets error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/status-groups/templates — space templates + their group (for the "future spaces" story)
router.get('/templates', async (_req: Request, res: Response) => {
  try {
    const { data: templates, error } = await supabaseAdmin
      .from('client_space_templates')
      .select('id, slug, name, category, is_enabled')
      .order('name');
    if (error) {
      res.status(error.code === 'P0001' ? 400 : 500).json({ success: false, error: error.message });
      return;
    }
    const ids = (templates || []).map((t: any) => t.id);
    let assignMap = new Map<string, any>();
    if (ids.length) {
      const { data: assigns } = await supabaseAdmin
        .from('status_group_assignments')
        .select('*, status_groups(id, key, name, color)')
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
    console.error('List status-group templates error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// GET /admin/status-groups/:id/replace-preview?entity_type=&entity_id=
// What would change if this group replaced the entity's current group?
// Returns the current group, both groups' effective statuses, and the
// tasks in scope grouped by their exact current status string so the
// admin UI can offer an old → new mapping.
// ------------------------------------------------------------
async function handleReplacePreview(req: Request, res: Response) {
  try {
    const newGroupId = req.params.id as string;
    const entityType = req.query.entity_type as string;
    const entityId = req.query.entity_id as string;
    if (!ENTITY_TYPES.includes(entityType as any) || !entityId) {
      res.status(400).json({ success: false, error: 'entity_type and entity_id are required' });
      return;
    }
    const newGroup = await getGroup(newGroupId);
    if (!newGroup) {
      res.status(404).json({ success: false, error: 'Status group not found' });
      return;
    }
    const { data: current } = await supabaseAdmin
      .from('status_group_assignments')
      .select('*, status_groups(id, key, name, color)')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .maybeSingle();
    if (!current || (current as any).group_id === newGroupId) {
      res.json({ success: true, data: { has_existing: false } });
      return;
    }
    const currentGroup = (current as any).status_groups || { id: (current as any).group_id };
    const [oldStatuses, newStatuses] = await Promise.all([
      getGroupStatuses((current as any).group_id),
      getGroupStatuses(newGroupId),
    ]);
    const listIds = await getListIdsForEntity(entityType, entityId);
    const breakdown = await getTaskStatusBreakdown(listIds);
    const totalTasks = breakdown.reduce((n, b) => n + b.count, 0);
    res.json({
      success: true,
      data: {
        has_existing: true,
        entity: { type: entityType, id: entityId, name: await getEntityName(entityType, entityId) },
        current_group: { id: currentGroup.id || (current as any).group_id, key: currentGroup.key, name: currentGroup.name || 'Current group' },
        new_group: { id: newGroup.id, name: newGroup.name },
        old_statuses: oldStatuses,
        new_statuses: newStatuses,
        breakdown,
        total_tasks: totalTasks,
        list_count: listIds.length,
      },
    });
  } catch (err) {
    console.error('Replace preview error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
router.get('/:id/replace-preview', handleReplacePreview);

// ------------------------------------------------------------
// GET /admin/status-groups/:id/usage — where is this group applied?
// ------------------------------------------------------------
router.get('/:id/usage', async (req: Request, res: Response) => {
  try {
    const group = await getGroup((req.params.id as string));
    if (!group) {
      res.status(404).json({ success: false, error: 'Status group not found' });
      return;
    }
    const { data: assignments, error } = await supabaseAdmin
      .from('status_group_assignments')
      .select('*')
      .eq('group_id', (req.params.id as string))
      .order('created_at', { ascending: false });
    if (error) {
      res.status(error.code === 'P0001' ? 400 : 500).json({ success: false, error: error.message });
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
    console.error('Status group usage error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// PUT /admin/status-groups/:id — update meta
// ------------------------------------------------------------
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const body = groupUpdateSchema.parse(req.body);
    const group = await getGroup((req.params.id as string));
    if (!group) {
      res.status(404).json({ success: false, error: 'Status group not found' });
      return;
    }
    if (body.base_group_id !== undefined) {
      const base = body.base_group_id ? await getGroup(body.base_group_id) : null;
      if (group.key === 'task_workflow' || (body.base_group_id && base?.key !== 'task_workflow')) {
        res.status(400).json({ success: false, error: 'Primary group must be Default Task Statuses' });
        return;
      }
      if (base) {
        const inherited = await getGroupStatuses(base.id);
        const local = (await getGroupStatuses(group.id)).filter((s: any) => s.group_id === group.id);
        if (local.some((s: any) => inherited.some((b: any) => (s.key && s.key === b.key) || s.name.toLowerCase() === b.name.toLowerCase()))) {
          res.status(409).json({ success: false, error: 'Remove or rename conflicting local statuses before linking this group' });
          return;
        }
      }
    }
    if (body.custom_sections) {
      const baseId = body.base_group_id !== undefined ? body.base_group_id : group.base_group_id;
      const inheritedSections = baseId ? await getGroupSections(await getGroup(baseId)) : [];
      const keys = [...inheritedSections, ...body.custom_sections].map((s: any) => s.key);
      if (new Set(keys).size !== keys.length) {
        res.status(400).json({ success: false, error: 'Section keys must be unique' });
        return;
      }
    }
    const patch: Record<string, any> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description ?? '';
    if (body.icon !== undefined) patch.icon = body.icon;
    if (body.color !== undefined) patch.color = body.color;
    if (body.base_group_id !== undefined) patch.base_group_id = body.base_group_id;
    if (body.custom_sections !== undefined) patch.custom_sections = body.custom_sections;

    const { data, error } = await supabaseAdmin
      .from('status_groups')
      .update(patch)
      .eq('id', (req.params.id as string))
      .select()
      .single();
    if (error) {
      res.status(error.code === 'P0001' ? 400 : 500).json({ success: false, error: error.message });
      return;
    }
    refreshTaskOverrides();
    await syncAllSpacesForGroup(group.id);
    res.json({ success: true, data });
  } catch (err) {
    if (zodErr(err, res)) return;
    console.error('Update status group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/status-groups/:id/enabled
router.put('/:id/enabled', async (req: Request, res: Response) => {
  try {
    const { is_enabled } = z.object({ is_enabled: z.boolean() }).parse(req.body);
    const group = await getGroup((req.params.id as string));
    if (!group) {
      res.status(404).json({ success: false, error: 'Status group not found' });
      return;
    }
    if (group.key === 'task_workflow' && !is_enabled) {
      res.status(400).json({ success: false, error: 'Default Task Statuses must remain enabled' });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('status_groups')
      .update({ is_enabled })
      .eq('id', (req.params.id as string))
      .select()
      .single();
    if (error) {
      res.status(error.code === 'P0001' ? 400 : 500).json({ success: false, error: error.message });
      return;
    }
    refreshTaskOverrides();
    res.json({ success: true, data });
  } catch (err) {
    if (zodErr(err, res)) return;
    console.error('Toggle status group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/status-groups/:id/default
router.put('/:id/default', async (req: Request, res: Response) => {
  try {
    const group = await getGroup((req.params.id as string));
    if (!group) {
      res.status(404).json({ success: false, error: 'Status group not found' });
      return;
    }
    if (group.key !== 'task_workflow') {
      res.status(400).json({ success: false, error: 'Default Task Statuses is the system default. Use it as the primary group instead.' });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('status_groups')
      .update({ is_default: true })
      .eq('id', (req.params.id as string))
      .select()
      .single();
    if (error) {
      res.status(error.code === 'P0001' ? 400 : 500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('Set default status group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/status-groups/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const group = await getGroup((req.params.id as string));
    if (!group) {
      res.status(404).json({ success: false, error: 'Status group not found' });
      return;
    }
    if (group.is_system) {
      res.status(400).json({ success: false, error: 'System status groups cannot be deleted' });
      return;
    }
    if (group.is_default) {
      res.status(400).json({ success: false, error: 'The default group cannot be deleted. Set another group as default first.' });
      return;
    }
    // Assignments cascade via FK; applied spaces keep their cloned space_statuses.
    const { error } = await supabaseAdmin.from('status_groups').delete().eq('id', (req.params.id as string));
    if (error) {
      res.status(error.code === 'P0001' ? 400 : 500).json({ success: false, error: error.message });
      return;
    }
    refreshTaskOverrides();
    res.json({ success: true });
  } catch (err) {
    console.error('Delete status group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// Statuses inside a group
// ------------------------------------------------------------

// POST /admin/status-groups/:id/statuses
router.post('/:id/statuses', async (req: Request, res: Response) => {
  try {
    const body = statusCreateSchema.parse(req.body);
    const group = await getGroup((req.params.id as string));
    if (!group) {
      res.status(404).json({ success: false, error: 'Status group not found' });
      return;
    }
    const existing = await getGroupStatuses((req.params.id as string));
    const nextPos = existing.length
      ? Math.max(...existing.map((s: any) => s.position)) + 1
      : 0;

    const rawSlug = slugify(body.name);
    const canonicalKey = body.key || rawSlug;
    const isSystem = group.key === 'task_workflow' || isSystemStatusKey(canonicalKey);
    if (existing.some((s: any) => s.key === canonicalKey || s.name.toLowerCase() === body.name.toLowerCase())) {
      res.status(409).json({ success: false, error: 'A local or inherited status with this name or key already exists' });
      return;
    }
    if (group.base_group_id && body.is_default) {
      res.status(400).json({ success: false, error: 'The primary group owns the initial status' });
      return;
    }
    const preset = isSystem ? SYSTEM_STATUS_PRESETS.find((p) => p.key === canonicalKey) : null;

    const { data, error } = await supabaseAdmin
      .from('status_group_statuses')
      .insert({
        group_id: (req.params.id as string),
        key: canonicalKey,
        name: body.name,
        description: body.description ?? preset?.description ?? null,
        color: body.color || preset?.color || '#6b7280',
        category: body.category || preset?.category || 'todo',
        is_default: group.base_group_id ? false : (body.is_default ?? existing.length === 0),
        is_system: isSystem,
        position: nextPos,
        section: body.section || preset?.section || null,
        section_label: body.section_label ?? preset?.section_label ?? null,
        section_emoji: body.section_emoji ?? preset?.section_emoji ?? null,
      })
      .select()
      .single();
    if (error) {
      const status = error.code === '23505' ? 409 : error.code === 'P0001' ? 400 : 500;
      res.status(status).json({
        success: false,
        error: error.code === '23505' ? 'A status with this name already exists in the group' : error.message,
      });
      return;
    }
    refreshTaskOverrides();
    await syncAllSpacesForGroup(req.params.id as string);
    res.status(201).json({ success: true, data });
  } catch (err) {
    if (zodErr(err, res)) return;
    console.error('Create group status error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/status-groups/:id/statuses/reorder (static — before :statusId)
router.put('/:id/statuses/reorder', async (req: Request, res: Response) => {
  try {
    const { items } = reorderSchema.parse(req.body);
    const local = (await getGroupStatuses(req.params.id as string)).filter((s: any) => s.group_id === req.params.id);
    if (items.some((item) => !local.some((s: any) => s.id === item.id))) {
      res.status(400).json({ success: false, error: 'Inherited statuses must be reordered in Default Task Statuses' });
      return;
    }
    for (const item of items) {
      const { error } = await supabaseAdmin
        .from('status_group_statuses')
        .update({ position: item.position })
        .eq('id', item.id)
        .eq('group_id', (req.params.id as string));
      if (error) {
        res.status(error.code === 'P0001' ? 400 : 500).json({ success: false, error: error.message });
        return;
      }
    }
    refreshTaskOverrides();
    await syncAllSpacesForGroup(req.params.id as string);
    res.json({ success: true });
  } catch (err) {
    if (zodErr(err, res)) return;
    console.error('Reorder group statuses error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/status-groups/:id/statuses/:statusId
router.put('/:id/statuses/:statusId', async (req: Request, res: Response) => {
  try {
    const { data: existing } = await supabaseAdmin
      .from('status_group_statuses')
      .select('id, key, name, is_system')
      .eq('id', (req.params.statusId as string))
      .eq('group_id', (req.params.id as string))
      .maybeSingle();
    if (!existing) {
      res.status(404).json({ success: false, error: 'Status not found' });
      return;
    }
    const group = await getGroup(req.params.id as string);
    if (group?.key !== 'task_workflow' && isSystemStatus(existing as any)) {
      res.status(400).json({ success: false, error: 'System default status cannot be edited or changed' });
      return;
    }

    const body = statusUpdateSchema.parse(req.body);
    if (group?.base_group_id && body.is_default) {
      res.status(400).json({ success: false, error: 'The primary group owns the initial status' });
      return;
    }
    const patch: Record<string, any> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.color !== undefined) patch.color = body.color;
    if (body.category !== undefined) patch.category = body.category;
    if (body.is_default !== undefined) patch.is_default = body.is_default;
    // Key is immutable (stored on tasks); description/sections are editable.
    if (body.description !== undefined) patch.description = body.description;
    if (body.section !== undefined) patch.section = body.section;
    if (body.section_label !== undefined) patch.section_label = body.section_label;
    if (body.section_emoji !== undefined) patch.section_emoji = body.section_emoji;

    const { data, error } = await supabaseAdmin
      .from('status_group_statuses')
      .update(patch)
      .eq('id', (req.params.statusId as string))
      .eq('group_id', (req.params.id as string))
      .select()
      .single();
    if (error) {
      res.status(error.code === 'P0001' ? 400 : 500).json({ success: false, error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ success: false, error: 'Status not found' });
      return;
    }
    refreshTaskOverrides();
    await syncAllSpacesForGroup(req.params.id as string);
    res.json({ success: true, data });
  } catch (err) {
    if (zodErr(err, res)) return;
    console.error('Update group status error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/status-groups/:id/statuses/:statusId/usage — count tasks currently using this status
router.get('/:id/statuses/:statusId/usage', async (req: Request, res: Response) => {
  try {
    const groupId = req.params.id as string;
    const statusId = req.params.statusId as string;

    const { data: existing } = await supabaseAdmin
      .from('status_group_statuses')
      .select('id, key, name, is_system')
      .eq('id', statusId)
      .eq('group_id', groupId)
      .maybeSingle();

    if (!existing) {
      res.status(404).json({ success: false, error: 'Status not found' });
      return;
    }

    const candidates = Array.from(new Set([
      existing.key,
      existing.name,
      existing.key?.toLowerCase(),
      existing.key?.toUpperCase(),
      existing.name?.toLowerCase(),
      existing.name?.toUpperCase(),
    ].filter(Boolean))) as string[];

    const { count, error } = await supabaseAdmin
      .from('tasks')
      .select('*', { count: 'exact', head: true })
      .in('status', candidates);

    if (error) {
      res.status(error.code === 'P0001' ? 400 : 500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, count: count || 0 });
  } catch (err) {
    console.error('Get group status usage error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/status-groups/:id/statuses/:statusId
router.delete('/:id/statuses/:statusId', async (req: Request, res: Response) => {
  try {
    const groupId = req.params.id as string;
    const statusId = req.params.statusId as string;
    const targetStatusId = (req.body?.target_status_id || req.query.target_status_id) as string | undefined;

    const { data: existing } = await supabaseAdmin
      .from('status_group_statuses')
      .select('id, key, name, is_system')
      .eq('id', statusId)
      .eq('group_id', groupId)
      .maybeSingle();

    if (!existing) {
      res.status(404).json({ success: false, error: 'Status not found' });
      return;
    }
    const group = await getGroup(req.params.id as string);
    if (group?.key !== 'task_workflow' && isSystemStatus(existing as any)) {
      res.status(400).json({ success: false, error: 'System default status cannot be deleted' });
      return;
    }

    const remaining = await getGroupStatuses(groupId);
    if (remaining.length <= 1) {
      res.status(400).json({ success: false, error: 'Keep at least one status in the group' });
      return;
    }
    const candidates = Array.from(new Set([
      existing.key,
      existing.name,
      existing.key?.toLowerCase(),
      existing.key?.toUpperCase(),
      existing.name?.toLowerCase(),
      existing.name?.toUpperCase(),
    ].filter(Boolean))) as string[];

    const { count: taskCount, error: usageError } = await supabaseAdmin
      .from('tasks')
      .select('*', { count: 'exact', head: true })
      .in('status', candidates);

    if (usageError) {
      res.status(500).json({ success: false, error: 'Failed to check tasks using this status' });
      return;
    }
    if (taskCount && taskCount > 0) {
      if (!targetStatusId) {
        res.status(400).json({
          success: false,
          error: `There are ${taskCount} task(s) with this status. Please select a replacement status before deleting.`,
          count: taskCount,
        });
        return;
      }

      const targetStatus = (await getGroupStatuses(groupId)).find((s: any) => s.id === targetStatusId);

      if (!targetStatus || targetStatus.id === statusId) {
        res.status(400).json({ success: false, error: 'Invalid replacement status selected' });
        return;
      }

      const replacementValue = targetStatus.key || targetStatus.name;

      const { error: updateError } = await supabaseAdmin
        .from('tasks')
        .update({ status: replacementValue })
        .in('status', candidates);

      if (updateError) {
        console.error('Failed to reassign tasks on status delete:', updateError);
        res.status(500).json({ success: false, error: 'Failed to reassign tasks to new status' });
        return;
      }
    }

    const { error: deleteError } = await supabaseAdmin
      .from('status_group_statuses')
      .delete()
      .eq('id', statusId);

    if (deleteError) {
      res.status(500).json({ success: false, error: deleteError.message });
      return;
    }

    refreshTaskOverrides();
    await syncAllSpacesForGroup(groupId);
    res.json({ success: true, reassigned_tasks: taskCount || 0 });
  } catch (err) {
    console.error('Delete group status error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// Apply / unapply — requirement 2 + 3
// ------------------------------------------------------------

// POST /admin/status-groups/:id/apply {entity_type, entity_id, allow_replace?, status_mapping?}
router.post('/:id/apply', async (req: Request, res: Response) => {
  try {
    const { entity_type, entity_id, allow_replace, status_mapping } = applySchema.parse(req.body);
    const group = await getGroup((req.params.id as string));
    if (!group) {
      res.status(404).json({ success: false, error: 'Status group not found' });
      return;
    }

    // Validate the target exists (templates live in client_space_templates).
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

    // Replace guard: swapping groups re-points live tasks, so require an
    // explicit mapping pass instead of silently overwriting.
    const { data: current } = await supabaseAdmin
      .from('status_group_assignments')
      .select('group_id')
      .eq('entity_type', entity_type)
      .eq('entity_id', entity_id)
      .maybeSingle();
    const currentGroupId = (current as any)?.group_id as string | undefined;
    if (currentGroupId && currentGroupId !== (req.params.id as string) && !allow_replace) {
      res.status(409).json({
        success: false,
        error: 'This place already has a status group. Use Replace to remap its tasks.',
        code: 'ALREADY_APPLIED',
        current_group_id: currentGroupId,
      });
      return;
    }

    let remapped = 0;
    if (currentGroupId && currentGroupId !== (req.params.id as string) && allow_replace) {
      const listIds = await getListIdsForEntity(entity_type, entity_id);
      const breakdown = await getTaskStatusBreakdown(listIds);
      if (breakdown.length > 0) {
        const mapping = status_mapping || {};
        const unmapped = breakdown.map((b) => b.status).filter((s) => !mapping[s]);
        if (unmapped.length > 0) {
          res.status(400).json({
            success: false,
            error: `Map every existing status before replacing (unmapped: ${unmapped.join(', ')}).`,
            unmapped,
            breakdown,
          });
          return;
        }
        const newStatuses = await getGroupStatuses(req.params.id as string);
        const byId = new Map(newStatuses.map((s: any) => [s.id, s]));
        for (const [oldStatus, newStatusId] of Object.entries(mapping)) {
          const row = byId.get(newStatusId);
          if (!row) {
            res.status(400).json({ success: false, error: 'Invalid status in mapping' });
            return;
          }
          const replacement = (row as any).key || (row as any).name;
          if (listIds.length === 0) continue;
          const { error: updateError } = await supabaseAdmin
            .from('tasks')
            .update({ status: replacement })
            .in('list_id', listIds)
            .eq('status', oldStatus);
          if (updateError) throw new Error(updateError.message);
          remapped += breakdown.find((b) => b.status === oldStatus)?.count || 0;
        }
      }
    }

    const assignment = await upsertAssignment(
      (req.params.id as string),
      entity_type,
      entity_id,
      (req as any).userId,
    );
    refreshTaskOverrides();
    res.status(201).json({ success: true, data: assignment, remapped_tasks: remapped });
  } catch (err) {
    if (zodErr(err, res)) return;
    console.error('Apply status group error:', err);
    res.status(500).json({ success: false, error: (err as Error).message || 'Internal server error' });
  }
});

// DELETE /admin/status-groups/:id/apply {entity_type, entity_id}
router.delete('/:id/apply', async (req: Request, res: Response) => {
  try {
    const { entity_type, entity_id } = applySchema.parse(req.body || {});
    const { error } = await supabaseAdmin
      .from('status_group_assignments')
      .delete()
      .eq('group_id', (req.params.id as string))
      .eq('entity_type', entity_type)
      .eq('entity_id', entity_id);
    if (error) {
      res.status(error.code === 'P0001' ? 400 : 500).json({ success: false, error: error.message });
      return;
    }
    // Note: applied spaces keep their cloned space_statuses (boards don't shift).
    res.json({ success: true });
  } catch (err) {
    if (zodErr(err, res)) return;
    console.error('Unapply status group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/status-groups/:id/sync-space/:spaceId — re-clone into a space
router.post('/:id/sync-space/:spaceId', async (req: Request, res: Response) => {
  try {
    const group = await getGroup((req.params.id as string));
    if (!group) {
      res.status(404).json({ success: false, error: 'Status group not found' });
      return;
    }
    const { data: space } = await supabaseAdmin
      .from('spaces')
      .select('id')
      .eq('id', (req.params.spaceId as string))
      .maybeSingle();
    if (!space) {
      res.status(404).json({ success: false, error: 'Space not found' });
      return;
    }
    const rows = await syncSpaceToGroup((req.params.spaceId as string), (req.params.id as string));
    await upsertAssignment((req.params.id as string), 'space', (req.params.spaceId as string), (req as any).userId);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Sync space to group error:', err);
    res.status(500).json({ success: false, error: (err as Error).message || 'Internal server error' });
  }
});

export default router;
export { spaceHasSeedStatuses };
