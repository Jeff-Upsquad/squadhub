import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { requireMiniAppOrAdmin } from '../middleware/miniApp';
import { supabaseAdmin } from '../supabase';
import {
  getEligibleSalesUserIds,
  fetchSalesPeople,
  hydrateSalesPeople,
  deriveLinkStatus,
  buildOnboardUrl,
} from './onboarding-links';

const router = Router();

router.use(requireAuth);

// This router is admin-only by default. The one exception is the sales-people
// pool, which the Leads mini app reads to populate its "Published by" filter —
// so it also accepts the 'leads' grant. Everything else stays admin-only.
const LEADS_READABLE = new Set(['/sales-people']);
router.use((req, res, next) =>
  req.method === 'GET' && LEADS_READABLE.has(req.path)
    ? requireMiniAppOrAdmin('leads')(req, res, next)
    : requireAdmin(req, res, next),
);

// GET /admin/onboarding-links/sales-people — admin can always see the pool
router.get('/sales-people', async (_req: Request, res: Response) => {
  try {
    const ids = await getEligibleSalesUserIds();
    const people = await fetchSalesPeople(ids);
    res.json({ success: true, data: people });
  } catch (err) {
    console.error('Admin list sales people error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/onboarding-links — create a link as admin (can pick any sales person)
const createLinkSchema = z.object({
  primary_sales_person_id: z.string().uuid().optional(),
  secondary_sales_person_id: z.string().uuid().nullable().optional(),
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createLinkSchema.parse(req.body);
    const userId = req.userId!;

    const eligibleIds = new Set(await getEligibleSalesUserIds());

    const primaryId = body.primary_sales_person_id || userId;
    if (!eligibleIds.has(primaryId)) {
      res.status(400).json({
        success: false,
        error: 'Primary sales person must be a user with access to the Sales Leads mini app',
      });
      return;
    }
    if (body.secondary_sales_person_id && !eligibleIds.has(body.secondary_sales_person_id)) {
      res.status(400).json({
        success: false,
        error: 'Secondary sales person must be a user with access to the Sales Leads mini app',
      });
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
    console.error('Admin create onboarding link error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/onboarding-links — list all links (admin)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data: links, error } = await supabaseAdmin
      .from('client_onboarding_links')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const peopleMap = await hydrateSalesPeople(
      (links || []).flatMap((l: any) => [l.primary_sales_person_id, l.secondary_sales_person_id, l.created_by]),
    );

    const submissionIds = Array.from(new Set((links || []).map((l: any) => l.submission_id).filter(Boolean)));
    let submissionsMap: Record<string, any> = {};
    if (submissionIds.length > 0) {
      const { data: subs } = await supabaseAdmin
        .from('client_submissions')
        .select('id, business_name, contact_person, email, status, created_at')
        .in('id', submissionIds);
      (subs || []).forEach((s: any) => { submissionsMap[s.id] = s; });
    }

    const enriched = (links || []).map((l: any) => ({
      ...l,
      url: buildOnboardUrl(l.id),
      status: deriveLinkStatus(l),
      primary_sales_person: peopleMap[l.primary_sales_person_id] || null,
      secondary_sales_person: l.secondary_sales_person_id ? peopleMap[l.secondary_sales_person_id] || null : null,
      created_by_user: peopleMap[l.created_by] || null,
      submission: l.submission_id ? submissionsMap[l.submission_id] || null : null,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Admin list onboarding links error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
