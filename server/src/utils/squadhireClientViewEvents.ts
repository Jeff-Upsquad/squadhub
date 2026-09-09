import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import { logCardEvent, type CardEventActorType, type CardEventType } from './cardEvents';

export const CLIENT_VIEW_REMOTE_EVENTS = [
  'client_shortlisted',
  'client_rejected',
  'client_unshortlisted',
  'client_selected',
  'client_unselected',
  'client_chat_opened',
  'client_chat_message',
  'client_payment_link',
] as const;

export const clientViewRemoteEventSchema = z
  .object({
    external_id: z.string().uuid(),
    event_type: z.enum(CLIENT_VIEW_REMOTE_EVENTS),
    /** Who clicked: Hub operator session vs the business in their own portal. */
    actor_source: z.enum(['operator', 'business']),
    event_id: z.string().min(1).max(80).optional(),
    actor: z
      .object({
        id: z.string().min(1).max(80).nullable().optional(),
        email: z.string().email().nullable().optional(),
        name: z.string().trim().max(200).nullable().optional(),
      })
      .optional(),
    talent_user_id: z.string().uuid().optional(),
    talent_name: z.string().trim().max(200).nullable().optional(),
    conversation_id: z.string().uuid().optional(),
    preview: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

export type ClientViewRemoteEvent = z.infer<typeof clientViewRemoteEventSchema>;

export function actorFieldsForClientViewEvent(body: ClientViewRemoteEvent): {
  actorId: string | null;
  actorType: CardEventActorType;
  actorLabel: string | null;
} {
  if (body.actor_source === 'business') {
    const label = body.actor?.name || body.actor?.email || 'the business';
    return {
      actorId: body.actor?.id ?? null,
      actorType: 'business',
      actorLabel: label,
    };
  }
  const label = body.actor?.name || body.actor?.email || 'SquadHub operator';
  return {
    actorId: body.actor?.id ?? null,
    actorType: 'admin',
    actorLabel: label,
  };
}

/**
 * Persist a Client-view action that happened in SquadHire (embed or the
 * customer's own portal) so the Hub feed can tell operator vs business.
 */
export async function logClientViewRemoteEvent(
  body: ClientViewRemoteEvent,
): Promise<{ ok: true; duplicate?: boolean } | { ok: false; status: number; error: string }> {
  const { data: card, error: cardErr } = await supabaseAdmin
    .from('subscription_cards')
    .select('id')
    .eq('id', body.external_id)
    .maybeSingle();
  if (cardErr) return { ok: false, status: 500, error: cardErr.message };
  if (!card) return { ok: true };

  if (body.event_id) {
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from('subscription_card_events')
      .select('id')
      .eq('card_id', card.id)
      .eq('event_type', body.event_type)
      .filter('metadata->>event_id', 'eq', body.event_id)
      .maybeSingle();
    if (existingErr) return { ok: false, status: 500, error: existingErr.message };
    if (existing) return { ok: true, duplicate: true };
  }

  const actor = actorFieldsForClientViewEvent(body);
  await logCardEvent({
    cardId: card.id,
    eventType: body.event_type as CardEventType,
    actorId: actor.actorId,
    actorType: actor.actorType,
    actorLabel: actor.actorLabel,
    metadata: {
      actor_source: body.actor_source,
      event_id: body.event_id ?? null,
      talent_user_id: body.talent_user_id ?? null,
      talent_name: body.talent_name ?? null,
      conversation_id: body.conversation_id ?? null,
      preview: body.preview ?? null,
    },
  });
  return { ok: true };
}
