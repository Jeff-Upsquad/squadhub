import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { config } from '../../config';
import { supabaseAdmin } from '../../supabase';
import {
  logJobCardEvent,
  recountJobCardRollups,
  type JobCardEventType,
} from '../../utils/jobCardEvents';
import { DEFAULT_OFFER_LETTER_TEMPLATE } from '../../utils/offerTemplate';

/**
 * Inbound job events from SquadHire (Profiles).
 *
 * Contract §2: ONE endpoint each way. Profiles' outbox POSTs every job event
 * here — POST /integrations/squadhire/jobs/events — with the envelope
 * { event, external_id, job_profile_external_id, recipient_id, candidate_id,
 *   actor, occurred_at, data } and the event type is dispatched internally to
 * the candidate / interview / offer / hire / question / stage handlers.
 *
 * The handlers are the ONLY writers of the mirror tables (job_card_candidates
 * / job_interviews / job_offers / job_card_questions — migration 160 header),
 * upserting idempotently by external ids so Profiles' outbox retries and
 * replays converge. Rollup counters are recomputed by aggregate
 * (recountJobCardRollups), never incremental math. The Q&A moderation
 * tombstone (job_card_questions.deleted_at) survives replays — a deleted
 * question never resurrects.
 *
 * Auth: shared-secret header, constant-time compared (mirrors
 * squadhire-callbacks.ts). Unknown events and missing cards return 200 with
 * an `ignored` marker so the Profiles outbox stops retrying.
 */

const router = Router();

const HEADER_NAME = 'x-squadhub-signature';

function verifySquadhireCallbackSecret(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = config.squadhireCallbackSecret;
  if (!expected) {
    res.status(503).json({ success: false, error: 'SquadHire callback secret not configured' });
    return;
  }
  const provided = req.header(HEADER_NAME) ?? req.header('X-SquadHub-Signature');
  if (typeof provided !== 'string' || provided.length === 0) {
    res.status(401).json({ success: false, error: 'Missing webhook signature' });
    return;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ success: false, error: 'Invalid webhook signature' });
    return;
  }
  next();
}

// ------------------------------------------------------------
// Envelope (contract §2)
// ------------------------------------------------------------

const envelopeSchema = z
  .object({
    event: z.string().min(1),
    external_id: z.string().min(1), // SquadHub job_cards.id
    job_profile_external_id: z.string().nullable().optional(), // SquadHub job_profiles.id
    recipient_id: z.string().nullable().optional(),
    candidate_id: z.string().nullable().optional(), // Profiles' job_candidates row id
    actor: z
      .object({
        type: z.enum(['admin', 'business', 'talent', 'system']).nullable().optional(),
        id: z.string().nullable().optional(),
        label: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    occurred_at: z.string().datetime(),
    data: z.record(z.unknown()).optional().default({}),
  })
  .passthrough();

type Envelope = z.infer<typeof envelopeSchema>;

function actorFields(env: Envelope) {
  const rawId = env.actor?.id ?? (env.data?.talent_user_id as unknown) ?? null;
  return {
    actorId: rawId != null && String(rawId).length > 0 ? String(rawId) : null,
    actorType: (env.actor?.type ?? 'system') as 'admin' | 'business' | 'talent' | 'system',
    actorLabel: env.actor?.label ?? null,
  };
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// ------------------------------------------------------------
// Candidate mirror upsert (idempotent on card + external_candidate_id)
// ------------------------------------------------------------

interface CandidatePatch {
  status?: string;
  /** Timestamp column stamped from occurred_at ONLY when currently null, so
   *  replays don't move first-occurrence stamps. */
  stampField?:
    | 'applied_at'
    | 'screening_started_at'
    | 'shortlisted_at'
    | 'first_interview_at'
    | 'offered_at'
    | 'offer_accepted_at'
    | 'hired_at'
    | 'joined_at'
    | 'rejected_at';
  extra?: Record<string, unknown>;
}

async function upsertCandidateMirror(
  cardId: string,
  env: Envelope,
  patch: CandidatePatch,
): Promise<{ id: string } | null> {
  const externalCandidateId = env.candidate_id ?? null;
  if (!externalCandidateId) return null;
  const data = env.data ?? {};

  const { data: existing } = await supabaseAdmin
    .from('job_card_candidates')
    .select('id, status, applied_at, screening_started_at, shortlisted_at, first_interview_at, offered_at, offer_accepted_at, hired_at, joined_at, rejected_at')
    .eq('card_id', cardId)
    .eq('external_system', 'squadhire')
    .eq('external_candidate_id', externalCandidateId)
    .maybeSingle();

  const talentFields: Record<string, unknown> = {};
  if (str(data.talent_user_id)) talentFields.talent_user_id = data.talent_user_id;
  if (str(data.talent_name)) talentFields.talent_name = data.talent_name;
  if (str(data.talent_email)) talentFields.talent_email = data.talent_email;
  if (str(data.talent_phone)) talentFields.talent_phone = data.talent_phone;

  if (existing) {
    const update: Record<string, unknown> = {
      ...talentFields,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.extra ?? {}),
      snapshot: data,
    };
    if (patch.stampField && !(existing as any)[patch.stampField]) {
      update[patch.stampField] = env.occurred_at;
    }
    const { error } = await supabaseAdmin
      .from('job_card_candidates')
      .update(update)
      .eq('id', existing.id);
    if (error) {
      console.error('[squadhire-jobs-callback] candidate update failed', error.message);
      return null;
    }
    return { id: existing.id };
  }

  const insert: Record<string, unknown> = {
    card_id: cardId,
    external_system: 'squadhire',
    external_candidate_id: externalCandidateId,
    talent_user_id: str(data.talent_user_id) ?? env.recipient_id ?? 'unknown',
    talent_name: str(data.talent_name),
    talent_email: str(data.talent_email),
    talent_phone: str(data.talent_phone),
    status: patch.status ?? 'matched',
    ...(patch.stampField ? { [patch.stampField]: env.occurred_at } : {}),
    ...(patch.extra ?? {}),
    snapshot: data,
  };
  const { data: created, error } = await supabaseAdmin
    .from('job_card_candidates')
    .insert(insert)
    .select('id')
    .single();
  if (error) {
    console.error('[squadhire-jobs-callback] candidate insert failed', error.message);
    return null;
  }
  return created as { id: string };
}

// ------------------------------------------------------------
// Handlers (each returns the ignored-reason or null on success)
// ------------------------------------------------------------

// Profiles funnel_stage → mirror status (for generic status updates).
const PROFILES_STAGE_TO_STATUS: Record<string, string> = {
  matched: 'matched',
  applied: 'applied',
  screening: 'screening',
  shortlisted: 'shortlisted',
  interview_invited: 'interview',
  interview: 'interview',
  on_hold: 'on_hold',
  selected: 'interview', // post-interview selection sits in the Interview bucket until an offer goes out
  offer: 'offer',
  offer_accepted: 'offer_accepted',
  hired: 'hired',
  placed: 'joined',
  joined: 'joined',
  rejected: 'rejected',
  withdrawn: 'withdrawn',
};

const CANDIDATE_EVENTS: Record<string, { patch: CandidatePatch; log: JobCardEventType }> = {
  job_candidate_applied: { patch: { status: 'applied', stampField: 'applied_at' }, log: 'candidate_applied' },
  job_candidate_screening: { patch: { status: 'screening', stampField: 'screening_started_at' }, log: 'candidate_updated' },
  job_candidate_shortlisted: { patch: { status: 'shortlisted', stampField: 'shortlisted_at' }, log: 'candidate_updated' },
  job_candidate_on_hold: { patch: { status: 'on_hold' }, log: 'candidate_updated' },
  job_candidate_selected: { patch: { status: 'interview' }, log: 'candidate_updated' },
  job_candidate_interview: { patch: { status: 'interview', stampField: 'first_interview_at' }, log: 'candidate_updated' },
  job_candidate_offer: { patch: { status: 'offer', stampField: 'offered_at' }, log: 'candidate_updated' },
  job_candidate_offer_accepted: { patch: { status: 'offer_accepted', stampField: 'offer_accepted_at' }, log: 'candidate_updated' },
  job_candidate_rejected: { patch: { status: 'rejected', stampField: 'rejected_at' }, log: 'candidate_rejected' },
  job_candidate_withdrawn: { patch: { status: 'withdrawn' }, log: 'candidate_withdrawn' },
  job_candidate_hired: { patch: { status: 'hired', stampField: 'hired_at' }, log: 'candidate_hired' },
  job_candidate_joined: { patch: { status: 'joined', stampField: 'joined_at' }, log: 'candidate_joined' },
};

async function handleCandidateEvent(cardId: string, env: Envelope): Promise<string | null> {
  let mapped = CANDIDATE_EVENTS[env.event];
  if (!mapped && env.event === 'job_candidate_updated') {
    const stage = str(env.data?.status);
    const status = stage ? PROFILES_STAGE_TO_STATUS[stage] : undefined;
    mapped = { patch: status ? { status } : {}, log: 'candidate_updated' };
  }
  if (!mapped) return 'unknown_event';

  const patch: CandidatePatch = { ...mapped.patch, extra: { ...(mapped.patch.extra ?? {}) } };
  if (env.event === 'job_candidate_rejected') {
    if (str(env.data?.stage)) patch.extra!.rejection_stage = env.data.stage;
    if (str(env.data?.reason)) patch.extra!.rejection_reason = env.data.reason;
  }
  if (env.event === 'job_candidate_hired' && str(env.data?.joining_date)) {
    patch.extra!.joining_date = env.data.joining_date;
  }

  const candidate = await upsertCandidateMirror(cardId, env, patch);
  if (!candidate) return 'candidate_id_missing';

  await recountJobCardRollups(cardId);
  await logJobCardEvent({
    cardId,
    eventType: mapped.log,
    ...actorFields(env),
    metadata: { event: env.event, candidate_id: env.candidate_id, data: env.data },
  });
  return null;
}

async function handleScreeningStarted(cardId: string, env: Envelope): Promise<string | null> {
  // First occurrence wins — replays must not move the stamp (contract §5:
  // the Applicant Screening bucket keys on this).
  const { data: card } = await supabaseAdmin
    .from('job_cards')
    .select('screening_started_at')
    .eq('id', cardId)
    .maybeSingle();
  if (card && !card.screening_started_at) {
    await supabaseAdmin
      .from('job_cards')
      .update({ screening_started_at: env.occurred_at })
      .eq('id', cardId);
  }
  // Profiles moves all applied candidates into screening at start-screening;
  // mirror that in bulk in case the per-candidate echoes are delayed.
  await supabaseAdmin
    .from('job_card_candidates')
    .update({ status: 'screening', screening_started_at: env.occurred_at })
    .eq('card_id', cardId)
    .eq('status', 'applied');
  await recountJobCardRollups(cardId);
  await logJobCardEvent({
    cardId,
    eventType: 'screening_started',
    ...actorFields(env),
    metadata: { event: env.event },
  });
  return null;
}

async function handleCardClosed(cardId: string, env: Envelope): Promise<string | null> {
  const reason = str(env.data?.reason);
  const closedReason = reason && ['filled', 'cancelled', 'expired'].includes(reason) ? reason : 'filled';
  await supabaseAdmin
    .from('job_cards')
    .update({
      state: 'closed',
      closed_at: env.occurred_at,
      closed_reason: closedReason,
      paused_at: null,
    })
    .eq('id', cardId)
    .neq('state', 'closed');
  await logJobCardEvent({
    cardId,
    eventType: 'closed',
    ...actorFields(env),
    metadata: { event: env.event, reason: closedReason },
  });
  return null;
}

async function handleInterviewEvent(cardId: string, env: Envelope): Promise<string | null> {
  const data = env.data ?? {};
  const externalInterviewId = str(data.invite_id) ?? str(data.interview_id);
  if (!externalInterviewId) return 'interview_id_missing';

  // Interview events imply the candidate reached the interview stage — make
  // sure the mirror row exists (out-of-order echoes are possible).
  const candidate = await upsertCandidateMirror(cardId, env, {
    status: 'interview',
    stampField: 'first_interview_at',
  });
  if (!candidate) return 'candidate_id_missing';

  const { data: existing } = await supabaseAdmin
    .from('job_interviews')
    .select('id, status')
    .eq('external_interview_id', externalInterviewId)
    .maybeSingle();

  const scheduleFields: Record<string, unknown> = {};
  if (data.round_number != null) scheduleFields.round_number = Number(data.round_number) || 1;
  if (str(data.round_label)) scheduleFields.round_label = data.round_label;
  if (str(data.mode) && ['virtual', 'physical'].includes(String(data.mode))) scheduleFields.mode = data.mode;
  if (str(data.scheduled_at)) scheduleFields.scheduled_at = data.scheduled_at;
  else if (str(data.window_start)) scheduleFields.scheduled_at = data.window_start;
  if (data.minutes_per_interview != null) scheduleFields.duration_minutes = Number(data.minutes_per_interview) || null;
  if (str(data.meeting_link)) scheduleFields.meeting_link = data.meeting_link;
  if (data.location_snapshot && typeof data.location_snapshot === 'object') {
    scheduleFields.location_snapshot = data.location_snapshot;
  }

  let interviewId: string;
  if (existing) {
    interviewId = existing.id as string;
  } else {
    const { data: created, error } = await supabaseAdmin
      .from('job_interviews')
      .insert({
        card_id: cardId,
        candidate_id: candidate.id,
        external_interview_id: externalInterviewId,
        mode: ['virtual', 'physical'].includes(String(data.mode)) ? data.mode : 'virtual',
        status: 'scheduled',
        ...scheduleFields,
      })
      .select('id')
      .single();
    if (error) {
      console.error('[squadhire-jobs-callback] interview insert failed', error.message);
      return 'interview_insert_failed';
    }
    interviewId = (created as any).id as string;
  }

  const update: Record<string, unknown> = { ...scheduleFields };
  switch (env.event) {
    case 'job_interview_scheduled':
    case 'job_interview_invited':
      update.status = 'scheduled';
      break;
    case 'job_interview_rsvp': {
      const rsvp = str(data.rsvp);
      if (rsvp === 'declined') update.status = 'cancelled';
      break;
    }
    case 'job_interview_started':
      update.meeting_link_revealed_at = env.occurred_at;
      break;
    case 'job_interview_completed':
      update.status = 'completed';
      break;
    case 'job_interview_no_show':
      update.status = 'no_show';
      break;
    case 'job_interview_cancelled':
      update.status = 'cancelled';
      break;
    case 'job_interview_outcome': {
      const outcome = str(data.outcome);
      if (outcome && ['selected', 'rejected', 'on_hold'].includes(outcome)) {
        update.outcome = outcome;
        update.status = 'completed';
        if (str(data.notes)) update.outcome_notes = data.notes;
        // Walk the candidate mirror per outcome (Profiles echoes the
        // candidate event too, but this keeps the mirror coherent even when
        // that echo is delayed or dropped).
        const candidatePatch: Record<string, unknown> =
          outcome === 'rejected'
            ? { status: 'rejected', rejected_at: env.occurred_at, rejection_stage: 'interview' }
            : outcome === 'on_hold'
              ? { status: 'on_hold' }
              : { status: 'interview' };
        await supabaseAdmin
          .from('job_card_candidates')
          .update(candidatePatch)
          .eq('id', candidate.id);
      }
      break;
    }
    default:
      return 'unknown_event';
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabaseAdmin
      .from('job_interviews')
      .update(update)
      .eq('id', interviewId);
    if (error) {
      console.error('[squadhire-jobs-callback] interview update failed', error.message);
    }
  }

  await recountJobCardRollups(cardId);
  await logJobCardEvent({
    cardId,
    eventType: env.event === 'job_interview_scheduled' || env.event === 'job_interview_invited'
      ? 'interview_scheduled'
      : 'interview_updated',
    ...actorFields(env),
    metadata: { event: env.event, invite_id: externalInterviewId, data },
  });
  return null;
}

const OFFER_STATUS_EVENTS: Record<string, string> = {
  job_offer_viewed: 'viewed',
  job_offer_negotiation_requested: 'negotiation_requested',
  job_offer_countered: 'countered',
  job_offer_accepted: 'accepted',
  job_offer_declined: 'declined',
  job_offer_withdrawn: 'withdrawn',
  job_offer_expired: 'expired',
};

async function handleOfferEvent(cardId: string, env: Envelope): Promise<string | null> {
  const data = env.data ?? {};
  const externalOfferId = str(data.offer_id);
  if (!externalOfferId) return 'offer_id_missing';

  const candidatePatch: CandidatePatch =
    env.event === 'job_offer_sent'
      ? { status: 'offer', stampField: 'offered_at' }
      : env.event === 'job_offer_accepted'
        ? { status: 'offer_accepted', stampField: 'offer_accepted_at' }
        : {};
  const candidate = await upsertCandidateMirror(cardId, env, candidatePatch);
  if (!candidate) return 'candidate_id_missing';

  const { data: existing } = await supabaseAdmin
    .from('job_offers')
    .select('id, revision')
    .eq('external_offer_id', externalOfferId)
    .maybeSingle();

  const offerFields: Record<string, unknown> = {};
  if (str(data.delivery_mode) && ['platform', 'manual_email'].includes(String(data.delivery_mode))) {
    offerFields.delivery_mode = data.delivery_mode;
  }
  if (str(data.rendered_body_html)) offerFields.rendered_body_html = data.rendered_body_html;
  if (data.compensation && typeof data.compensation === 'object') offerFields.compensation = data.compensation;
  if (data.total_ctc != null) offerFields.total_ctc = Number(data.total_ctc) || null;
  if (str(data.ctc_currency)) offerFields.ctc_currency = data.ctc_currency;
  if (str(data.position_title)) offerFields.position_title = data.position_title;
  if (str(data.effective_date)) offerFields.effective_date = data.effective_date;
  if (str(data.join_by_date)) offerFields.join_by_date = data.join_by_date;
  if (str(data.joining_date)) offerFields.joining_date = data.joining_date;
  if (str(data.expires_at)) offerFields.offer_expires_at = data.expires_at;
  if (data.revision != null) offerFields.revision = Number(data.revision) || 1;
  if (typeof data.is_final === 'boolean') offerFields.is_final = data.is_final;
  if (str(data.template_id)) offerFields.template_id = data.template_id;
  if (str(data.created_by_side) && ['admin', 'business'].includes(String(data.created_by_side))) {
    offerFields.created_by_side = data.created_by_side;
  }

  let offerId: string;
  if (existing) {
    offerId = existing.id as string;
    const status = env.event === 'job_offer_sent' ? 'sent' : OFFER_STATUS_EVENTS[env.event];
    const { error } = await supabaseAdmin
      .from('job_offers')
      .update({ ...offerFields, ...(status ? { status } : {}) })
      .eq('id', offerId);
    if (error) {
      console.error('[squadhire-jobs-callback] offer update failed', error.message);
    }
  } else {
    const status = env.event === 'job_offer_sent' ? 'sent' : OFFER_STATUS_EVENTS[env.event] ?? 'sent';
    const { data: created, error } = await supabaseAdmin
      .from('job_offers')
      .insert({
        card_id: cardId,
        candidate_id: candidate.id,
        external_offer_id: externalOfferId,
        status,
        ...offerFields,
      })
      .select('id')
      .single();
    if (error) {
      console.error('[squadhire-jobs-callback] offer insert failed', error.message);
      return 'offer_insert_failed';
    }
    offerId = (created as any).id as string;
  }

  if (
    env.event !== 'job_offer_sent' &&
    !OFFER_STATUS_EVENTS[env.event] &&
    env.event !== 'job_offer_question_asked' &&
    env.event !== 'job_offer_question_answered'
  ) {
    return 'unknown_event';
  }

  // Negotiation thread — idempotent by external event id (deterministic
  // fallback keeps replays without an id from duplicating).
  const eventType =
    env.event === 'job_offer_countered' && data.is_final === true
      ? 'final_countered'
      : env.event.replace(/^job_offer_/, '');
  const externalEventId = str(data.event_id) ?? `${externalOfferId}:${env.event}:${env.occurred_at}`;
  const { error: evErr } = await supabaseAdmin
    .from('job_offer_events')
    .upsert(
      {
        offer_id: offerId,
        external_event_id: externalEventId,
        event_type: eventType,
        actor_type: env.actor?.type ?? null,
        actor_label: env.actor?.label ?? null,
        metadata: data,
      },
      { onConflict: 'external_event_id', ignoreDuplicates: true },
    );
  if (evErr) {
    console.error('[squadhire-jobs-callback] offer event upsert failed', evErr.message);
  }

  await recountJobCardRollups(cardId);
  await logJobCardEvent({
    cardId,
    eventType: env.event === 'job_offer_sent' ? 'offer_sent' : 'offer_updated',
    ...actorFields(env),
    metadata: { event: env.event, offer_id: externalOfferId, data },
  });
  return null;
}

async function handleQuestionEvent(cardId: string, env: Envelope): Promise<string | null> {
  const data = env.data ?? {};
  const externalQuestionId = str(data.question_id);
  if (!externalQuestionId) return 'question_id_missing';

  const { data: existing } = await supabaseAdmin
    .from('job_card_questions')
    .select('id, deleted_at')
    .eq('external_question_id', externalQuestionId)
    .maybeSingle();

  // Moderation tombstone survives replays — a deleted question never
  // resurrects, whatever Profiles re-sends (contract §7).
  if (existing?.deleted_at && env.event !== 'job_question_deleted') {
    return 'question_tombstoned';
  }

  switch (env.event) {
    case 'job_question_asked': {
      if (existing) break; // replay — already mirrored
      // job_profile_external_id IS our job_profiles.id (contract §4); fall
      // back to the card's linked profile, validating the FK first.
      let jobProfileId: string | null = null;
      const claimed = env.job_profile_external_id ?? null;
      if (claimed) {
        const { data: profile } = await supabaseAdmin
          .from('job_profiles')
          .select('id')
          .eq('id', claimed)
          .maybeSingle();
        jobProfileId = (profile as any)?.id ?? null;
      }
      if (!jobProfileId) {
        const { data: card } = await supabaseAdmin
          .from('job_cards')
          .select('job_profile_id')
          .eq('id', cardId)
          .maybeSingle();
        jobProfileId = (card as any)?.job_profile_id ?? null;
      }
      const { error } = await supabaseAdmin.from('job_card_questions').insert({
        card_id: cardId,
        job_profile_id: jobProfileId,
        external_question_id: externalQuestionId,
        talent_user_id: str(data.talent_user_id),
        talent_name: str(data.talent_name),
        question: str(data.question) ?? '(no question text)',
      });
      if (error) {
        console.error('[squadhire-jobs-callback] question insert failed', error.message);
        return 'question_insert_failed';
      }
      break;
    }
    case 'job_question_answered': {
      if (!existing) return 'question_not_found';
      // answered ⇒ published (contract §7) — is_published is computed from
      // answered_at, no separate flag.
      const { error } = await supabaseAdmin
        .from('job_card_questions')
        .update({
          answer: str(data.answer) ?? '',
          answered_at: env.occurred_at,
          answered_by_label: str(data.answered_by_label) ?? env.actor?.label ?? null,
        })
        .eq('id', existing.id)
        .is('deleted_at', null);
      if (error) {
        console.error('[squadhire-jobs-callback] question answer failed', error.message);
      }
      break;
    }
    case 'job_question_deleted': {
      if (!existing) return 'question_not_found';
      if (!existing.deleted_at) {
        await supabaseAdmin
          .from('job_card_questions')
          .update({ deleted_at: env.occurred_at })
          .eq('id', existing.id);
      }
      break;
    }
    default:
      return 'unknown_event';
  }

  const logType: JobCardEventType =
    env.event === 'job_question_asked'
      ? 'question_asked'
      : env.event === 'job_question_answered'
        ? 'question_answered'
        : 'question_deleted';
  await logJobCardEvent({
    cardId,
    eventType: logType,
    ...actorFields(env),
    metadata: { event: env.event, question_id: externalQuestionId },
  });
  return null;
}

// ------------------------------------------------------------
// POST /integrations/squadhire/jobs/events — the single inbound endpoint
// ------------------------------------------------------------

router.post('/events', verifySquadhireCallbackSecret, async (req: Request, res: Response) => {
  try {
    const env = envelopeSchema.parse(req.body);

    // Missing card = deleted after publish, or a stray event. 200 so the
    // Profiles outbox stops retrying (mirrors squadhire-callbacks.ts).
    const { data: card, error: cardErr } = await supabaseAdmin
      .from('job_cards')
      .select('id')
      .eq('id', env.external_id)
      .maybeSingle();
    if (cardErr) {
      res.status(500).json({ success: false, error: cardErr.message });
      return;
    }
    if (!card) {
      res.status(200).json({ success: true, ignored: 'card_not_found' });
      return;
    }

    let ignored: string | null;
    if (env.event === 'job_screening_started') {
      ignored = await handleScreeningStarted(card.id, env);
    } else if (env.event === 'job_card_closed') {
      ignored = await handleCardClosed(card.id, env);
    } else if (env.event.startsWith('job_candidate_')) {
      ignored = await handleCandidateEvent(card.id, env);
    } else if (env.event.startsWith('job_interview_')) {
      ignored = await handleInterviewEvent(card.id, env);
    } else if (env.event.startsWith('job_offer_')) {
      ignored = await handleOfferEvent(card.id, env);
    } else if (env.event.startsWith('job_question_')) {
      ignored = await handleQuestionEvent(card.id, env);
    } else {
      ignored = 'unknown_event';
    }

    if (ignored) {
      res.status(200).json({ success: true, ignored });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('[squadhire-jobs-callback] error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ------------------------------------------------------------
// Pull endpoints — server-to-server GETs Profiles' business portal uses.
// ------------------------------------------------------------

// GET /integrations/squadhire/jobs/offer-template?card_id=
// Template resolution: the card's job-profile-linked template → the global
// default → the built-in default constant. Also returns the merge context
// (position / business / dates) so the composer can pre-fill {{fields}}.
router.get('/offer-template', verifySquadhireCallbackSecret, async (req: Request, res: Response) => {
  try {
    const cardId = typeof req.query.card_id === 'string' ? req.query.card_id : '';
    if (!cardId) {
      res.status(400).json({ success: false, error: 'card_id is required' });
      return;
    }
    const { data: card } = await supabaseAdmin
      .from('job_cards')
      .select('id, job_profile_id, package_min, package_max, package_currency, package_period, expected_joining_date, customer_company')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }

    let template: any = null;
    if (card.job_profile_id) {
      const { data } = await supabaseAdmin
        .from('offer_letter_templates')
        .select('*')
        .eq('job_profile_id', card.job_profile_id)
        .is('archived_at', null)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      template = data ?? null;
    }
    if (!template) {
      const { data } = await supabaseAdmin
        .from('offer_letter_templates')
        .select('*')
        .eq('is_default', true)
        .is('archived_at', null)
        .maybeSingle();
      template = data ?? null;
    }
    if (!template) {
      // Nothing authored yet — serve the built-in skeleton (id null flags it
      // as unsaved so the composer doesn't reference a phantom row).
      template = { id: null, ...DEFAULT_OFFER_LETTER_TEMPLATE };
    }

    // Merge context for the composer's pre-fill.
    let profile: any = null;
    let business: any = null;
    let brand: any = null;
    if (card.job_profile_id) {
      const { data: p } = await supabaseAdmin
        .from('job_profiles')
        .select('id, title, business_profile_id, brand_profile_id, working_days, working_hours')
        .eq('id', card.job_profile_id)
        .maybeSingle();
      profile = p ?? null;
      if (profile) {
        const [{ data: b }, { data: br }] = await Promise.all([
          supabaseAdmin.from('business_profiles').select('id, name').eq('id', profile.business_profile_id).maybeSingle(),
          profile.brand_profile_id
            ? supabaseAdmin.from('brand_profiles').select('id, name').eq('id', profile.brand_profile_id).maybeSingle()
            : Promise.resolve({ data: null } as { data: any }),
        ]);
        business = b ?? null;
        brand = br ?? null;
      }
    }

    res.json({
      success: true,
      data: {
        template,
        merge_context: {
          position: profile?.title ?? null,
          business_name: business?.name ?? card.customer_company ?? null,
          brand_name: brand?.name ?? null,
          join_by_date: card.expected_joining_date ?? null,
          package_min: card.package_min ?? null,
          package_max: card.package_max ?? null,
          package_currency: card.package_currency ?? 'INR',
          package_period: card.package_period ?? 'monthly',
          working_days: Array.isArray(profile?.working_days) ? profile.working_days.join(', ') : null,
          working_hours: profile?.working_hours
            ? [profile.working_hours.start, profile.working_hours.end].filter(Boolean).join(' – ') || null
            : null,
        },
      },
    });
  } catch (err: any) {
    console.error('[squadhire-jobs-callback offer-template] error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// GET /integrations/squadhire/jobs/business-locations?card_id=
// The saved interview venues of the card's business — the scheduler dropdown.
router.get('/business-locations', verifySquadhireCallbackSecret, async (req: Request, res: Response) => {
  try {
    const cardId = typeof req.query.card_id === 'string' ? req.query.card_id : '';
    if (!cardId) {
      res.status(400).json({ success: false, error: 'card_id is required' });
      return;
    }
    const { data: card } = await supabaseAdmin
      .from('job_cards')
      .select('id, job_profile_id')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    if (!card.job_profile_id) {
      res.json({ success: true, data: [] });
      return;
    }
    const { data: profile } = await supabaseAdmin
      .from('job_profiles')
      .select('business_profile_id')
      .eq('id', card.job_profile_id)
      .maybeSingle();
    if (!profile) {
      res.json({ success: true, data: [] });
      return;
    }
    const { data: locations, error } = await supabaseAdmin
      .from('business_locations')
      .select('*')
      .eq('business_profile_id', profile.business_profile_id)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: locations ?? [] });
  } catch (err: any) {
    console.error('[squadhire-jobs-callback business-locations] error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
