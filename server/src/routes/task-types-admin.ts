import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

const RESERVED_FIELD_KEYS = new Set([
  'format', 'audience', 'tone', 'references', 'attachments', 'custom',
]);

const FIELD_TYPES = [
  'text', 'textarea', 'select', 'multi_select', 'number', 'date', 'url', 'checkbox',
] as const;

const slugRegex = /^[a-z][a-z0-9_]*$/;

const typeCreateSchema = z.object({
  key: z.string().min(1).max(64).regex(slugRegex, 'Key must be lowercase letters, numbers and underscores'),
  name: z.string().min(1).max(100),
  description: z.string().nullable().optional(),
  icon: z.string().max(64).optional(),
  color: z.string().max(16).optional(),
});

const typeUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().nullable().optional(),
  icon: z.string().max(64).optional(),
  color: z.string().max(16).optional(),
});

const reorderSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), position: z.number().int().min(0) })),
});

const fieldCreateSchema = z.object({
  key: z.string().min(1).max(64).regex(slugRegex, 'Key must be lowercase letters, numbers and underscores'),
  label: z.string().min(1).max(100),
  field_type: z.enum(FIELD_TYPES),
  options: z.array(z.object({ label: z.string(), value: z.string(), color: z.string().optional() })).optional(),
  is_required: z.boolean().optional(),
  help_text: z.string().nullable().optional(),
  placeholder: z.string().nullable().optional(),
});

const fieldUpdateSchema = fieldCreateSchema.partial().omit({ key: true });

const enabledSchema = z.object({ is_enabled: z.boolean() });

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

async function getType(id: string): Promise<{ id: string; is_system: boolean; is_default: boolean } | null> {
  const { data } = await supabaseAdmin
    .from('task_types')
    .select('id, is_system, is_default')
    .eq('id', id)
    .maybeSingle();
  return data as any;
}

function rejectIfSystem(type: { is_system: boolean } | null, res: Response): boolean {
  if (!type) {
    res.status(404).json({ success: false, error: 'Task type not found' });
    return true;
  }
  if (type.is_system) {
    res.status(400).json({ success: false, error: 'System task types cannot be modified' });
    return true;
  }
  return false;
}

// ------------------------------------------------------------
// Task Types — list + create
// ------------------------------------------------------------

// GET /admin/task-types — list with nested fields + access info
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data: types, error: typesErr } = await supabaseAdmin
      .from('task_types')
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });

    if (typesErr) {
      res.status(500).json({ success: false, error: typesErr.message });
      return;
    }

    const { data: fields, error: fieldsErr } = await supabaseAdmin
      .from('task_type_fields')
      .select('*')
      .order('position', { ascending: true });
    if (fieldsErr) {
      res.status(500).json({ success: false, error: fieldsErr.message });
      return;
    }

    const { data: roleAccess } = await supabaseAdmin
      .from('task_type_role_access')
      .select('id, task_type_id, role_id, created_at');
    const { data: userAccess } = await supabaseAdmin
      .from('task_type_user_access')
      .select('id, task_type_id, user_id, created_at');

    const roleIds = [...new Set((roleAccess || []).map((r: any) => r.role_id))];
    const userIds = [...new Set((userAccess || []).map((u: any) => u.user_id))];

    const rolesMap: Record<string, any> = {};
    if (roleIds.length) {
      const { data: roles } = await supabaseAdmin
        .from('roles')
        .select('id, name, color')
        .in('id', roleIds);
      (roles || []).forEach((r: any) => { rolesMap[r.id] = r; });
    }

    const usersMap: Record<string, any> = {};
    if (userIds.length) {
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id, display_name, email')
        .in('id', userIds);
      (users || []).forEach((u: any) => { usersMap[u.id] = u; });
    }

    const fieldsByType = new Map<string, any[]>();
    for (const f of fields || []) {
      const list = fieldsByType.get(f.task_type_id) || [];
      list.push(f);
      fieldsByType.set(f.task_type_id, list);
    }

    const roleAccessByType = new Map<string, any[]>();
    for (const ra of roleAccess || []) {
      const list = roleAccessByType.get(ra.task_type_id) || [];
      list.push({ ...ra, role: rolesMap[ra.role_id] || null });
      roleAccessByType.set(ra.task_type_id, list);
    }

    const userAccessByType = new Map<string, any[]>();
    for (const ua of userAccess || []) {
      const list = userAccessByType.get(ua.task_type_id) || [];
      list.push({ ...ua, user: usersMap[ua.user_id] || null });
      userAccessByType.set(ua.task_type_id, list);
    }

    const result = (types || []).map((t: any) => ({
      ...t,
      fields: fieldsByType.get(t.id) || [],
      role_access: roleAccessByType.get(t.id) || [],
      user_access: userAccessByType.get(t.id) || [],
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('List task types error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/task-types — create (custom types only)
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = typeCreateSchema.parse(req.body);

    const { data: maxRow } = await supabaseAdmin
      .from('task_types')
      .select('position')
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = ((maxRow as any)?.position ?? -1) + 1;

    const { data, error } = await supabaseAdmin
      .from('task_types')
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

    res.status(201).json({ success: true, data: { ...data, fields: [], role_access: [], user_access: [] } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create task type error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// Static routes (must come before :id routes)
// ------------------------------------------------------------

// PUT /admin/task-types/reorder — bulk update positions
router.put('/reorder', async (req: Request, res: Response) => {
  try {
    const { items } = reorderSchema.parse(req.body);
    for (const item of items) {
      const { error } = await supabaseAdmin
        .from('task_types')
        .update({ position: item.position })
        .eq('id', item.id);
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Reorder task types error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// Nested field static routes (must come before /:id/fields/:fieldId)
// ------------------------------------------------------------

// PUT /admin/task-types/:id/fields/reorder (custom types only)
router.put('/:id/fields/reorder', async (req: Request, res: Response) => {
  try {
    const type = await getType(req.params.id as string);
    if (rejectIfSystem(type, res)) return;

    const { items } = reorderSchema.parse(req.body);
    for (const item of items) {
      const { error } = await supabaseAdmin
        .from('task_type_fields')
        .update({ position: item.position })
        .eq('id', item.id)
        .eq('task_type_id', req.params.id);
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Reorder fields error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// :id routes
// ------------------------------------------------------------

// PUT /admin/task-types/:id — update (custom types only)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const type = await getType(req.params.id as string);
    if (rejectIfSystem(type, res)) return;

    const body = typeUpdateSchema.parse(req.body);
    const patch: Record<string, any> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.icon !== undefined) patch.icon = body.icon;
    if (body.color !== undefined) patch.color = body.color;

    const { data, error } = await supabaseAdmin
      .from('task_types')
      .update(patch)
      .eq('id', req.params.id)
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
    console.error('Update task type error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/task-types/:id/enabled — toggle is_enabled (allowed on system + custom)
router.put('/:id/enabled', async (req: Request, res: Response) => {
  try {
    const { is_enabled } = enabledSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('task_types')
      .update({ is_enabled })
      .eq('id', req.params.id)
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
    console.error('Toggle enabled error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/task-types/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const reassignTo = (req.query.reassign_to as string) || null;

    const { data: type } = await supabaseAdmin
      .from('task_types')
      .select('id, is_system, is_default')
      .eq('id', id)
      .single();

    if (!type) {
      res.status(404).json({ success: false, error: 'Task type not found' });
      return;
    }
    if ((type as any).is_system) {
      res.status(400).json({ success: false, error: 'System task types cannot be deleted' });
      return;
    }
    if ((type as any).is_default) {
      res.status(400).json({ success: false, error: 'Cannot delete the default task type. Set another type as default first.' });
      return;
    }

    const { count } = await supabaseAdmin
      .from('tasks')
      .select('*', { count: 'exact', head: true })
      .eq('task_type_id', id);

    if ((count || 0) > 0) {
      if (!reassignTo) {
        res.status(409).json({
          success: false,
          error: `${count} task(s) use this type. Pass ?reassign_to=<type_id> to reassign before deleting.`,
          in_use_count: count,
        });
        return;
      }

      const { error: reErr } = await supabaseAdmin
        .from('tasks')
        .update({ task_type_id: reassignTo })
        .eq('task_type_id', id);

      if (reErr) {
        res.status(500).json({ success: false, error: reErr.message });
        return;
      }
    }

    const { error } = await supabaseAdmin.from('task_types').delete().eq('id', id);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Task type deleted' });
  } catch (err) {
    console.error('Delete task type error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/task-types/:id/default — atomic promote to default
router.put('/:id/default', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const { data: target } = await supabaseAdmin
      .from('task_types')
      .select('id')
      .eq('id', id)
      .single();
    if (!target) {
      res.status(404).json({ success: false, error: 'Task type not found' });
      return;
    }

    const { error: clearErr } = await supabaseAdmin
      .from('task_types')
      .update({ is_default: false })
      .eq('is_default', true);

    if (clearErr) {
      res.status(500).json({ success: false, error: clearErr.message });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('task_types')
      .update({ is_default: true })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Promote default task type error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// Custom Fields (custom types only)
// ------------------------------------------------------------

// POST /admin/task-types/:id/fields
router.post('/:id/fields', async (req: Request, res: Response) => {
  try {
    const typeId = req.params.id as string;
    const type = await getType(typeId);
    if (rejectIfSystem(type, res)) return;

    const body = fieldCreateSchema.parse(req.body);

    if (RESERVED_FIELD_KEYS.has(body.key)) {
      res.status(400).json({ success: false, error: `"${body.key}" is a reserved key` });
      return;
    }

    const { data: maxRow } = await supabaseAdmin
      .from('task_type_fields')
      .select('position')
      .eq('task_type_id', typeId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = ((maxRow as any)?.position ?? -1) + 1;

    const { data, error } = await supabaseAdmin
      .from('task_type_fields')
      .insert({
        task_type_id: typeId,
        key: body.key,
        label: body.label,
        field_type: body.field_type,
        options: body.options ?? [],
        is_required: body.is_required ?? false,
        help_text: body.help_text ?? null,
        placeholder: body.placeholder ?? null,
        position: nextPos,
      })
      .select()
      .single();

    if (error) {
      const status = error.code === '23505' ? 409 : 500;
      res.status(status).json({ success: false, error: error.message });
      return;
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create field error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/task-types/:id/fields/:fieldId
router.put('/:id/fields/:fieldId', async (req: Request, res: Response) => {
  try {
    const type = await getType(req.params.id as string);
    if (rejectIfSystem(type, res)) return;

    const body = fieldUpdateSchema.parse(req.body);
    const patch: Record<string, any> = {};
    if (body.label !== undefined) patch.label = body.label;
    if (body.field_type !== undefined) patch.field_type = body.field_type;
    if (body.options !== undefined) patch.options = body.options;
    if (body.is_required !== undefined) patch.is_required = body.is_required;
    if (body.help_text !== undefined) patch.help_text = body.help_text;
    if (body.placeholder !== undefined) patch.placeholder = body.placeholder;

    const { data, error } = await supabaseAdmin
      .from('task_type_fields')
      .update(patch)
      .eq('id', req.params.fieldId)
      .eq('task_type_id', req.params.id)
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
    console.error('Update field error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/task-types/:id/fields/:fieldId
router.delete('/:id/fields/:fieldId', async (req: Request, res: Response) => {
  try {
    const type = await getType(req.params.id as string);
    if (rejectIfSystem(type, res)) return;

    const { error } = await supabaseAdmin
      .from('task_type_fields')
      .delete()
      .eq('id', req.params.fieldId)
      .eq('task_type_id', req.params.id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Field deleted' });
  } catch (err) {
    console.error('Delete field error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// Access sharing (custom types only)
// ------------------------------------------------------------

const roleAccessSchema = z.object({ role_id: z.string().uuid() });
const userAccessSchema = z.object({ user_id: z.string().uuid() });

// POST /admin/task-types/:id/roles — grant role access
router.post('/:id/roles', async (req: Request, res: Response) => {
  try {
    const type = await getType(req.params.id as string);
    if (rejectIfSystem(type, res)) return;

    const { role_id } = roleAccessSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('task_type_role_access')
      .insert({ task_type_id: req.params.id, role_id })
      .select()
      .single();

    if (error) {
      const status = error.code === '23505' ? 409 : 500;
      res.status(status).json({ success: false, error: error.message });
      return;
    }

    const { data: role } = await supabaseAdmin
      .from('roles')
      .select('id, name, color')
      .eq('id', role_id)
      .single();

    res.status(201).json({ success: true, data: { ...data, role } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add role access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/task-types/:id/roles/:roleId
router.delete('/:id/roles/:roleId', async (req: Request, res: Response) => {
  try {
    const type = await getType(req.params.id as string);
    if (rejectIfSystem(type, res)) return;

    const { error } = await supabaseAdmin
      .from('task_type_role_access')
      .delete()
      .eq('task_type_id', req.params.id)
      .eq('role_id', req.params.roleId);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Remove role access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/task-types/:id/users — grant user access
router.post('/:id/users', async (req: Request, res: Response) => {
  try {
    const type = await getType(req.params.id as string);
    if (rejectIfSystem(type, res)) return;

    const { user_id } = userAccessSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('task_type_user_access')
      .insert({ task_type_id: req.params.id, user_id })
      .select()
      .single();

    if (error) {
      const status = error.code === '23505' ? 409 : 500;
      res.status(status).json({ success: false, error: error.message });
      return;
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email')
      .eq('id', user_id)
      .single();

    res.status(201).json({ success: true, data: { ...data, user } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add user access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/task-types/:id/users/:userId
router.delete('/:id/users/:userId', async (req: Request, res: Response) => {
  try {
    const type = await getType(req.params.id as string);
    if (rejectIfSystem(type, res)) return;

    const { error } = await supabaseAdmin
      .from('task_type_user_access')
      .delete()
      .eq('task_type_id', req.params.id)
      .eq('user_id', req.params.userId);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Remove user access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
