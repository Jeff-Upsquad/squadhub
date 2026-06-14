import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  color: z.string().max(16).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  color: z.string().max(16).optional(),
});

const memberSchema = z.object({ user_id: z.string().uuid() });

const DUP_NAME = 'A department with this name already exists';

// ------------------------------------------------------------
// GET /admin/departments — list with nested members + member_count
// ------------------------------------------------------------
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data: departments, error } = await supabaseAdmin
      .from('departments')
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const { data: members } = await supabaseAdmin
      .from('department_members')
      .select('id, department_id, user_id, created_at')
      .order('created_at', { ascending: true });

    const userIds = [...new Set((members || []).map((m: any) => m.user_id))];
    const usersMap: Record<string, any> = {};
    if (userIds.length) {
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id, display_name, email, avatar_url')
        .in('id', userIds);
      (users || []).forEach((u: any) => { usersMap[u.id] = u; });
    }

    const membersByDept = new Map<string, any[]>();
    for (const m of members || []) {
      const list = membersByDept.get(m.department_id) || [];
      list.push({ ...m, user: usersMap[m.user_id] || null });
      membersByDept.set(m.department_id, list);
    }

    const result = (departments || []).map((d: any) => {
      const mem = membersByDept.get(d.id) || [];
      return { ...d, members: mem, member_count: mem.length };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('List departments error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /admin/departments — create
// ------------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    const { data: maxRow } = await supabaseAdmin
      .from('departments')
      .select('position')
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = ((maxRow as any)?.position ?? -1) + 1;

    const { data, error } = await supabaseAdmin
      .from('departments')
      .insert({
        name: body.name,
        description: body.description ?? null,
        color: body.color || '#6b7280',
        position: nextPos,
      })
      .select()
      .single();

    if (error) {
      const status = error.code === '23505' ? 409 : 500;
      res.status(status).json({ success: false, error: error.code === '23505' ? DUP_NAME : error.message });
      return;
    }

    res.status(201).json({ success: true, data: { ...data, members: [], member_count: 0 } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create department error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// PUT /admin/departments/:id — update
// ------------------------------------------------------------
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const body = updateSchema.parse(req.body);

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.color !== undefined) patch.color = body.color;

    const { data, error } = await supabaseAdmin
      .from('departments')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();

    if (error) {
      const status = error.code === '23505' ? 409 : 500;
      res.status(status).json({ success: false, error: error.code === '23505' ? DUP_NAME : error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ success: false, error: 'Department not found' });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update department error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// DELETE /admin/departments/:id — delete (cascade removes memberships)
// ------------------------------------------------------------
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin.from('departments').delete().eq('id', req.params.id);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Department deleted' });
  } catch (err) {
    console.error('Delete department error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /admin/departments/:id/members — assign an internal user
// ------------------------------------------------------------
router.post('/:id/members', async (req: Request, res: Response) => {
  try {
    const { user_id } = memberSchema.parse(req.body);

    // Defensive: only internal team members can join departments (UI only offers internal).
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, avatar_url, user_type')
      .eq('id', user_id)
      .maybeSingle();

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    if ((user as any).user_type !== 'internal') {
      res.status(400).json({ success: false, error: 'Only internal team members can be assigned to departments' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('department_members')
      .insert({ department_id: req.params.id, user_id })
      .select()
      .single();

    if (error) {
      const status = error.code === '23505' ? 409 : 500;
      res.status(status).json({ success: false, error: error.code === '23505' ? 'User is already in this department' : error.message });
      return;
    }

    const u = user as any;
    res.status(201).json({
      success: true,
      data: { ...data, user: { id: u.id, display_name: u.display_name, email: u.email, avatar_url: u.avatar_url } },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add department member error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// DELETE /admin/departments/:id/members/:userId — unassign
// ------------------------------------------------------------
router.delete('/:id/members/:userId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('department_members')
      .delete()
      .eq('department_id', req.params.id)
      .eq('user_id', req.params.userId);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Remove department member error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
