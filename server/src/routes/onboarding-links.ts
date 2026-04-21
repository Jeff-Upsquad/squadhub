import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';
import { getUserRoleIds, getUserIdsByRoleId } from '../utils/roles';

const router = Router();

router.use(requireAuth);

// Gate: require the user to have access to the 'sales-leads' mini app —
// either via ANY of their roles (primary or secondary) OR a direct user grant.
async function requireSalesLeadsAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.userId!;

  const { data: app } = await supabaseAdmin
    .from('mini_apps')
    .select('id')
    .eq('slug', 'sales-leads')
    .eq('is_enabled', true)
    .single();

  if (!app) {
    res.status(403).json({ success: false, error: 'Sales Leads mini app is not available' });
    return;
  }

  const roleIds = await getUserRoleIds(userId);

  if (roleIds.length > 0) {
    const { data: roleGrant } = await supabaseAdmin
      .from('mini_app_role_access')
      .select('id')
      .eq('mini_app_id', app.id)
      .in('role_id', roleIds)
      .limit(1);
    if (roleGrant && roleGrant.length > 0) {
      (req as any).salesLeadsAppId = app.id;
      next();
      return;
    }
  }

  const { data: userGrant } = await supabaseAdmin
    .from('mini_app_user_access')
    .select('id')
    .eq('mini_app_id', app.id)
    .eq('user_id', userId)
    .maybeSingle();

  if (userGrant) {
    (req as any).salesLeadsAppId = app.id;
    next();
    return;
  }

  res.status(403).json({ success: false, error: 'You do not have access to Sales Leads' });
}

// Return IDs of users eligible to be sales persons — mirrors the gate for the
// sales-leads mini app: any user reachable through ANY role granted access to
// the app (primary or secondary role), PLUS any direct user grant. If
// `includeUserId` is passed, that user is always added — guarantees the
// creator of a link can pick themselves even if role/grant lookups miss them.
async function getEligibleSalesUserIds(includeUserId?: string): Promise<string[]> {
  const { data: app } = await supabaseAdmin
    .from('mini_apps')
    .select('id')
    .eq('slug', 'sales-leads')
    .single();
  if (!app) return [];

  const ids = new Set<string>();

  const { data: roleGrants } = await supabaseAdmin
    .from('mini_app_role_access')
    .select('role_id')
    .eq('mini_app_id', app.id);

  for (const row of roleGrants || []) {
    if (!row.role_id) continue;
    const roleUsers = await getUserIdsByRoleId(row.role_id as string);
    roleUsers.forEach((u) => ids.add(u));
  }

  const { data: directGrants } = await supabaseAdmin
    .from('mini_app_user_access')
    .select('user_id')
    .eq('mini_app_id', app.id);
  (directGrants || []).forEach((g: any) => g.user_id && ids.add(g.user_id));

  if (includeUserId) ids.add(includeUserId);

  return Array.from(ids);
}

async function fetchSalesPeople(userIds: string[]) {
  if (userIds.length === 0) return [];
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, display_name, email, avatar_url')
    .in('id', userIds)
    .eq('status', 'active')
    .order('display_name');
  return data || [];
}

async function hydrateSalesPeople(userIds: Array<string | null | undefined>) {
  const ids = Array.from(new Set(userIds.filter((x): x is string => !!x)));
  if (ids.length === 0) return {} as Record<string, any>;
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, display_name, email, avatar_url')
    .in('id', ids);
  const map: Record<string, any> = {};
  (data || []).forEach((u: any) => { map[u.id] = u; });
  return map;
}

function deriveLinkStatus(link: { submission_id: string | null; expires_at: string }) {
  if (link.submission_id) return 'used' as const;
  if (new Date(link.expires_at).getTime() < Date.now()) return 'expired' as const;
  return 'active' as const;
}

function buildOnboardUrl(token: string) {
  const base = process.env.WEB_APP_URL
    || (process.env.NODE_ENV === 'production' ? 'https://squadhub.in' : 'http://localhost:3000');
  return `${base.replace(/\/$/, '')}/onboard/${token}`;
}

// ============================================================
// GET /onboarding-links/sales-people — list eligible sales people
// ============================================================
router.get('/sales-people', requireSalesLeadsAccess, async (req: Request, res: Response) => {
  try {
    const ids = await getEligibleSalesUserIds(req.userId!);
    const people = await fetchSalesPeople(ids);
    res.json({ success: true, data: people });
  } catch (err) {
    console.error('List sales people error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// POST /onboarding-links — create a 7-day single-use link
// ============================================================
const createLinkSchema = z.object({
  primary_sales_person_id: z.string().uuid().optional(),
  secondary_sales_person_id: z.string().uuid().nullable().optional(),
});

router.post('/', requireSalesLeadsAccess, async (req: Request, res: Response) => {
  try {
    const body = createLinkSchema.parse(req.body);
    const userId = req.userId!;

    const eligibleIds = new Set(await getEligibleSalesUserIds(userId));

    const primaryId = body.primary_sales_person_id || userId;
    if (!eligibleIds.has(primaryId)) {
      res.status(400).json({ success: false, error: 'Primary sales person is not in the Sales pool' });
      return;
    }
    if (body.secondary_sales_person_id && !eligibleIds.has(body.secondary_sales_person_id)) {
      res.status(400).json({ success: false, error: 'Secondary sales person is not in the Sales pool' });
      return;
    }
    if (body.secondary_sales_person_id && body.secondary_sales_person_id === primaryId) {
      res.status(400).json({ success: false, error: 'Secondary sales person must differ from primary' });
      return;
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('client_onboarding_links')
      .insert({
        created_by: userId,
        primary_sales_person_id: primaryId,
        secondary_sales_person_id: body.secondary_sales_person_id || null,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error || !data) {
      res.status(500).json({ success: false, error: error?.message || 'Failed to create link' });
      return;
    }

    res.json({
      success: true,
      data: {
        ...data,
        url: buildOnboardUrl(data.id),
        status: deriveLinkStatus(data),
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create onboarding link error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// GET /onboarding-links/my — links the current user created
// ============================================================
router.get('/my', requireSalesLeadsAccess, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { data: links, error } = await supabaseAdmin
      .from('client_onboarding_links')
      .select('*')
      .eq('created_by', userId)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const peopleMap = await hydrateSalesPeople(
      (links || []).flatMap((l: any) => [l.primary_sales_person_id, l.secondary_sales_person_id, l.created_by]),
    );

    const enriched = (links || []).map((l: any) => ({
      ...l,
      url: buildOnboardUrl(l.id),
      status: deriveLinkStatus(l),
      primary_sales_person: peopleMap[l.primary_sales_person_id] || null,
      secondary_sales_person: l.secondary_sales_person_id ? peopleMap[l.secondary_sales_person_id] || null : null,
      created_by_user: peopleMap[l.created_by] || null,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('List my onboarding links error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// GET /onboarding-links/leads — submissions where current user is primary OR secondary SP
// ============================================================
router.get('/leads', requireSalesLeadsAccess, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;

    const { data: leads, error } = await supabaseAdmin
      .from('client_submissions')
      .select('*')
      .or(`primary_sales_person_id.eq.${userId},secondary_sales_person_id.eq.${userId}`)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const peopleMap = await hydrateSalesPeople(
      (leads || []).flatMap((l: any) => [l.primary_sales_person_id, l.secondary_sales_person_id]),
    );

    const enriched = (leads || []).map((l: any) => ({
      ...l,
      primary_sales_person: l.primary_sales_person_id ? peopleMap[l.primary_sales_person_id] || null : null,
      secondary_sales_person: l.secondary_sales_person_id ? peopleMap[l.secondary_sales_person_id] || null : null,
      my_role: l.primary_sales_person_id === userId ? 'primary' : 'secondary',
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('List leads error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export { requireSalesLeadsAccess, getEligibleSalesUserIds, fetchSalesPeople, hydrateSalesPeople, deriveLinkStatus, buildOnboardUrl };
export default router;
