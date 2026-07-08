import { supabaseAdmin } from '../supabase';

// Lifecycle + funnel events recorded in job_card_events (migration 159).
// Mirrors utils/cardEvents.ts; the union is broader because the inbound
// SquadHire events webhook also logs per-candidate funnel activity here.
export type JobCardEventType =
  | 'created'
  | 'updated'
  | 'profile_attached'
  | 'published'
  | 'recalled'
  | 'paused'
  | 'resumed'
  | 'cancelled'
  | 'closed'
  | 'archived'
  | 'unarchived'
  | 'duplicated'
  | 'deleted'
  | 'match_preview_refreshed'
  | 'screening_started'
  | 'candidate_applied'
  | 'candidate_updated'
  | 'candidate_rejected'
  | 'candidate_withdrawn'
  | 'candidate_hired'
  | 'candidate_joined'
  | 'interview_scheduled'
  | 'interview_updated'
  | 'offer_sent'
  | 'offer_updated'
  | 'question_asked'
  | 'question_answered'
  | 'question_deleted';

export type JobCardEventActorType = 'admin' | 'business' | 'talent' | 'system';

export interface LogJobCardEventInput {
  cardId: string;
  eventType: JobCardEventType;
  /** Internal user id (admin) or external SquadHire talent/business id. */
  actorId?: string | null;
  actorType?: JobCardEventActorType;
  /** Display-name snapshot taken at write time so the feed needs no joins. */
  actorLabel?: string | null;
  metadata?: Record<string, unknown>;
}

// Append a row to the job card activity log. Best-effort: never throws and
// never rejects, so a logging failure can't break the transition that
// triggered it. Callers may `await` it (cheap) or fire-and-forget.
export async function logJobCardEvent(input: LogJobCardEventInput): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('job_card_events').insert({
      card_id: input.cardId,
      event_type: input.eventType,
      actor_id: input.actorId ?? null,
      actor_type: input.actorType ?? null,
      actor_label: input.actorLabel ?? null,
      metadata: input.metadata ?? {},
    });
    if (error) {
      console.error('[job-card-events] insert failed', input.eventType, error.message);
    }
  } catch (err) {
    console.error('[job-card-events] log error', input.eventType, err);
  }
}

// ------------------------------------------------------------
// Candidate rollup counters (job_cards.applicants_count …placed_count).
// Maintained ONLY via this aggregate recount — a single read of the mirror
// followed by a full overwrite, never incremental math — so webhook replays
// and out-of-order events converge on the same numbers (migration 159).
// Semantics: the mid-funnel counters reflect CURRENT candidate status;
// applicants / hired / placed are cumulative (their timestamps stay set as
// the candidate advances), which is what categorizeJobCard() needs for its
// Hired/Placed precedence.
// ------------------------------------------------------------
export async function recountJobCardRollups(cardId: string): Promise<void> {
  try {
    const { data: rows, error } = await supabaseAdmin
      .from('job_card_candidates')
      .select('status, applied_at, hired_at, joined_at')
      .eq('card_id', cardId);
    if (error) {
      console.error('[job-card-events] rollup recount read failed', error.message);
      return;
    }
    const list = (rows ?? []) as Array<{
      status: string;
      applied_at: string | null;
      hired_at: string | null;
      joined_at: string | null;
    }>;

    const patch = {
      applicants_count: list.filter((r) => r.applied_at != null).length,
      screening_count: list.filter((r) => r.status === 'screening').length,
      shortlisted_count: list.filter((r) => r.status === 'shortlisted').length,
      interview_count: list.filter((r) => r.status === 'interview' || r.status === 'on_hold').length,
      offer_count: list.filter((r) => r.status === 'offer' || r.status === 'offer_accepted').length,
      hired_count: list.filter((r) => r.hired_at != null).length,
      placed_count: list.filter((r) => r.joined_at != null).length,
    };

    const { error: upErr } = await supabaseAdmin
      .from('job_cards')
      .update(patch)
      .eq('id', cardId);
    if (upErr) {
      console.error('[job-card-events] rollup recount write failed', upErr.message);
    }
  } catch (err) {
    console.error('[job-card-events] rollup recount error', err);
  }
}
