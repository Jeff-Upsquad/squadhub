import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';
import { getUserRoleIds, getUserIdsByRoleId } from '../utils/roles';
import { hydrateSubscription } from '../utils/subscriptions';
import { hydrateStagedSubscriptions } from '../utils/stagedSubscriptions';
import {
  PIPELINE_STATUSES,
  isPipelineStatus,
  transitionSubmissionStatus,
} from '../utils/submissionPipeline';

const router = Router();

router.use(requireAuth);

// Gate: require the user to have access to the 'sales-leads' mini app —
// either via ANY of their roles (primary or secondary) OR a direct user grant.
export async function requireSalesLeadsAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
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

// Guard that resolves a lead and verifies the caller is primary or secondary SP.
export async function resolveLeadForUser(leadId: string, userId: string) {
  const { data: submission, error } = await supabaseAdmin
    .from('client_submissions')
    .select('*')
    .eq('id', leadId)
    .maybeSingle();

  if (error) return { ok: false as const, code: 500, error: error.message };
  if (!submission) return { ok: false as const, code: 404, error: 'Lead not found' };

  if (submission.primary_sales_person_id !== userId && submission.secondary_sales_person_id !== userId) {
    return { ok: false as const, code: 403, error: 'You do not have access to this lead' };
  }
  return { ok: true as const, submission };
}

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

    const list = leads || [];
    const peopleMap = await hydrateSalesPeople(
      list.flatMap((l: any) => [l.primary_sales_person_id, l.secondary_sales_person_id]),
    );
    const stagedMap = await hydrateStagedSubscriptions(list.map((l: any) => l.id));

    const enriched = list.map((l: any) => ({
      ...l,
      primary_sales_person: l.primary_sales_person_id ? peopleMap[l.primary_sales_person_id] || null : null,
      secondary_sales_person: l.secondary_sales_person_id ? peopleMap[l.secondary_sales_person_id] || null : null,
      my_role: l.primary_sales_person_id === userId ? 'primary' : 'secondary',
      selected_subscriptions: stagedMap[l.id] || [],
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('List leads error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// PATCH /onboarding-links/leads/:id/status — sales person updates pipeline status
// ============================================================
const statusSchema = z.object({
  status: z.enum(PIPELINE_STATUSES),
});

router.patch('/leads/:id/status', requireSalesLeadsAccess, async (req: Request, res: Response) => {
  try {
    const body = statusSchema.parse(req.body);
    const guard = await resolveLeadForUser(req.params.id as string, req.userId!);
    if (!guard.ok) {
      res.status(guard.code).json({ success: false, error: guard.error });
      return;
    }

    const result = await transitionSubmissionStatus(req.params.id as string, body.status);
    if (!result.ok) {
      res.status(result.code).json({ success: false, error: result.error });
      return;
    }

    res.json({ success: true, data: { status: result.status, client_id: result.clientId } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update lead status error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// PATCH /onboarding-links/leads/:id/country — update billing country on a lead
// ============================================================
const countrySchema = z.object({ country_id: z.string().uuid() });

router.patch('/leads/:id/country', requireSalesLeadsAccess, async (req: Request, res: Response) => {
  try {
    const body = countrySchema.parse(req.body);
    const guard = await resolveLeadForUser(req.params.id as string, req.userId!);
    if (!guard.ok) {
      res.status(guard.code).json({ success: false, error: guard.error });
      return;
    }
    if (guard.submission.status === 'converted' || guard.submission.status === 'closed') {
      res.status(409).json({ success: false, error: 'Cannot change billing country on a converted or closed lead' });
      return;
    }

    const { data: country } = await supabaseAdmin
      .from('countries')
      .select('id, is_active')
      .eq('id', body.country_id)
      .maybeSingle();
    if (!country || !country.is_active) {
      res.status(400).json({ success: false, error: 'Country not found or inactive' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('client_submissions')
      .update({ country_id: body.country_id })
      .eq('id', req.params.id as string);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: { country_id: body.country_id } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update lead country error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// GET /onboarding-links/leads/:id/subscriptions — list staged subscriptions on a lead
// ============================================================
router.get('/leads/:id/subscriptions', requireSalesLeadsAccess, async (req: Request, res: Response) => {
  try {
    const guard = await resolveLeadForUser(req.params.id as string, req.userId!);
    if (!guard.ok) {
      res.status(guard.code).json({ success: false, error: guard.error });
      return;
    }

    const leadId = req.params.id as string;
    const map = await hydrateStagedSubscriptions([leadId]);
    res.json({ success: true, data: map[leadId] || [] });
  } catch (err) {
    console.error('List staged subs error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// POST /onboarding-links/leads/:id/subscriptions — add a (subscription, plan) row
// ============================================================
const addStagedSubSchema = z.object({
  subscription_id: z.string().uuid(),
  plan_id: z.string().uuid(),
});

router.post('/leads/:id/subscriptions', requireSalesLeadsAccess, async (req: Request, res: Response) => {
  try {
    const body = addStagedSubSchema.parse(req.body);
    const guard = await resolveLeadForUser(req.params.id as string, req.userId!);
    if (!guard.ok) {
      res.status(guard.code).json({ success: false, error: guard.error });
      return;
    }

    if (guard.submission.status === 'converted' || guard.submission.status === 'closed') {
      res.status(409).json({ success: false, error: 'Cannot edit subscriptions on a converted or closed lead' });
      return;
    }

    // Validate plan belongs to subscription.
    const { data: plan } = await supabaseAdmin
      .from('subscription_plans')
      .select('id, subscription_id, is_active')
      .eq('id', body.plan_id)
      .maybeSingle();
    if (!plan || plan.subscription_id !== body.subscription_id) {
      res.status(400).json({ success: false, error: 'Plan does not belong to the given subscription' });
      return;
    }
    if (!plan.is_active) {
      res.status(400).json({ success: false, error: 'Plan is inactive' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('client_submission_subscriptions')
      .insert({
        submission_id: req.params.id as string,
        subscription_id: body.subscription_id,
        plan_id: body.plan_id,
      })
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
    console.error('Add staged sub error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// DELETE /onboarding-links/leads/:id/subscriptions/:rowId — remove a staged row
// ============================================================
router.delete('/leads/:id/subscriptions/:rowId', requireSalesLeadsAccess, async (req: Request, res: Response) => {
  try {
    const guard = await resolveLeadForUser(req.params.id as string, req.userId!);
    if (!guard.ok) {
      res.status(guard.code).json({ success: false, error: guard.error });
      return;
    }

    if (guard.submission.status === 'converted' || guard.submission.status === 'closed') {
      res.status(409).json({ success: false, error: 'Cannot edit subscriptions on a converted or closed lead' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('client_submission_subscriptions')
      .delete()
      .eq('id', req.params.rowId)
      .eq('submission_id', req.params.id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete staged sub error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// POST /onboarding-links/leads/:id/subscriptions/:rowId/cancel
//
// Lifecycle-aware "Cancel" used by the Sales Leads UI:
//   - no card / state='draft'   → delete the staged subscription (existing
//     destructive behaviour, mirrors the DELETE above)
//   - state='published'         → close the card (state='closed', closed_at)
//                                 so it stays in history and lands in the
//                                 "Cancelled" group on the Published cards tab
//   - state='closed'            → 409 (already cancelled)
// ============================================================
router.post('/leads/:id/subscriptions/:rowId/cancel', requireSalesLeadsAccess, async (req: Request, res: Response) => {
  try {
    const guard = await resolveLeadForUser(req.params.id as string, req.userId!);
    if (!guard.ok) {
      res.status(guard.code).json({ success: false, error: guard.error });
      return;
    }
    if (guard.submission.status === 'converted' || guard.submission.status === 'closed') {
      res.status(409).json({ success: false, error: 'Cannot edit subscriptions on a converted or closed lead' });
      return;
    }

    const rowId = req.params.rowId as string;
    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state')
      .eq('submission_subscription_id', rowId)
      .maybeSingle();

    if (!card || card.state === 'draft') {
      const { error } = await supabaseAdmin
        .from('client_submission_subscriptions')
        .delete()
        .eq('id', rowId)
        .eq('submission_id', req.params.id as string);
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
      res.json({ success: true, action: 'deleted' });
      return;
    }

    if (card.state === 'closed') {
      res.status(409).json({ success: false, error: 'Card is already cancelled' });
      return;
    }

    // state === 'published' → close the card. Reset SquadHire sync state so
    // the archived-delivery is re-attempted, mirroring the close endpoint.
    const { error: updErr } = await supabaseAdmin
      .from('subscription_cards')
      .update({
        state: 'closed',
        closed_at: new Date().toISOString(),
        squadhire_synced_at: null,
        squadhire_sync_attempts: 0,
        squadhire_sync_last_error: null,
      })
      .eq('id', card.id);
    if (updErr) {
      res.status(500).json({ success: false, error: updErr.message });
      return;
    }

    res.json({ success: true, action: 'closed', card_id: card.id });
  } catch (err) {
    console.error('Cancel staged sub error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// GET /onboarding-links/subscriptions — read-only list for sales users
// Optionally filters pricing/plans to a given country_id.
// ============================================================
router.get('/subscriptions', requireSalesLeadsAccess, async (req: Request, res: Response) => {
  try {
    const countryId = typeof req.query.country_id === 'string' ? req.query.country_id : null;

    const { data: subs, error } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const hydrated = await Promise.all((subs || []).map((s: any) => hydrateSubscription(s.id)));
    const cleaned = hydrated.filter(Boolean).map((sub: any) => ({
      ...sub,
      plans: (sub.plans || [])
        .filter((p: any) => p.is_active)
        .map((p: any) => ({
          ...p,
          pricing: countryId ? (p.pricing || []).filter((pr: any) => pr.country_id === countryId) : (p.pricing || []),
        }))
        .filter((p: any) => !countryId || (p.pricing && p.pricing.length > 0)),
    }));

    res.json({ success: true, data: cleaned });
  } catch (err) {
    console.error('List subs for sales error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export { getEligibleSalesUserIds, fetchSalesPeople, hydrateSalesPeople, deriveLinkStatus, buildOnboardUrl };
export default router;
