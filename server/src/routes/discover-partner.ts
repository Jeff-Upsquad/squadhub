import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PARTNER_USER_TYPES } from '@squadhub/shared';
import { config } from '../config';
import { requireAuth } from '../middleware/auth';
import { requireUserType } from '../middleware/userType';

const router = Router();
const FETCH_TIMEOUT_MS = 15_000;
const productTypes = ['subscription', 'assignment', 'hiring'] as const;

router.use(requireAuth, requireUserType(...PARTNER_USER_TYPES));

router.get('/opportunities', async (req: Request, res: Response) => {
  if (!req.userEmail) {
    res.status(400).json({ success: false, error: 'Your account has no email address.' });
    return;
  }

  try {
    const groups = await Promise.all(
      productTypes.map((cardType) => fetchCanonicalCards(req.userEmail!, cardType)),
    );
    const data = groups.flat().map((item) => adaptCanonicalCard(item, req.userId!));
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('[discover-partner] opportunity fetch failed:', err?.message);
    res.status(err?.status || 502).json({
      success: false,
      error: err?.message || 'Could not load SquadHire opportunities.',
    });
  }
});

const respondSchema = z.object({ action: z.enum(['accept', 'reject']) });
const offerAmountSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().trim().min(1).max(8).optional(),
  period: z.enum(['project', 'per_month', 'per_week', 'per_day', 'per_hour', 'per_design', 'per_video']).optional(),
  pricing_basis: z.enum(['project', 'per_unit']).optional(),
  unit: z.enum(['design', 'video']).optional(),
  quantity: z.number().int().min(1).max(999).optional(),
});
const submitOfferSchema = z.object({
  amount: offerAmountSchema,
  terms: z.record(z.unknown()).optional(),
  note: z.string().trim().max(2000).optional(),
});
const offerRespondSchema = z.object({
  action: z.enum(['accept', 'decline', 'withdraw']),
  note: z.string().trim().max(2000).optional(),
});

router.patch('/opportunities/:recipientId/respond', async (req: Request, res: Response) => {
  if (!req.userEmail) {
    res.status(400).json({ success: false, error: 'Your account has no email address.' });
    return;
  }

  const parsed = respondSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    return;
  }

  try {
    const url = squadhireUrl(`/api/integrations/squadhub/talent/workspace/cards/${encodeURIComponent(req.params.recipientId as string)}/respond`);
    const upstream = await fetch(url, {
      method: 'PATCH',
      headers: signedHeaders(),
      body: JSON.stringify({ email: req.userEmail, action: parsed.data.action }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = await readJson(upstream);
    if (!upstream.ok) throw upstreamError(upstream.status, body);
    res.json(body);
  } catch (err: any) {
    console.error('[discover-partner] opportunity response failed:', err?.message);
    res.status(err?.status || 502).json({
      success: false,
      error: err?.message || 'Could not save your response.',
    });
  }
});

router.get('/opportunities/:recipientId/offer', async (req: Request, res: Response) => {
  if (!req.userEmail) {
    res.status(400).json({ success: false, error: 'Your account has no email address.' });
    return;
  }
  try {
    const path = `/api/integrations/squadhub/talent/workspace/cards/${encodeURIComponent(req.params.recipientId as string)}/offer`;
    const url = new URL(squadhireUrl(path));
    url.searchParams.set('email', req.userEmail);
    const upstream = await fetch(url, {
      headers: signedHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = await readJson(upstream);
    if (!upstream.ok) throw upstreamError(upstream.status, body);
    res.json(body);
  } catch (err: any) {
    console.error('[discover-partner] offer fetch failed:', err?.message);
    res.status(err?.status || 502).json({ success: false, error: err?.message || 'Could not load offer activity.' });
  }
});

router.post('/opportunities/:recipientId/offer', async (req: Request, res: Response) => {
  if (!req.userEmail) {
    res.status(400).json({ success: false, error: 'Your account has no email address.' });
    return;
  }
  const parsed = submitOfferSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    return;
  }
  await proxyOfferWrite(req, res, '/offer', { email: req.userEmail, ...parsed.data });
});

router.post('/opportunities/:recipientId/offer/respond', async (req: Request, res: Response) => {
  if (!req.userEmail) {
    res.status(400).json({ success: false, error: 'Your account has no email address.' });
    return;
  }
  const parsed = offerRespondSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    return;
  }
  await proxyOfferWrite(req, res, '/offer/respond', { email: req.userEmail, ...parsed.data });
});

async function proxyOfferWrite(req: Request, res: Response, suffix: string, body: Record<string, unknown>) {
  try {
    const path = `/api/integrations/squadhub/talent/workspace/cards/${encodeURIComponent(req.params.recipientId as string)}${suffix}`;
    const upstream = await fetch(squadhireUrl(path), {
      method: 'POST',
      headers: signedHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const responseBody = await readJson(upstream);
    if (!upstream.ok) throw upstreamError(upstream.status, responseBody);
    res.json(responseBody);
  } catch (err: any) {
    console.error('[discover-partner] offer action failed:', err?.message);
    res.status(err?.status || 502).json({ success: false, error: err?.message || 'Could not save the offer.' });
  }
}

async function fetchCanonicalCards(email: string, cardType: typeof productTypes[number]) {
  const url = new URL(squadhireUrl('/api/integrations/squadhub/talent/workspace/cards'));
  url.searchParams.set('email', email);
  url.searchParams.set('status', 'all');
  url.searchParams.set('card_type', cardType);
  const upstream = await fetch(url, {
    headers: signedHeaders(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await readJson(upstream);
  if (!upstream.ok) throw upstreamError(upstream.status, body);
  return Array.isArray(body?.items) ? body.items : [];
}

function squadhireUrl(pathname: string) {
  if (!config.squadhireWebhookUrl || !config.squadhireWebhookSecret) {
    const err = new Error('SquadHire integration is not configured.') as Error & { status?: number };
    err.status = 503;
    throw err;
  }
  const url = new URL(config.squadhireWebhookUrl);
  url.pathname = pathname;
  url.search = '';
  return url.toString();
}

function signedHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-SquadHub-Signature': config.squadhireWebhookSecret,
  };
}

async function readJson(response: globalThis.Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

function upstreamError(status: number, body: any) {
  const err = new Error(body?.error || body?.message || `SquadHire responded ${status}`) as Error & { status?: number };
  err.status = status >= 400 && status < 500 ? status : 502;
  return err;
}

function adaptCanonicalCard(item: any, partnerId: string) {
  const sourceCard = item?.card || {};
  const content = sourceCard.content && typeof sourceCard.content === 'object' ? sourceCard.content : {};
  const type = sourceCard.card_type === 'assignment' || sourceCard.card_type === 'hiring'
    ? sourceCard.card_type
    : 'subscription';
  const hours = hoursFromContent(content);
  const assignment = content.assignment_details && typeof content.assignment_details === 'object'
    ? content.assignment_details
    : content;

  return {
    id: item.id,
    card_id: sourceCard.id,
    partner_id: partnerId,
    status: item.status,
    responded_at: item.responded_at || null,
    created_at: sourceCard.published_at || item.created_at || new Date(0).toISOString(),
    source: 'squadhire',
    card: {
      id: sourceCard.id,
      state: sourceCard.status === 'assigned' ? 'assigned' : sourceCard.status === 'archived' ? 'closed' : 'published',
      card_type: type,
      working_days: Array.isArray(content.working_days) ? content.working_days : [],
      brand_name: content.brand_name || null,
      business_nature: content.business_nature || null,
      notes: content.notes || null,
      requirement_note: content.requirement_note || null,
      target_tiers: [],
      min_experience_years: Number(content.min_experience_years) || 0,
      target_languages: Array.isArray(content.target_languages) ? content.target_languages : [],
      additional_requirements: content.additional_requirements || null,
      partner_price_override: numeric(content.monthly_price),
      proposed_price: numeric(content.monthly_price),
      published_at: sourceCard.published_at || null,
      expires_at: sourceCard.expires_at || content.expires_at || null,
      assignment_details: type === 'assignment' ? {
        duration: assignment.duration || content.timeline || null,
        start_date: assignment.start_date || content.start_date || null,
        deadline: assignment.deadline || content.deadline || null,
        scope_type: assignment.scope_type || null,
        pricing_mode: assignment.pricing_mode || 'priced',
        request_type: assignment.request_type || 'fixed',
        work_type: assignment.work_type || null,
        pricing_basis: assignment.pricing_basis || 'project',
        unit: assignment.unit || null,
        quantity: assignment.quantity || null,
      } : null,
      source_content: content,
      job_profile_id: item.job_profile_id || null,
      funnel_stage: item.funnel_stage || null,
      submission: {
        business_name: content.brand_name || content.business_name || null,
      },
      submission_subscription: {
        subscription: {
          name: content.subscription_name || content.title || (type === 'hiring' ? 'Job opening' : type === 'assignment' ? 'Assignment' : 'Subscription'),
        },
        plan: {
          plan: content.plan_name || '',
          tier: content.tier || '',
          daily_hours: hours.daily,
          weekly_hours: hours.weekly,
          monthly_hours: hours.monthly,
        },
      },
    },
  };
}

function numeric(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function hoursFromContent(content: Record<string, any>) {
  let daily = numeric(content.daily_hours);
  let weekly = numeric(content.weekly_hours);
  let monthly = numeric(content.monthly_hours);
  const deliverables = Array.isArray(content.custom_deliverables) ? content.custom_deliverables : [];
  for (const deliverable of deliverables) {
    if (!deliverable || typeof deliverable !== 'object' || deliverable.kind !== 'hours') continue;
    daily ??= numeric(deliverable.per_day);
    weekly ??= numeric(deliverable.per_week);
    monthly ??= numeric(deliverable.per_month);
  }
  const label = typeof content.hours_label === 'string' ? content.hours_label : '';
  const match = label.match(/([\d.]+)\s*hr?s?\s*\/\s*(day|week|month)/i);
  if (match) {
    const value = numeric(match[1]);
    if (match[2].toLowerCase() === 'day') daily ??= value;
    if (match[2].toLowerCase() === 'week') weekly ??= value;
    if (match[2].toLowerCase() === 'month') monthly ??= value;
  }
  return { daily, weekly, monthly };
}

export default router;
