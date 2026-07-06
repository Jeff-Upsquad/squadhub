import { supabaseAdmin } from '../supabase';

// Lifecycle events recorded in subscription_card_events (migration 145).
export type CardEventType =
  | 'created'
  | 'draft_saved'
  | 'published'
  | 'soft_published'
  | 'broadcast'
  | 'recalled'
  | 'cancelled'
  | 'archived'
  | 'reinstated'
  | 'republished'
  | 'assigned'
  | 'plan_changed'
  | 'talent_changed'
  | 'paused'
  | 'resumed'
  | 'reposted'
  | 'recipient_accepted'
  | 'recipient_declined';

export type CardEventActorType = 'admin' | 'partner' | 'talent' | 'system';

export interface LogCardEventInput {
  cardId: string;
  eventType: CardEventType;
  /** Internal user id (admin/partner) or external SquadHire talent id. */
  actorId?: string | null;
  actorType?: CardEventActorType;
  /** Display-name snapshot taken at write time so the feed needs no joins. */
  actorLabel?: string | null;
  metadata?: Record<string, unknown>;
}

// Append a row to the card activity log. Best-effort: never throws and never
// rejects, so a logging failure can't break the lifecycle transition that
// triggered it. Callers may `await` it (cheap) or fire-and-forget.
export async function logCardEvent(input: LogCardEventInput): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('subscription_card_events').insert({
      card_id: input.cardId,
      event_type: input.eventType,
      actor_id: input.actorId ?? null,
      actor_type: input.actorType ?? null,
      actor_label: input.actorLabel ?? null,
      metadata: input.metadata ?? {},
    });
    if (error) {
      console.error('[card-events] insert failed', input.eventType, error.message);
    }
  } catch (err) {
    console.error('[card-events] log error', input.eventType, err);
  }
}
