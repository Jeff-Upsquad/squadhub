import { logJobCardEvent } from './jobCardEvents';
import { publishJobRequirement } from './publishJobRequirement';
import { supabaseAdmin } from '../supabase';
import { publishRequirementCard } from './publishRequirementCard';
import { matchPartnersForCard } from './subscriptionCards';
import { buildSquadhirePayloadForCard, deliverCardToSquadhire } from './squadhireWebhook';
import { buildSquadhireJobPayload, deliverJobCardToSquadhire } from './squadhireJobWebhook';
import { logCardEvent } from './cardEvents';
/** Mark ready only AFTER all targeting joins have been written. The database
 * enqueues this timestamp atomically, so process restarts cannot lose work. */
export async function submitBusinessRequirement(cardId: string) {
    const { error } = await supabaseAdmin.from('subscription_cards').update({
        business_submitted_at: new Date().toISOString(),
    }).eq('id', cardId);
    if (error)
        throw error;
    void processRequirementDeliveries().catch((e) => console.error('[requirement-delivery]', e));
}
export async function broadcastRequirement(card: any): Promise<void> {
    const targets: string[] = card.publish_targets ?? ['partner', 'talent'];
    if (targets.includes('partner')) {
        await matchPartnersForCard(card.id, { staged: true });
        const { error } = await supabaseAdmin.from('subscription_card_recipients')
            .update({ broadcast_at: new Date().toISOString() }).eq('card_id', card.id)
            .is('broadcast_at', null).is('archived_at', null);
        if (error)
            throw error;
    }
    if (targets.includes('talent')) {
        const payload = await buildSquadhirePayloadForCard(card.id);
        if (!payload)
            throw new Error('Card has no deliverable SquadHire payload; check category mapping.');
        await deliverCardToSquadhire(card.id, { ...payload, notify_talents: true });
        const { data, error } = await supabaseAdmin.from('subscription_cards')
            .select('squadhire_synced_at,squadhire_sync_last_error').eq('id', card.id).single();
        if (error || !data?.squadhire_synced_at)
            throw new Error(error?.message ?? data?.squadhire_sync_last_error ?? 'SquadHire delivery failed');
    }
}
let running = false;
export async function processRequirementDeliveries(): Promise<void> {
    if (running)
        return;
    running = true;
    try {
        const { data: jobs, error } = await supabaseAdmin.rpc('claim_requirement_deliveries');
        if (error)
            throw error;
        for (const job of jobs ?? []) {
            try {
                const { data: card, error: loadError } = await supabaseAdmin.from(job.card_table).select('*').eq('id', job.card_id).single();
                if (loadError)
                    throw loadError;
                // Recall/cancel wins over delivery. Corrections are requeued when republished.
                if (!card.deleted_at && !card.archived_at && !card.cancelled_at && !card.recalled_at && card.state !== 'closed') {
                    if (job.card_table === 'subscription_cards') {
                        if (card.state === 'new') {
                            const { error } = await supabaseAdmin.from('subscription_cards').update({ state: 'draft' }).eq('id', card.id).eq('state', 'new');
                            if (error)
                                throw error;
                            card.state = 'draft';
                        }
                        if (card.state === 'draft')
                            await publishRequirementCard(card.id, null, 'broadcast');
                        const { data: current, error } = await supabaseAdmin.from('subscription_cards').select('*').eq('id', card.id).single();
                        if (error)
                            throw error;
                        let siblings = [current];
                        if (current.brief_group_id) {
                            const group = await supabaseAdmin.from('subscription_cards').select('*').eq('brief_group_id', current.brief_group_id);
                            if (group.error)
                                throw group.error;
                            siblings = group.data ?? [];
                        }
                        for (const sibling of siblings) {
                            if (sibling.state !== 'published' || sibling.recalled_at || sibling.archived_at || sibling.deleted_at)
                                continue;
                            await broadcastRequirement(sibling);
                            await logCardEvent({ cardId: sibling.id, eventType: 'broadcast', actorType: 'system', metadata: { automatic: true } });
                        }
                    }
                    else {
                        // Job cards require the canonical business/job profile before going live.
                        if (card.state === 'new' || card.state === 'onboarding')
                            await publishJobRequirement(card.id, null, 'broadcast');
                        const payload = await buildSquadhireJobPayload(card.id);
                        if (!payload)
                            throw new Error('Complete the linked job and business profiles before delivery.');
                        await deliverJobCardToSquadhire(card.id, { ...payload, notify_talents: true });
                        const { data } = await supabaseAdmin.from('job_cards').select('squadhire_synced_at').eq('id', card.id).single();
                        if (!data?.squadhire_synced_at)
                            throw new Error('Job delivery failed');
                        await logJobCardEvent({ cardId: card.id, eventType: 'broadcast', actorType: 'system', metadata: { automatic: true } });
                    }
                }
                const { error } = await supabaseAdmin.from('requirement_delivery_queue').update({ completed_at: new Date().toISOString(), claimed_at: null, last_error: null })
                    .eq('card_table', job.card_table).eq('card_id', job.card_id).eq('requested_at', job.requested_at);
                if (error)
                    throw error;
            }
            catch (e: any) {
                await supabaseAdmin.from('requirement_delivery_queue').update({ claimed_at: null, last_error: String(e.message ?? e).slice(0, 1000),
                    available_at: new Date(Date.now() + Math.min(60, 2 ** Math.min(job.attempts, 6)) * 60000).toISOString() })
                    .eq('card_table', job.card_table).eq('card_id', job.card_id).eq('requested_at', job.requested_at);
                console.error('[requirement-delivery] card failed', job.card_id, e.message);
            }
        }
    }
    finally {
        running = false;
    }
}
export function startRequirementDeliveryWorker() {
    const tick = () => void processRequirementDeliveries().catch((e) => console.error('[requirement-delivery]', e.message));
    tick();
    setInterval(tick, 15000).unref();
}
