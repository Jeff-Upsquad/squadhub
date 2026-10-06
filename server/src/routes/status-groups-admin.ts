import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import {
  getGroupStatuses,
  syncSpaceToGroup,
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
});

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
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const { data: statuses } = await supabaseAdmin
      .from('status_group_statuses')
      .select('*')
      .order('position', { ascending: true });

    const { data: assignments } = await supabaseAdmin
      .from('status_group_assignments')
      .select('id, group_id, entity_type, entity_id');

    const statusesByGroup = new Map<string, any[]>();
    for (const s of statuses || []) {
      const list = statusesByGroup.get(s.group_id) || [];
      list.push({
        ...s,
        is_system: isSystemStatus(s),
      });
      statusesByGroup.set(s.group_id, list);
    }

    const usageByGroup = new Map<string, number>();
    for (const a of assignments || []) {
      usageByGroup.set(a.group_id, (usageByGroup.get(a.group_id) || 0) + 1);
    }

    const result = (groups || []).map((g: any) => ({
      ...g,
      statuses: statusesByGroup.get(g.id) || [],
      usage_count: usageByGroup.get(g.id) || 0,
    }));

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
        description: body.description ?? null,
        icon: body.icon || 'flag',
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

    res.status(201).json({ success: true, data: { ...data, statuses: [], usage_count: 0 } });
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
        res.status(500).json({ success: false, error: error.message });
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
      res.status(500).json({ success: false, error: error.message });
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
    const patch: Record<string, any> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.icon !== undefined) patch.icon = body.icon;
    if (body.color !== undefined) patch.color = body.color;

    const { data, error } = await supabaseAdmin
      .from('status_groups')
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
    const { data, error } = await supabaseAdmin
      .from('status_groups')
      .update({ is_enabled })
      .eq('id', (req.params.id as string))
      .select()
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
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
    await supabaseAdmin.from('status_groups').update({ is_default: false }).eq('is_default', true);
    const { data, error } = await supabaseAdmin
      .from('status_groups')
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
      res.status(500).json({ success: false, error: error.message });
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
    const canonicalKey = body.key || (isSystemStatusKey(rawSlug) ? rawSlug : rawSlug);
    const isSystem = isSystemStatusKey(canonicalKey);
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
        is_default: body.is_default ?? existing.length === 0,
        position: nextPos,
        section: body.section || preset?.section || null,
        section_label: body.section_label ?? preset?.section_label ?? null,
        section_emoji: body.section_emoji ?? preset?.section_emoji ?? null,
      })
      .select()
      .single();
    if (error) {
      const status = error.code === '23505' ? 409 : 500;
      res.status(status).json({
        success: false,
        error: error.code === '23505' ? 'A status with this name already exists in the group' : error.message,
      });
      return;
    }
    refreshTaskOverrides();
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
    for (const item of items) {
      const { error } = await supabaseAdmin
        .from('status_group_statuses')
        .update({ position: item.position })
        .eq('id', item.id)
        .eq('group_id', (req.params.id as string));
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
    }
    refreshTaskOverrides();
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
      .select('id, key, is_system')
      .eq('id', (req.params.statusId as string))
      .eq('group_id', (req.params.id as string))
      .maybeSingle();
    if (!existing) {
      res.status(404).json({ success: false, error: 'Status not found' });
      return;
    }
    if (isSystemStatus(existing as any)) {
      res.status(400).json({ success: false, error: 'System default status cannot be edited or changed' });
      return;
    }

    const body = statusUpdateSchema.parse(req.body);
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
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ success: false, error: 'Status not found' });
      return;
    }
    refreshTaskOverrides();
    res.json({ success: true, data });
  } catch (err) {
    if (zodErr(err, res)) return;
    console.error('Update group status error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/status-groups/:id/statuses/:statusId
router.delete('/:id/statuses/:statusId', async (req: Request, res: Response) => {
  try {
    const { data: existing } = await supabaseAdmin
      .from('status_group_statuses')
      .select('id, key, is_system')
      .eq('id', (req.params.statusId as string))
      .eq('group_id', (req.params.id as string))
      .maybeSingle();
    if (!existing) {
      res.status(404).json({ success: false, error: 'Status not found' });
      return;
    }
    if (isSystemStatus(existing as any)) {
      res.status(400).json({ success: false, error: 'System default status cannot be deleted' });
      return;
    }
    const { error } = await supabaseAdmin
      .from('status_group_statuses')
      .delete()
      .eq('id', (req.params.statusId as string));
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    refreshTaskOverrides();
    res.json({ success: true });
  } catch (err) {
    console.error('Delete group status error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// Apply / unapply — requirement 2 + 3
// ------------------------------------------------------------

// POST /admin/status-groups/:id/apply {entity_type, entity_id}
router.post('/:id/apply', async (req: Request, res: Response) => {
  try {
    const { entity_type, entity_id } = applySchema.parse(req.body);
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

    const assignment = await upsertAssignment(
      (req.params.id as string),
      entity_type,
      entity_id,
      (req as any).userId,
    );
    res.status(201).json({ success: true, data: assignment });
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
      res.status(500).json({ success: false, error: error.message });
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
