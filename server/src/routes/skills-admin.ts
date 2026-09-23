import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { SKILL_CATALOG, getSkillDef, type UserType } from '@squadhub/shared';

// Admin "Skills" module: grant a code-defined skill, at one of its levels, to
// users, roles, or whole user types. Mounted at /admin/skills.
const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const USER_TYPES: UserType[] = ['internal', 'client', 'client_staff', 'partner', 'partner_employee'];

// GET /admin/skills — the catalog, each skill with its grants hydrated.
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data: grants, error } = await supabaseAdmin
      .from('skill_grants')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    const rows = (grants || []) as any[];

    const userIds = rows.filter((g) => g.principal_type === 'user').map((g) => g.principal_id);
    const roleIds = rows.filter((g) => g.principal_type === 'role').map((g) => g.principal_id);
    const [{ data: users }, { data: roles }] = await Promise.all([
      userIds.length
        ? supabaseAdmin.from('users').select('id, display_name, email, avatar_url, user_type').in('id', userIds)
        : Promise.resolve({ data: [] as any[] }),
      roleIds.length
        ? supabaseAdmin.from('roles').select('id, name, color').in('id', roleIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const usersById = new Map<string, any>((users || []).map((u: any) => [u.id, u]));
    const rolesById = new Map<string, any>((roles || []).map((r: any) => [r.id, r]));

    const data = SKILL_CATALOG.map((def) => ({
      ...def,
      grants: rows
        .filter((g) => g.skill_key === def.key)
        .map((g) => ({
          ...g,
          user: g.principal_type === 'user' ? usersById.get(g.principal_id) ?? null : undefined,
          role: g.principal_type === 'role' ? rolesById.get(g.principal_id) ?? null : undefined,
        })),
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error('Admin skills list error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const grantSchema = z.object({
  principal_type: z.enum(['user', 'role', 'user_type']),
  principal_id: z.string().min(1),
  level: z.string().min(1),
});

// PUT /admin/skills/:key/grants — add a grant, or change its level.
router.put('/:key/grants', async (req: Request, res: Response) => {
  try {
    const def = getSkillDef(req.params.key as string);
    if (!def) {
      res.status(404).json({ success: false, error: 'Unknown skill' });
      return;
    }
    const body = grantSchema.parse(req.body);
    if (!def.levels.some((l) => l.value === body.level)) {
      res.status(400).json({ success: false, error: 'Unknown level for this skill' });
      return;
    }

    // The principal must exist — a typo'd id would be a grant nobody holds.
    if (body.principal_type === 'user_type') {
      if (!USER_TYPES.includes(body.principal_id as UserType)) {
        res.status(400).json({ success: false, error: 'Unknown user type' });
        return;
      }
    } else {
      const table = body.principal_type === 'user' ? 'users' : 'roles';
      const { data: found } = await supabaseAdmin
        .from(table).select('id').eq('id', body.principal_id).maybeSingle();
      if (!found) {
        res.status(404).json({ success: false, error: `${body.principal_type === 'user' ? 'User' : 'Role'} not found` });
        return;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('skill_grants')
      .upsert({
        skill_key: def.key,
        principal_type: body.principal_type,
        principal_id: body.principal_id,
        level: body.level,
        granted_by: req.userId!,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'skill_key,principal_type,principal_id' })
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
    console.error('Admin skill grant error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/skills/:key/grants/:grantId — revoke one grant.
router.delete('/:key/grants/:grantId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('skill_grants')
      .delete()
      .eq('id', req.params.grantId as string)
      .eq('skill_key', req.params.key as string);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Admin skill revoke error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
