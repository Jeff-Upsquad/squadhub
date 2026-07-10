import type {
  JobCardCandidate,
  JobCandidateStatus,
  JobInterview,
  JobOffer,
} from '@squadhub/shared';

/**
 * Live-read shaping for the admin candidate funnel.
 *
 * SquadHire (Profiles) is canonical for who is in a job card's funnel. The
 * admin view reads that funnel LIVE (POST /jobs/snapshot) so a missed or late
 * outbox event can no longer hide an applicant, then this module maps the
 * canonical rows into the JobCardCandidate shape the UI already renders.
 *
 * The local mirror tables (job_card_candidates / job_interviews / job_offers)
 * are kept as a warm cache: they supply the per-stage timestamps the audit
 * events accumulated and the interview/offer detail (which the admin drives
 * through the write proxy), and they are the fallback when SquadHire is down.
 * Live presence + status always win; mirror detail rides along by
 * external_candidate_id.
 */

// Profiles funnel_stage → SquadHub mirror status. Kept in lockstep with the
// same map in routes/integrations/squadhire-job-callbacks.ts so the live path
// and the event-mirror path can never disagree on a candidate's bucket.
export const PROFILES_STAGE_TO_STATUS: Record<string, JobCandidateStatus> = {
  matched: 'matched',
  applied: 'applied',
  screening: 'screening',
  shortlisted: 'shortlisted',
  interview_invited: 'interview',
  interview: 'interview',
  on_hold: 'on_hold',
  selected: 'interview', // post-interview selection sits in Interview until an offer goes out
  offer: 'offer',
  offer_accepted: 'offer_accepted',
  hired: 'hired',
  placed: 'joined',
  joined: 'joined',
  rejected: 'rejected',
  withdrawn: 'withdrawn',
};

export function mapProfilesStageToStatus(stage: string | null | undefined): JobCandidateStatus {
  return (stage != null && PROFILES_STAGE_TO_STATUS[stage]) || 'matched';
}

// ── Live snapshot payload (mirror of Profiles getCardFunnelSnapshotByExternalId)
export interface LiveFunnelInterview {
  invite_id: string;
  round_id: string | null;
  round_number: number | null;
  round_label: string | null;
  mode: string | null;
  window_start: string | null;
  window_end: string | null;
  minutes_per_interview: number | null;
  meeting_provider: string | null;
  meeting_link: string | null;
  started_at: string | null;
  location_id: string | null;
  location_snapshot: Record<string, unknown> | null;
  rsvp: string | null;
  queue_status: string | null;
  outcome: string | null;
  round_status: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface LiveFunnelOffer {
  offer_id: string;
  squadhub_template_id: string | null;
  delivery_mode: string | null;
  position_title: string | null;
  effective_date: string | null;
  join_by_date: string | null;
  expires_on: string | null;
  compensation: Record<string, unknown> | null;
  letter: Record<string, unknown> | null;
  status: string;
  is_final_counter: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface LiveFunnelCandidate {
  candidate_id: string;
  recipient_id: string;
  talent_user_id: string;
  talent_name: string | null;
  talent_phone: string | null;
  funnel_stage: string;
  stage_changed_at: string | null;
  applied_at: string | null;
  hired_at: string | null;
  joined_at: string | null;
  joining_date: string | null;
  rejected_reason: string | null;
  interviews: LiveFunnelInterview[];
  offers: LiveFunnelOffer[];
}

// ── Interview mapping (canonical invite+round → JobInterview) ────────────────
// Status is derived from rsvp + queue_status + outcome (Profiles has no single
// interview status). Precedence: cancelled → no_show → completed → scheduled.
// An invited-but-not-yet-responded interview is 'scheduled' to match the
// event-mirror convention (handleInterviewEvent sets invited/scheduled events
// to 'scheduled'), so the live view and the mirror agree.
function deriveInterviewStatus(iv: LiveFunnelInterview): JobInterview['status'] {
  if (iv.rsvp === 'declined' || iv.round_status === 'cancelled' || iv.queue_status === 'removed') return 'cancelled';
  if (iv.queue_status === 'no_show' || iv.queue_status === 'not_joined') return 'no_show';
  if (iv.outcome != null || iv.queue_status === 'done') return 'completed';
  return 'scheduled';
}

function mapLiveInterview(cardId: string, candidateId: string, iv: LiveFunnelInterview): JobInterview {
  const outcome =
    iv.outcome === 'selected' || iv.outcome === 'rejected' || iv.outcome === 'on_hold' ? iv.outcome : null;
  return {
    id: iv.invite_id,
    card_id: cardId,
    candidate_id: candidateId,
    external_interview_id: iv.invite_id,
    external_round_id: iv.round_id ?? null,
    round_number: iv.round_number ?? 1,
    round_label: iv.round_label ?? null,
    mode: iv.mode === 'physical' ? 'physical' : 'virtual',
    scheduled_at: iv.window_start ?? null,
    window_end: iv.window_end ?? null,
    duration_minutes: iv.minutes_per_interview ?? null,
    meeting_provider: iv.meeting_provider ?? null,
    meeting_link: iv.meeting_link ?? null, // admin always sees it
    meeting_link_revealed_at: iv.started_at ?? null,
    location_id: iv.location_id ?? null,
    location_snapshot: (iv.location_snapshot ?? null) as JobInterview['location_snapshot'],
    status: deriveInterviewStatus(iv),
    outcome,
    outcome_notes: null, // not stored per-invite on Profiles
    created_at: iv.created_at ?? '',
    updated_at: iv.updated_at ?? iv.created_at ?? '',
  };
}

// ── Offer mapping (canonical job_offers → JobOffer) ──────────────────────────
const OFFER_STATUS_MAP: Record<string, JobOffer['status']> = {
  draft: 'draft',
  sent: 'sent',
  negotiating: 'negotiation_requested',
  countered: 'countered',
  accepted: 'accepted',
  declined: 'declined',
  withdrawn: 'withdrawn',
  expired: 'expired',
};

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Total CTC isn't stored on Profiles — derive the annualised confirmed salary. */
function deriveTotalCtc(comp: Record<string, unknown> | null): number | null {
  const confirmed = (comp?.confirmed ?? null) as { amount?: unknown; cadence?: unknown } | null;
  const amount = num(confirmed?.amount);
  if (amount == null) return null;
  return confirmed?.cadence === 'per_month' ? amount * 12 : amount;
}

function mapLiveOffer(
  cardId: string,
  candidateId: string,
  o: LiveFunnelOffer,
  revision: number,
): JobOffer {
  const comp = (o.compensation ?? {}) as Record<string, unknown>;
  const letter = (o.letter ?? {}) as Record<string, unknown>;
  const rendered =
    typeof letter.rendered_html === 'string'
      ? (letter.rendered_html as string)
      : typeof letter.html === 'string'
        ? (letter.html as string)
        : null;
  return {
    id: o.offer_id,
    card_id: cardId,
    candidate_id: candidateId,
    external_offer_id: o.offer_id,
    template_id: o.squadhub_template_id ?? null,
    delivery_mode: o.delivery_mode === 'manual_email' ? 'manual_email' : 'platform',
    rendered_body_html: rendered,
    compensation: comp as JobOffer['compensation'],
    total_ctc: deriveTotalCtc(o.compensation),
    ctc_currency: typeof comp.currency === 'string' ? (comp.currency as string) : 'INR',
    position_title: o.position_title ?? null,
    effective_date: o.effective_date ?? null,
    join_by_date: o.join_by_date ?? null,
    joining_date: null, // populated from the candidate row at hire, not the offer
    offer_expires_at: o.expires_on ?? null,
    revision,
    is_final: o.is_final_counter ?? false,
    status: OFFER_STATUS_MAP[o.status] ?? 'sent',
    created_by_side: 'admin',
    created_at: o.created_at ?? '',
    updated_at: o.updated_at ?? o.created_at ?? '',
  };
}

export interface LiveFunnelSnapshot {
  external_id: string;
  card: {
    hiring_stage: string;
    screening_started_at: string | null;
    closed_at: string | null;
    openings: number;
  };
  candidates: LiveFunnelCandidate[];
}

/** The subset of a mirror job_card_candidates row we merge in for detail. */
export interface MirrorCandidateRow {
  id: string;
  external_candidate_id: string;
  talent_name: string | null;
  talent_email: string | null;
  talent_phone: string | null;
  applied_at: string | null;
  screening_started_at: string | null;
  shortlisted_at: string | null;
  first_interview_at: string | null;
  offered_at: string | null;
  offer_accepted_at: string | null;
  hired_at: string | null;
  joining_date: string | null;
  joined_at: string | null;
  rejected_at: string | null;
  rejection_stage: string | null;
  rejection_reason: string | null;
  snapshot: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

type CandidateWithDetail = JobCardCandidate & {
  interviews: JobInterview[];
  offers: JobOffer[];
};

export interface BuildLiveCandidatesInput {
  cardId: string;
  live: LiveFunnelSnapshot;
  /** Mirror rows keyed by external_candidate_id (= Profiles candidate id). */
  mirrorByExternal: Map<string, MirrorCandidateRow>;
}

/**
 * Merge the live funnel (authoritative for presence, status, interviews and
 * offers) with the mirror (per-stage timestamps only). A candidate present
 * live but not yet mirrored — the exact drift case that hid Jeff — renders in
 * full, interviews/offers included, because those now come from live too.
 */
export function buildLiveCandidates(input: BuildLiveCandidatesInput): CandidateWithDetail[] {
  const { cardId, live, mirrorByExternal } = input;
  return live.candidates.map((c) => {
    const m = mirrorByExternal.get(c.candidate_id);
    const status = mapProfilesStageToStatus(c.funnel_stage);
    const candidateId = m?.id ?? c.candidate_id;
    const isRejected = status === 'rejected';
    // Offers arrive oldest-first from Profiles; revision = 1-based position.
    const offers = c.offers.map((o, i) => mapLiveOffer(cardId, candidateId, o, i + 1));
    const interviews = c.interviews.map((iv) => mapLiveInterview(cardId, candidateId, iv));
    return {
      id: candidateId,
      card_id: cardId,
      external_system: 'squadhire',
      external_candidate_id: c.candidate_id,
      talent_user_id: c.talent_user_id,
      talent_name: c.talent_name ?? m?.talent_name ?? null,
      talent_email: m?.talent_email ?? null,
      talent_phone: c.talent_phone ?? m?.talent_phone ?? null,
      status,
      // Timestamps: prefer the mirror's accumulated per-stage stamps; fall back
      // to what the live row can supply (applied = first-seen; current stage).
      applied_at: m?.applied_at ?? c.applied_at ?? null,
      screening_started_at: m?.screening_started_at ?? null,
      shortlisted_at: m?.shortlisted_at ?? null,
      first_interview_at: m?.first_interview_at ?? null,
      offered_at: m?.offered_at ?? null,
      offer_accepted_at: m?.offer_accepted_at ?? null,
      hired_at: c.hired_at ?? m?.hired_at ?? null,
      joining_date: c.joining_date ?? m?.joining_date ?? null,
      joined_at: c.joined_at ?? m?.joined_at ?? null,
      rejected_at: m?.rejected_at ?? (isRejected ? c.stage_changed_at : null),
      rejection_stage: m?.rejection_stage ?? null,
      rejection_reason: c.rejected_reason ?? m?.rejection_reason ?? null,
      snapshot: m?.snapshot ?? {},
      created_at: m?.created_at ?? c.applied_at ?? c.stage_changed_at ?? '',
      updated_at: m?.updated_at ?? c.stage_changed_at ?? '',
      interviews,
      // joining_date on an accepted offer is the candidate's, mirror it through.
      offers: offers.map((o) =>
        o.status === 'accepted' ? { ...o, joining_date: c.joining_date ?? o.joining_date } : o,
      ),
    };
  });
}

export interface RollupCounters {
  applicants_count: number;
  screening_count: number;
  shortlisted_count: number;
  interview_count: number;
  offer_count: number;
  hired_count: number;
  placed_count: number;
}

/**
 * Recompute the job_cards rollup counters from live truth — identical
 * semantics to recountJobCardRollups (which reads the mirror), so the pipeline
 * list buckets self-heal the moment an admin opens a drifted card.
 */
export function rollupCountersFromCandidates(candidates: JobCardCandidate[]): RollupCounters {
  return {
    applicants_count: candidates.filter((c) => c.applied_at != null).length,
    screening_count: candidates.filter((c) => c.status === 'screening').length,
    shortlisted_count: candidates.filter((c) => c.status === 'shortlisted').length,
    interview_count: candidates.filter((c) => c.status === 'interview' || c.status === 'on_hold').length,
    offer_count: candidates.filter((c) => c.status === 'offer' || c.status === 'offer_accepted').length,
    hired_count: candidates.filter((c) => c.hired_at != null).length,
    placed_count: candidates.filter((c) => c.joined_at != null).length,
  };
}
