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
  /** Interviews/offers keyed by mirror row id (job_card_candidates.id). */
  interviewsByMirrorId: Record<string, JobInterview[]>;
  offersByMirrorId: Record<string, JobOffer[]>;
}

/**
 * Merge the live funnel (authoritative for presence + current status) with the
 * mirror (per-stage timestamps + interview/offer detail). A candidate present
 * live but not yet mirrored — the exact drift case that hid Jeff — still
 * renders, with detail arrays empty until its events land.
 */
export function buildLiveCandidates(input: BuildLiveCandidatesInput): CandidateWithDetail[] {
  const { cardId, live, mirrorByExternal, interviewsByMirrorId, offersByMirrorId } = input;
  return live.candidates.map((c) => {
    const m = mirrorByExternal.get(c.candidate_id);
    const status = mapProfilesStageToStatus(c.funnel_stage);
    const mirrorId = m?.id ?? c.candidate_id;
    const isRejected = status === 'rejected';
    return {
      id: mirrorId,
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
      interviews: interviewsByMirrorId[mirrorId] ?? [],
      offers: offersByMirrorId[mirrorId] ?? [],
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
