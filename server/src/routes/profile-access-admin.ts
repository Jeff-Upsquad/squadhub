import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { deliverGrantMutation, deliverGrantDelete } from '../utils/squadhireGrantsWebhook';
import { fetchSquadhireCategories } from '../utils/squadhireCategories';
import type { ProfileAccessGrant, ProfileAccessGrantStatus } from '@squadhub/shared';

/**
 * Admin CRUD for profile_access_grants — full visibility.
 *
 * Same shape as the user-facing route but without the created_by =
 * req.userId filter, so SquadHub admins see every grant including ones
 * originated on the SquadHire admin side (where created_by is NULL).
 *
 * Auth: requireAuth + requireAdmin (user_type='internal' AND is_admin=true).
 */

const router = Router();

router.use(requireAuth, requireAdmin);

const emailSchema = z.string().email().transform((s) => s.toLowerCase().trim());

const isoDateTimeSchema = z.string().refine(
  (s) => !Number.isNaN(Date.parse(s)),
  { message: 'expires_at must be a valid ISO datetime' },
);

const createSchema = z.object({
  email: emailSchema,
  category_ids: z.array(z.string().uuid()).min(1, 'Pick at least one category'),
  expires_at: isoDateTimeSchema.optional(),
  notes: z.string().max(500).optional().nullable(),
});

const updateSchema = z
  .object({
    category_ids: z.array(z.string().uuid()).min(1).optional(),
    expires_at: isoDateTimeSchema.optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

const extendSchema = z.object({
  days: z.number().int().min(1).max(365),
});

const listQuerySchema = z.object({
  status: z.enum(['active', 'expired', 'revoked', 'all']).default('active'),
  search: z.string().optional(),
});

function defaultExpiry(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 5);
  d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}

function computeStatus(row: { expires_at: string; revoked_at: string | null }): ProfileAccessGrantStatus {
  if (row.revoked_at) return 'revoked';
  if (Date.parse(row.expires_at) < Date.now()) return 'expired';
  return 'active';
}

async function hydrateCategories(rows: any[]): Promise<ProfileAccessGrant[]> {
  if (rows.length === 0) return [];
  const allIds = new Set<string>();
  for (const r of rows) {
    for (const id of (r.category_ids ?? []) as string[]) allIds.add(id);
  }
  let lookup = new Map<string, { id: string; name: string; slug: string }>();
  if (allIds.size > 0) {
    try {
      const { data: cats } = await fetchSquadhireCategories();
      lookup = new Map(cats.map((c) => [c.id, { id: c.id, name: c.name, slug: c.slug }]));
    } catch (err) {
      console.warn('[profile-access-admin] categories hydration failed:', err);
    }
  }
  return rows.map((r) => ({
    ...r,
    status: computeStatus(r),
    categories: ((r.category_ids ?? []) as string[]).map(
      (id) => lookup.get(id) ?? { id, name: id, slug: id },
    ),
  }));
}

function applyStatusFilter(rows: any[], status: 'active' | 'expired' | 'revoked' | 'all'): any[] {
  if (status === 'all') return rows;
  return rows.filter((r) => computeStatus(r) === status);
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, search } = listQuerySchema.parse(req.query);
    let q = supabaseAdmin
      .from('profile_access_grants')
      .select('*')
      .order('created_at', { ascending: false });
    if (search && search.trim().length > 0) {
      q = q.ilike('email', `%${search.trim().toLowerCase()}%`);
    }
    const { data, error } = await q;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    const filtered = applyStatusFilter(data ?? [], status);
    const hydrated = await hydrateCategories(filtered);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('profile_access_grants')
      .insert({
        email: body.email,
        category_ids: body.category_ids,
        expires_at: body.expires_at ?? defaultExpiry(),
        notes: body.notes ?? null,
        // Admins create grants on behalf of the system, not on behalf of a
        // particular salesperson. Leaving created_by NULL keeps these out of
        // any user's user-app view.
        created_by: null,
      })
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    deliverGrantMutation(data.id, 'create').catch((e) =>
      console.error('[profile-access-admin] sync failed', e),
    );
    const hydrated = (await hydrateCategories([data]))[0];
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const body = updateSchema.parse(req.body);
    const patch: Record<string, unknown> = {};
    if (body.category_ids !== undefined) patch.category_ids = body.category_ids;
    if (body.expires_at !== undefined) patch.expires_at = body.expires_at;
    if (body.notes !== undefined) patch.notes = body.notes;
    const { data, error } = await supabaseAdmin
      .from('profile_access_grants')
      .update(patch)
      .eq('id', (req.params.id as string))
      .select('*')
      .maybeSingle();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ success: false, error: 'Grant not found' });
      return;
    }
    deliverGrantMutation(data.id, 'update').catch((e) =>
      console.error('[profile-access-admin] sync failed', e),
    );
    const hydrated = (await hydrateCategories([data]))[0];
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
});

router.post('/:id/extend', async (req: Request, res: Response) => {
  try {
    const { days } = extendSchema.parse(req.body);
    const { data: existing } = await supabaseAdmin
      .from('profile_access_grants')
      .select('expires_at')
      .eq('id', (req.params.id as string))
      .maybeSingle();
    if (!existing) {
      res.status(404).json({ success: false, error: 'Grant not found' });
      return;
    }
    const base = Date.parse(existing.expires_at) > Date.now() ? new Date(existing.expires_at) : new Date();
    base.setUTCDate(base.getUTCDate() + days);
    base.setUTCHours(23, 59, 59, 999);
    const { data, error } = await supabaseAdmin
      .from('profile_access_grants')
      .update({ expires_at: base.toISOString() })
      .eq('id', (req.params.id as string))
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    deliverGrantMutation(data.id, 'update').catch((e) =>
      console.error('[profile-access-admin] sync failed', e),
    );
    const hydrated = (await hydrateCategories([data]))[0];
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
});

router.patch('/:id/revoke', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('profile_access_grants')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', (req.params.id as string))
      .select('*')
      .maybeSingle();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ success: false, error: 'Grant not found' });
      return;
    }
    deliverGrantMutation(data.id, 'revoke').catch((e) =>
      console.error('[profile-access-admin] sync failed', e),
    );
    const hydrated = (await hydrateCategories([data]))[0];
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { data: existing } = await supabaseAdmin
      .from('profile_access_grants')
      .select('profiles_grant_id')
      .eq('id', (req.params.id as string))
      .maybeSingle();
    if (!existing) {
      res.status(404).json({ success: false, error: 'Grant not found' });
      return;
    }
    const profilesGrantId = (existing.profiles_grant_id as string | null) ?? null;
    const { error } = await supabaseAdmin
      .from('profile_access_grants')
      .delete()
      .eq('id', (req.params.id as string));
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    deliverGrantDelete(profilesGrantId).catch((e) =>
      console.error('[profile-access-admin] sync failed', e),
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
});

export default router;
