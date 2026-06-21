import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { ALL_CANDIDATE_CATEGORIES } from '../utils/candidateCategories';

/**
 * Admin surface for candidate category access — who (which role or user) may see
 * each of Creative / Accountant / Sales in the Candidates mini app, and at what
 * tier (view / edit / full). Writes the candidate_category_access table; the
 * candidates proxy enforces it.
 *
 * Deny-by-default: a (non-admin) user with no matching grant — directly or via a
 * role — has no access. A user's effective tier is the highest of their direct
 * grant and any of their roles' grants for that category.
 */

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const PERMISSIONS = ['view', 'edit', 'full'] as const;

const grantSchema = z.object({
  category: z.enum(ALL_CANDIDATE_CATEGORIES),
  subject_type: z.enum(['role', 'user']),
  subject_id: z.string().uuid(),
  permission: z.enum(PERMISSIONS).default('view'),
});
const removeSchema = z.object({
  category: z.enum(ALL_CANDIDATE_CATEGORIES),
  subject_type: z.enum(['role', 'user']),
  subject_id: z.string().uuid(),
});

interface GrantRow {
  category: string;
  subject_type: 'role' | 'user';
  subject_id: string;
  subject_name: string;
  subject_email: string | null;
  permission: string;
}

// User types that may be granted candidate access via the picker. Internal staff
// plus partner_employees (e.g. external recruiters working a category). Partners
// (owner accounts) and clients are intentionally excluded.
const GRANTABLE_USER_TYPES = ['internal', 'partner_employee'] as const;

// GET /admin/candidate-access — categories, add-pickers (roles + grantable users),
// and the current grants (denormalised with subject names for the UI).
router.get('/', async (_req: Request, res: Response) => {
  try {
    const [{ data: roles }, { data: users }, { data: grants }] = await Promise.all([
      supabaseAdmin.from('roles').select('id, name').order('name'),
      supabaseAdmin
        .from('users')
        .select('id, email, display_name, user_type')
        .in('user_type', GRANTABLE_USER_TYPES as unknown as string[])
        .order('display_name'),
      supabaseAdmin.from('candidate_category_access').select('category, role_id, user_id, permission'),
    ]);

    const roleName = new Map((roles || []).map((r) => [r.id, r.name]));
    const userById = new Map((users || []).map((u) => [u.id, u]));

    const out: GrantRow[] = (grants || []).map((g) => {
      if (g.role_id) {
        return {
          category: g.category,
          subject_type: 'role',
          subject_id: g.role_id,
          subject_name: roleName.get(g.role_id) || 'Unknown role',
          subject_email: null,
          permission: g.permission,
        };
      }
      const u = userById.get(g.user_id);
      return {
        category: g.category,
        subject_type: 'user',
        subject_id: g.user_id,
        subject_name: u?.display_name || u?.email || 'Unknown user',
        subject_email: u?.email ?? null,
        permission: g.permission,
      };
    });

    res.json({
      success: true,
      data: { categories: ALL_CANDIDATE_CATEGORIES, roles: roles || [], users: users || [], grants: out },
    });
  } catch (err) {
    console.error('candidate-access list error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/candidate-access/grant — add a grant or update its tier (upsert on
// the existing (category, subject) row).
router.post('/grant', async (req: Request, res: Response) => {
  const parsed = grantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid grant' });
    return;
  }
  const { category, subject_type, subject_id, permission } = parsed.data;
  const column = subject_type === 'role' ? 'role_id' : 'user_id';

  const existing = await supabaseAdmin
    .from('candidate_category_access')
    .select('id')
    .eq('category', category)
    .eq(column, subject_id)
    .maybeSingle();
  if (existing.error) {
    res.status(500).json({ success: false, error: existing.error.message });
    return;
  }

  const result = existing.data
    ? await supabaseAdmin.from('candidate_category_access').update({ permission }).eq('id', existing.data.id)
    : await supabaseAdmin.from('candidate_category_access').insert({ category, [column]: subject_id, permission });
  if (result.error) {
    res.status(500).json({ success: false, error: result.error.message });
    return;
  }
  res.json({ success: true });
});

// DELETE /admin/candidate-access/grant — remove a grant.
router.delete('/grant', async (req: Request, res: Response) => {
  const parsed = removeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid request' });
    return;
  }
  const { category, subject_type, subject_id } = parsed.data;
  const column = subject_type === 'role' ? 'role_id' : 'user_id';
  const del = await supabaseAdmin
    .from('candidate_category_access')
    .delete()
    .eq('category', category)
    .eq(column, subject_id);
  if (del.error) {
    res.status(500).json({ success: false, error: del.error.message });
    return;
  }
  res.json({ success: true });
});

export default router;
