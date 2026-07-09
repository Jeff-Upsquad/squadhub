import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { config } from '../config';
import { supabaseAdmin } from '../supabase';
import {
  buildLiveCandidates,
  rollupCountersFromCandidates,
  type LiveFunnelSnapshot,
  type MirrorCandidateRow,
} from '../utils/jobCandidateShape';
import type { JobInterview, JobOffer } from '@squadhub/shared';

/**
 * Job Cards — admin candidate/funnel actions.
 *
 * SquadHire (Profiles) is CANONICAL for per-candidate funnel data, so every
 * action here is a signed proxy to its jobs admin-mirror webhooks
 * (/api/webhooks/squadhub/jobs/*). Profiles applies the action canonically
 * and echoes an event back to our /integrations/squadhire/jobs/events
 * endpoint, which updates the local mirror — the single write path that
 * makes replays and races unable to double-apply (migration 160 header).
 *
 * Resilience mirrors routes/candidates.ts: per-call timeout, circuit
 * breaker, writes blocked while degraded, actor headers for the audit trail.
 * Reads (the candidate funnel list) come from the LOCAL mirror — they must
 * keep rendering when SquadHire is down.
 */

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const UPSTREAM_BASE_PATH = '/api/webhooks/squadhub/jobs';
const TIMEOUT_MS = 6_000;

// ---- Circuit breaker (module-level, shared across requests) -----------------
const FAILURE_THRESHOLD = 4;
const OPEN_MS = 30_000;
const breaker = { failures: 0, openUntil: 0 };
const breakerIsOpen = () => Date.now() < breaker.openUntil;
function recordSuccess() {
  breaker.failures = 0;
  breaker.openUntil = 0;
}
function recordFailure() {
  breaker.failures += 1;
  if (breaker.failures >= FAILURE_THRESHOLD) {
    breaker.openUntil = Date.now() + OPEN_MS;
    console.error(`[job-candidates] circuit breaker OPEN for ${OPEN_MS}ms after ${breaker.failures} failures`);
  }
}

function configured(): boolean {
  return !!(config.squadhireWebhookUrl && config.squadhireWebhookSecret);
}

function buildUrl(suffix: string): string {
  const url = new URL(config.squadhireWebhookUrl);
  url.pathname = `${UPSTREAM_BASE_PATH}${suffix}`;
  url.search = '';
  return url.toString();
}

// ---- Live funnel read (drives GET /:id/candidates) --------------------------
const LIVE_TIMEOUT_MS = 5_000;

/**
 * Pull the canonical candidate funnel from Profiles. Returns null on a 4xx
 * (e.g. card not found — Profiles is up, just fall back to the mirror); throws
 * on timeout / network / 5xx so the caller can trip the breaker and fall back.
 */
async function fetchLiveFunnel(externalId: string): Promise<LiveFunnelSnapshot | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const upstream = await fetch(buildUrl('/snapshot'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret,
      },
      body: JSON.stringify({ external_id: externalId, source: 'squadhub' }),
      signal: controller.signal,
    });
    if (upstream.status >= 500) throw new Error(`upstream ${upstream.status}`);
    if (!upstream.ok) return null;
    const json = (await upstream.json()) as { success?: boolean; snapshot?: LiveFunnelSnapshot };
    return json?.snapshot ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read-repair the job_cards rollup counters from live truth so the pipeline
 * list buckets self-heal when an admin opens a drifted card. Fire-and-forget:
 * a failure here must never break the candidate view. screening_started_at is
 * first-occurrence-wins (matches the event handler — contract §5).
 */
async function repairCountersFromLive(
  cardId: string,
  candidates: ReturnType<typeof buildLiveCandidates>,
  snap: LiveFunnelSnapshot,
): Promise<void> {
  try {
    const patch: Record<string, unknown> = { ...rollupCountersFromCandidates(candidates) };
    if (snap.card.screening_started_at) {
      const { data: card } = await supabaseAdmin
        .from('job_cards')
        .select('screening_started_at')
        .eq('id', cardId)
        .maybeSingle();
      if (card && !card.screening_started_at) {
        patch.screening_started_at = snap.card.screening_started_at;
      }
    }
    const { error } = await supabaseAdmin.from('job_cards').update(patch).eq('id', cardId);
    if (error) console.error('[job-candidates] counter read-repair failed', error.message);
  } catch (err) {
    console.error('[job-candidates] counter read-repair error', (err as Error)?.message);
  }
}

/**
 * Signed write proxy. Blocked while the breaker is open (a degraded upstream
 * must not eat admin actions silently); the loop-guard `source: 'squadhub'`
 * tells Profiles to suppress the outbox echo for its OWN business
 * notifications, not the mirror event back to us.
 */
async function proxyJobAction(
  req: Request,
  res: Response,
  suffix: string,
  body: Record<string, unknown>,
): Promise<void> {
  if (!configured()) {
    res.status(503).json({ success: false, error: 'SquadHire integration is not configured on this server' });
    return;
  }
  if (breakerIsOpen()) {
    res.status(503).json({ success: false, error: 'SquadHire is temporarily unavailable — try again shortly' });
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-SquadHub-Signature': config.squadhireWebhookSecret,
  };
  if (req.userEmail) headers['X-SquadHub-Actor'] = req.userEmail;
  if (req.userName) headers['X-SquadHub-Actor-Name'] = req.userName;

  const payload = {
    ...body,
    source: 'squadhub',
    actor: { type: 'admin', email: req.userEmail ?? null, name: req.userName ?? null },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const upstream = await fetch(buildUrl(suffix), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await upstream.text();
    if (upstream.status >= 500) {
      recordFailure();
      console.error(`[job-candidates] upstream POST ${suffix} → ${upstream.status} (${Date.now() - startedAt}ms)`);
    } else {
      recordSuccess();
    }
    res.status(upstream.status).type('application/json').send(text);
  } catch (err) {
    recordFailure();
    console.error(`[job-candidates] upstream POST ${suffix} failed (${Date.now() - startedAt}ms):`, (err as Error)?.message);
    res.status(502).json({ success: false, error: 'SquadHire is unreachable' });
  } finally {
    clearTimeout(timer);
  }
}

async function cardExists(cardId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('job_cards')
    .select('id')
    .eq('id', cardId)
    .is('deleted_at', null)
    .maybeSingle();
  return !!data;
}

// ============================================================
// GET /admin/job-cards/:id/candidates?status= — candidate funnel.
//
// Reads the funnel LIVE from SquadHire (canonical owner) so a missed/late
// outbox event can't hide an applicant, then merges the local mirror for
// per-stage timestamps + interview/offer detail. Falls back to the mirror
// alone when SquadHire is unreachable, and read-repairs the rollup counters
// from live truth so the pipeline list buckets self-heal on view.
// ============================================================
router.get('/:id/candidates', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const statusFilter =
      typeof req.query.status === 'string' && req.query.status ? req.query.status : null;

    // Mirror candidates + interviews + offers — the detail store, used by both
    // the live merge and the fallback path.
    const [candRes, ivRes, offRes] = await Promise.all([
      supabaseAdmin.from('job_card_candidates').select('*').eq('card_id', cardId).order('created_at', { ascending: false }),
      supabaseAdmin.from('job_interviews').select('*').eq('card_id', cardId).order('round_number', { ascending: true }),
      supabaseAdmin.from('job_offers').select('*').eq('card_id', cardId).order('created_at', { ascending: false }),
    ]);
    if (candRes.error) {
      res.status(500).json({ success: false, error: candRes.error.message });
      return;
    }
    const mirrorRows = (candRes.data ?? []) as MirrorCandidateRow[];
    const interviewsByCandidate: Record<string, JobInterview[]> = {};
    (ivRes.data ?? []).forEach((i: any) => {
      (interviewsByCandidate[i.candidate_id] = interviewsByCandidate[i.candidate_id] || []).push(i as JobInterview);
    });
    const offersByCandidate: Record<string, JobOffer[]> = {};
    (offRes.data ?? []).forEach((o: any) => {
      (offersByCandidate[o.candidate_id] = offersByCandidate[o.candidate_id] || []).push(o as JobOffer);
    });

    // ---- Live-first ---------------------------------------------------------
    if (configured() && !breakerIsOpen()) {
      let snap: LiveFunnelSnapshot | null = null;
      try {
        snap = await fetchLiveFunnel(cardId);
        recordSuccess();
      } catch (err) {
        recordFailure();
        console.error('[job-candidates] live funnel fetch failed, using mirror:', (err as Error)?.message);
        snap = null;
      }
      if (snap) {
        const mirrorByExternal = new Map<string, MirrorCandidateRow>();
        for (const m of mirrorRows) mirrorByExternal.set(m.external_candidate_id, m);
        // Interviews + offers now come from the live snapshot (not the mirror
        // join); the mirror only supplies per-stage timestamps.
        let built = buildLiveCandidates({ cardId, live: snap, mirrorByExternal });
        void repairCountersFromLive(cardId, built, snap);
        if (statusFilter) built = built.filter((c) => c.status === statusFilter);
        res.json({ success: true, source: 'live', data: built });
        return;
      }
    }

    // ---- Fallback: local mirror only ---------------------------------------
    let list = mirrorRows as any[];
    if (statusFilter) list = list.filter((c) => c.status === statusFilter);
    res.json({
      success: true,
      source: 'mirror',
      data: list.map((c: any) => ({
        ...c,
        interviews: interviewsByCandidate[c.id] ?? [],
        offers: offersByCandidate[c.id] ?? [],
      })),
    });
  } catch (err: any) {
    console.error('List job candidates error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/job-cards/:id/start-screening — Broadcasted → Applicant
// Screening (mirrored via the job_screening_started echo, contract §5)
// ============================================================
router.post('/:id/start-screening', async (req: Request, res: Response) => {
  try {
    if (!(await cardExists(req.params.id as string))) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    await proxyJobAction(req, res, '/stage', {
      external_id: req.params.id,
      action: 'start_screening',
    });
  } catch (err: any) {
    console.error('Start screening error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// Candidate review: shortlist / reject / on-hold / select
// ============================================================
const reviewReasonSchema = z.object({ reason: z.string().max(2000).optional() });

function reviewRoute(action: 'shortlist' | 'reject' | 'on_hold' | 'select') {
  return async (req: Request, res: Response) => {
    try {
      const body = reviewReasonSchema.parse(req.body ?? {});
      if (!(await cardExists(req.params.id as string))) {
        res.status(404).json({ success: false, error: 'Job card not found' });
        return;
      }
      await proxyJobAction(req, res, '/candidates/review', {
        external_id: req.params.id,
        candidate_id: req.params.candidateId,
        action,
        ...(body.reason ? { reason: body.reason } : {}),
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      console.error(`Candidate ${action} error:`, err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  };
}

router.post('/:id/candidates/:candidateId/shortlist', reviewRoute('shortlist'));
router.post('/:id/candidates/:candidateId/reject', reviewRoute('reject'));
router.post('/:id/candidates/:candidateId/on-hold', reviewRoute('on_hold'));
router.post('/:id/candidates/:candidateId/select', reviewRoute('select'));

// ============================================================
// POST /admin/job-cards/:id/call-for-interview — schedule a round for
// shortlisted candidates. capacity = window ÷ minutes is computed on the
// Profiles side (canonical). Physical rounds resolve location_id → a frozen
// snapshot here so the round survives later location edits.
// ============================================================
const callForInterviewSchema = z
  .object({
    candidate_ids: z.array(z.string().min(1)).optional(),
    all_shortlisted: z.boolean().optional(),
    round_number: z.number().int().min(1).max(20).optional(),
    round_label: z.string().max(200).optional(),
    mode: z.enum(['virtual', 'physical']),
    window_start: z.string().datetime(),
    window_end: z.string().datetime(),
    minutes_per_interview: z.number().int().min(5).max(240),
    meeting_provider: z.string().max(60).optional(),
    // Set at scheduling; revealed to a candidate only when the business
    // clicks "Start Interview" (gating happens on the Profiles side).
    meeting_link: z.string().max(1000).optional(),
    location_id: z.string().uuid().optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.all_shortlisted && (!val.candidate_ids || val.candidate_ids.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidate_ids'],
        message: 'Pick candidates or set all_shortlisted',
      });
    }
    if (val.mode === 'physical' && !val.location_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['location_id'],
        message: 'Physical interviews need a location',
      });
    }
    if (val.mode === 'virtual' && !val.meeting_link) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meeting_link'],
        message: 'Virtual interviews need a meeting link',
      });
    }
  });

router.post('/:id/call-for-interview', async (req: Request, res: Response) => {
  try {
    const body = callForInterviewSchema.parse(req.body);
    if (!(await cardExists(req.params.id as string))) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }

    let locationSnapshot: Record<string, unknown> | null = null;
    if (body.mode === 'physical' && body.location_id) {
      const { data: location } = await supabaseAdmin
        .from('business_locations')
        .select('label, address, city, region, google_maps_url, latitude, longitude')
        .eq('id', body.location_id)
        .maybeSingle();
      if (!location) {
        res.status(404).json({ success: false, error: 'Location not found' });
        return;
      }
      locationSnapshot = location as Record<string, unknown>;
    }

    await proxyJobAction(req, res, '/interview-rounds', {
      external_id: req.params.id,
      candidate_ids: body.candidate_ids ?? null,
      all_shortlisted: body.all_shortlisted ?? false,
      round_number: body.round_number ?? 1,
      round_label: body.round_label ?? null,
      mode: body.mode,
      window_start: body.window_start,
      window_end: body.window_end,
      minutes_per_interview: body.minutes_per_interview,
      meeting_provider: body.meeting_provider ?? null,
      meeting_link: body.meeting_link ?? null,
      location_id: body.location_id ?? null,
      location_snapshot: locationSnapshot,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Call for interview error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// Interview-day actions (mirror of the Profiles day console): showed-up /
// start (reveals the link to THAT candidate only) / no-show / didn't-join,
// plus the per-candidate round outcome.
// ============================================================
const interviewActionSchema = z.object({
  action: z.enum(['showed_up', 'start', 'no_show', 'not_joined']),
  invite_id: z.string().min(1),
});

router.post('/:id/interview-actions', async (req: Request, res: Response) => {
  try {
    const body = interviewActionSchema.parse(req.body);
    if (!(await cardExists(req.params.id as string))) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    await proxyJobAction(req, res, '/interview-actions', {
      external_id: req.params.id,
      action: body.action,
      invite_id: body.invite_id,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Interview action error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

const interviewOutcomeSchema = z.object({
  outcome: z.enum(['selected', 'rejected', 'on_hold']),
  notes: z.string().max(4000).optional(),
});

router.post('/:id/interviews/:inviteId/outcome', async (req: Request, res: Response) => {
  try {
    const body = interviewOutcomeSchema.parse(req.body);
    if (!(await cardExists(req.params.id as string))) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    await proxyJobAction(req, res, '/interview-actions', {
      external_id: req.params.id,
      action: 'outcome',
      invite_id: req.params.inviteId,
      outcome: body.outcome,
      notes: body.notes ?? null,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Interview outcome error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// Offers — compose+send / negotiation accept-decline / counter (FINAL) /
// withdraw / answer-question. The letter is frozen on the Profiles side at
// send; the offer events webhook mirrors it back into job_offers.
// ============================================================
const compensationComponentSchema = z.object({
  amount: z.number().int().min(0).nullable().optional(),
  cadence: z.enum(['per_month', 'per_annum']).optional(),
});

const compensationSchema = z.object({
  currency: z.string().max(10).optional(),
  training: compensationComponentSchema.nullable().optional(),
  probation: compensationComponentSchema.nullable().optional(),
  confirmed: compensationComponentSchema.nullable().optional(),
});

const letterSectionSchema = z.object({
  key: z.string().max(60),
  title: z.string().max(300),
  body_html: z.string().max(30000),
});

const composeOffersSchema = z
  .object({
    candidate_ids: z.array(z.string().min(1)).optional(),
    // Send to all interview-selected candidates in one click.
    all_selected: z.boolean().optional(),
    delivery_mode: z.enum(['platform', 'manual_email']).default('platform'),
    template_id: z.string().uuid().nullable().optional(),
    position_title: z.string().max(200).optional(),
    effective_date: z.string().max(40).optional(),
    join_by_date: z.string().max(40).optional(),
    expires_at: z.string().datetime().optional(),
    compensation: compensationSchema.optional(),
    total_ctc: z.number().int().min(0).optional(),
    ctc_currency: z.string().max(10).optional(),
    // Per-offer edited letter sections ({{candidate_name}} tokens are filled
    // per candidate on the Profiles side at freeze time).
    letter_sections: z.array(letterSectionSchema).optional(),
    note: z.string().max(4000).optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.all_selected && (!val.candidate_ids || val.candidate_ids.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidate_ids'],
        message: 'Pick candidates or set all_selected',
      });
    }
  });

router.post('/:id/offers', async (req: Request, res: Response) => {
  try {
    const body = composeOffersSchema.parse(req.body);
    if (!(await cardExists(req.params.id as string))) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    await proxyJobAction(req, res, '/offers', {
      external_id: req.params.id,
      op: 'compose_and_send',
      candidate_ids: body.candidate_ids ?? null,
      all_selected: body.all_selected ?? false,
      delivery_mode: body.delivery_mode,
      template_id: body.template_id ?? null,
      position_title: body.position_title ?? null,
      effective_date: body.effective_date ?? null,
      join_by_date: body.join_by_date ?? null,
      expires_at: body.expires_at ?? null,
      compensation: body.compensation ?? null,
      total_ctc: body.total_ctc ?? null,
      ctc_currency: body.ctc_currency ?? 'INR',
      letter_sections: body.letter_sections ?? null,
      note: body.note ?? null,
      created_by_side: 'admin',
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Compose offers error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

const negotiationSchema = z.object({ action: z.enum(['accept', 'decline']), note: z.string().max(4000).optional() });

router.post('/:id/offers/:offerId/negotiation', async (req: Request, res: Response) => {
  try {
    const body = negotiationSchema.parse(req.body);
    if (!(await cardExists(req.params.id as string))) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    await proxyJobAction(req, res, '/offers', {
      external_id: req.params.id,
      op: body.action === 'accept' ? 'accept_negotiation' : 'decline_negotiation',
      offer_id: req.params.offerId,
      note: body.note ?? null,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Offer negotiation error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

const counterSchema = z.object({
  compensation: compensationSchema.optional(),
  total_ctc: z.number().int().min(0).optional(),
  note: z.string().max(4000).optional(),
});

// A counteroffer is FINAL by spec: after it the candidate can only accept,
// decline or ask a question (Profiles enforces the lockout with a 403/409).
router.post('/:id/offers/:offerId/counter', async (req: Request, res: Response) => {
  try {
    const body = counterSchema.parse(req.body);
    if (!(await cardExists(req.params.id as string))) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    await proxyJobAction(req, res, '/offers', {
      external_id: req.params.id,
      op: 'counter',
      offer_id: req.params.offerId,
      is_final: true,
      compensation: body.compensation ?? null,
      total_ctc: body.total_ctc ?? null,
      note: body.note ?? null,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Offer counter error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.post('/:id/offers/:offerId/withdraw', async (req: Request, res: Response) => {
  try {
    if (!(await cardExists(req.params.id as string))) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    await proxyJobAction(req, res, '/offers', {
      external_id: req.params.id,
      op: 'withdraw',
      offer_id: req.params.offerId,
    });
  } catch (err: any) {
    console.error('Offer withdraw error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

const answerQuestionSchema = z.object({ answer: z.string().min(1).max(8000) });

router.post('/:id/offers/:offerId/answer-question', async (req: Request, res: Response) => {
  try {
    const body = answerQuestionSchema.parse(req.body);
    if (!(await cardExists(req.params.id as string))) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    await proxyJobAction(req, res, '/offers', {
      external_id: req.params.id,
      op: 'answer_question',
      offer_id: req.params.offerId,
      answer: body.answer,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Offer answer question error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// Hire & placement. Contract §6: Profiles is canonical — keep_open=false
// closes the card THERE (withdrawing un-accepted offers + notifying), and
// the job_card_closed echo syncs our state='closed'. The response passes
// through remaining_openings so the HireDialog can offer keep-open-or-close.
// ============================================================
const hireSchema = z.object({
  keep_open: z.boolean(),
  joining_date: z.string().max(40).optional(),
});

router.post('/:id/candidates/:candidateId/hire', async (req: Request, res: Response) => {
  try {
    const body = hireSchema.parse(req.body);
    if (!(await cardExists(req.params.id as string))) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    await proxyJobAction(req, res, '/hire', {
      external_id: req.params.id,
      candidate_id: req.params.candidateId,
      keep_open: body.keep_open,
      joining_date: body.joining_date ?? null,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Hire candidate error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.post('/:id/candidates/:candidateId/mark-joined', async (req: Request, res: Response) => {
  try {
    if (!(await cardExists(req.params.id as string))) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    await proxyJobAction(req, res, '/mark-joined', {
      external_id: req.params.id,
      candidate_id: req.params.candidateId,
    });
  } catch (err: any) {
    console.error('Mark joined error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
