import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { ALL_CANDIDATE_CATEGORIES } from '../utils/candidateCategories';

/**
 * Admin surface for candidate category access — which of Creative / Accountant
 * / Sales each role or user may see in the Candidates mini app. Writes the
 * candidate_category_access table; the candidates proxy enforces it.
 *
 * A subject (role or user) with NO rows is unrestricted (sees all categories).
 * Grant rows narrow them to exactly the listed categories.
 */

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const categoriesSchema = z.object({
  categories: z.array(z.enum(ALL_CANDIDATE_CATEGORIES)).default([]),
});

// GET /admin/candidate-access — pickers + current grants for the matrix UI.
router.get('/', async (_req: Request, res: Response) => {
  try {
    const [{ data: roles }, { data: users }, { data: grants }] = await Promise.all([
      supabaseAdmin.from('roles').select('id, name').order('name'),
      supabaseAdmin
        .from('users')
        .select('id, email, display_name, user_type')
        .eq('user_type', 'internal')
        .order('display_name'),
      supabaseAdmin.from('candidate_category_access').select('category, role_id, user_id'),
    ]);

    const roleGrants: Record<string, string[]> = {};
    const userGrants: Record<string, string[]> = {};
    for (const g of grants || []) {
      if (g.role_id) (roleGrants[g.role_id] ||= []).push(g.category);
      else if (g.user_id) (userGrants[g.user_id] ||= []).push(g.category);
    }

    res.json({
      success: true,
      data: { categories: ALL_CANDIDATE_CATEGORIES, roles: roles || [], users: users || [], roleGrants, userGrants },
    });
  } catch (err) {
    console.error('candidate-access list error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/** Replace the full set of categories granted to a subject (role or user). */
async function replaceGrants(
  subject: { role_id: string } | { user_id: string },
  categories: string[],
  res: Response,
) {
  const column = 'role_id' in subject ? 'role_id' : 'user_id';
  const id = 'role_id' in subject ? subject.role_id : subject.user_id;

  const del = await supabaseAdmin.from('candidate_category_access').delete().eq(column, id);
  if (del.error) {
    res.status(500).json({ success: false, error: del.error.message });
    return;
  }
  if (categories.length > 0) {
    const rows = categories.map((category) => ({ category, ...subject }));
    const ins = await supabaseAdmin.from('candidate_category_access').insert(rows);
    if (ins.error) {
      res.status(500).json({ success: false, error: ins.error.message });
      return;
    }
  }
  res.json({ success: true, data: { categories } });
}

// PUT /admin/candidate-access/role/:roleId  { categories: [...] }
router.put('/role/:roleId', async (req: Request, res: Response) => {
  const parsed = categoriesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid categories' });
    return;
  }
  await replaceGrants({ role_id: String(req.params.roleId) }, parsed.data.categories, res);
});

// PUT /admin/candidate-access/user/:userId  { categories: [...] }
router.put('/user/:userId', async (req: Request, res: Response) => {
  const parsed = categoriesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid categories' });
    return;
  }
  await replaceGrants({ user_id: String(req.params.userId) }, parsed.data.categories, res);
});

export default router;
