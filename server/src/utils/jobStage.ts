import type { JobCardStage } from '@squadhub/shared';
import { JOB_CARD_STAGES } from '@squadhub/shared';

/**
 * Derived admin pipeline bucketing for job cards — the server mirror of the
 * admin UI's categorize(). Canonical stored state is deliberately small
 * (new → onboarding → published → closed); the pipeline tabs (New Deals /
 * Onboarding / Broadcasted / Applicant Screening / Short Listing / Interview
 * Process / Offer / Hired / Placed + Cancelled / Archive) are computed from
 * state + lifecycle stamps + the candidate rollup counters.
 *
 * Contract §5: the "Applicant Screening" bucket keys on screening_started_at
 * (mirrored from SquadHire's job_screening_started event), NOT on applicant
 * counts — the card stays "Broadcasted" until Start Screening is clicked.
 */

export { JOB_CARD_STAGES };

export interface JobStageSource {
  state: string;
  deleted_at?: string | null;
  archived_at?: string | null;
  cancelled_at?: string | null;
  closed_at?: string | null;
  closed_reason?: string | null;
  screening_started_at?: string | null;
  published_at?: string | null;
  openings_count?: number | null;
  shortlisted_count?: number | null;
  interview_count?: number | null;
  offer_count?: number | null;
  hired_count?: number | null;
  placed_count?: number | null;
}

export function categorizeJobCard(card: JobStageSource): JobCardStage {
  if (card.deleted_at) return 'trash';
  if (card.archived_at) return 'archive';
  if (card.cancelled_at) return 'cancelled';

  const openings = card.openings_count ?? 1;
  const placed = card.placed_count ?? 0;
  const hired = card.hired_count ?? 0;

  // Placed only once the round is actually over: the card was closed, or
  // every opening has a joined candidate. A single early joiner on a
  // multi-opening card keeps the card in Hired (the funnel is still live).
  if (placed > 0 && (card.state === 'closed' || placed >= openings)) return 'placed';
  if (hired > 0) return 'hired';
  if ((card.offer_count ?? 0) > 0) return 'offer';
  if ((card.interview_count ?? 0) > 0) return 'interview';
  if ((card.shortlisted_count ?? 0) > 0) return 'short_listing';
  if (card.screening_started_at) return 'screening';

  // A card that closed without any funnel progress (expired / cancelled via
  // close) has nowhere better to live than Cancelled.
  if (card.state === 'closed') return 'cancelled';
  if (card.state === 'published') return 'broadcasted';
  if (card.state === 'onboarding') return 'onboarding';
  return 'new';
}
