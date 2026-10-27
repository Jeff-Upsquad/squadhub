import { SERVICE_TYPE_TO_SLUG } from '@squadhub/shared';
import { supabaseAdmin } from '../supabase';
import { fanOutTierCards, matchPartnersForCard } from './subscriptionCards';
import { expandBroadcastTiersForPublish, tierHasPublishablePrice } from './subscriptionFormPricing';
import { logCardEvent } from './cardEvents';
/** Shared by manual publishing and the durable business-submission worker. */
export async function publishRequirementCard(cardId: string, actorId: string | null, distribution: 'broadcast' | 'manual', actorName: string | null = null) {
    const { data: card } = await supabaseAdmin
        .from('subscription_cards')
        .select('*')
        .eq('id', cardId)
        .maybeSingle();
    if (!card) {
        throw Object.assign(new Error('Card not found'), { status: 404 });
    }
    if (card.state !== 'draft') {
        throw Object.assign(new Error('Only draft cards can be published'), { status: 409 });
    }
    // Ensure squadhire_category_ids are synced to the current service_type
    const currentServiceType = card.service_type as string | null | undefined;
    const subscriptionSlug = currentServiceType ? SERVICE_TYPE_TO_SLUG[currentServiceType] : null;
    if (subscriptionSlug) {
        const { data: subRow } = await supabaseAdmin
            .from('subscriptions')
            .select('id')
            .eq('slug', subscriptionSlug)
            .maybeSingle();
        if (subRow?.id) {
            const { data: profileRows } = await supabaseAdmin
                .from('subscription_squadhire_profiles')
                .select('squadhire_category_id')
                .eq('subscription_id', subRow.id);
            if (profileRows && profileRows.length > 0) {
                const categoryIds = profileRows.map((r: any) => r.squadhire_category_id);
                const { error: categoryError } = await supabaseAdmin
                    .from('subscription_cards')
                    .update({ squadhire_category_ids: categoryIds })
                    .eq('id', cardId);
                if (categoryError)
                    throw categoryError;
                card.squadhire_category_ids = categoryIds;
            }
        }
    }
    const publishTargets: string[] = card.publish_targets || ['partner', 'talent'];
    if (publishTargets.length === 0) {
        throw Object.assign(new Error('At least one publish target required'), { status: 400 });
    }
    if (publishTargets.includes('talent') && !card.squadhire_category_ids?.length) {
        throw Object.assign(new Error('Add the SquadHire category mapping before broadcasting this requirement.'), { status: 400 });
    }
    // Both card types expand to all three standard tiers on publish.
    // Subscription: selected levels keep their set Final price; unselected
    // levels go out as "request quote" (no fixed price, talent quotes).
    // Assignment: same — unpriced tiers are "inviting bids" (proposed_price 0).
    // Expand before fan-out so one card per level reaches talent.
    const selectedTiers: string[] = Array.isArray(card.target_tiers)
        ? (card.target_tiers as string[]).filter(Boolean)
        : [];
    const rawTierPricing: Record<string, {
        proposed_price?: number | null;
        markup?: number | null;
        subscription_price?: number | null;
        client_budget?: number | null;
    }> = card.tier_pricing && typeof card.tier_pricing === 'object'
        ? (card.tier_pricing as any)
        : {};
    // Country for catalog seed (card targeting join, else null → India fallback).
    const { data: countryRows } = await supabaseAdmin
        .from('subscription_card_target_countries')
        .select('country_id')
        .eq('card_id', cardId)
        .limit(1);
    const countryId = Array.isArray(countryRows) && countryRows[0]?.country_id
        ? String(countryRows[0].country_id)
        : null;
    let targetTiers: string[];
    let tierPricing: Record<string, {
        proposed_price?: number | null;
        markup?: number | null;
        subscription_price?: number | null;
        client_budget?: number | null;
    }>;
    if (card.card_type === 'assignment') {
        // Assignments broadcast to ALL three standard tiers, just like
        // subscription cards.  Tiers the client/admin set a budget for keep
        // their price; tiers without a budget go out as "inviting bids"
        // (proposed_price 0 = no fixed price, talent is invited to quote).
        // Agencies is a delivery option alongside talent tiers — also auto-broadcasts as request-quote when not selected.
        const ALL_TIERS = ['Top Talents', 'Pro', 'Junior', 'Agencies'];
        const ordered: string[] = [];
        for (const t of selectedTiers) {
            if (!ordered.includes(t))
                ordered.push(t);
        }
        for (const t of ALL_TIERS) {
            if (!ordered.includes(t))
                ordered.push(t);
        }
        targetTiers = ordered;
        tierPricing = {};
        for (const t of targetTiers) {
            const existing = rawTierPricing[t];
            if (existing && (existing.proposed_price ?? 0) > 0) {
                tierPricing[t] = existing;
            }
            else {
                // Inviting bids — no fixed price.
                tierPricing[t] = {
                    proposed_price: 0,
                    markup: null,
                    subscription_price: null,
                    ...(existing?.client_budget != null ? { client_budget: existing.client_budget } : {}),
                };
            }
        }
    }
    else {
        const expanded = await expandBroadcastTiersForPublish({
            serviceType: card.service_type,
            planName: card.plan_name,
            countryId,
            selectedTiers,
            existingPricing: rawTierPricing,
        });
        targetTiers = expanded.targetTiers;
        tierPricing = expanded.tierPricing;
        console.info('[publish] expanded broadcast tiers', {
            cardId,
            selectedTiers,
            broadcastTiers: targetTiers,
        });
    }
    if (targetTiers.length === 0) {
        throw Object.assign(new Error('No levels to broadcast — set a plan and pricing, or pick a level.'), { status: 400 });
    }
    for (const tier of targetTiers) {
        // Request-quote tiers (proposed_price 0, no Final) are publishable
        // for both subscriptions and assignments — allowInvite true.
        const allowInvite = true;
        if (!tierHasPublishablePrice(tierPricing[tier], allowInvite)) {
            throw Object.assign(new Error(`Missing pricing for tier "${tier}"`), { status: 400 });
        }
    }
    // Keep the client's selected tiers intact until the atomic publication
    // commits. A failed attempt must not turn unselected quote tiers into
    // selected catalog-priced tiers on retry.
    // Fan out — one published card per broadcast tier.
    let cardIds: string[];
    try {
        cardIds = await fanOutTierCards(cardId, actorId, distribution, { targetTiers, tierPricing });
    }
    catch (err: any) {
        throw Object.assign(new Error(err?.message ?? 'Fan-out failed'), { status: 500 });
    }
    // Publish builds the staged recipient list but SENDS NOTHING. The separate
    // "Broadcast" action releases partners (broadcast_at) and delivers to
    // SquadHire. Broadcast mode auto-matches every qualifying partner into the
    // staged list (broadcast_at = NULL, invisible until broadcast); soft-publish
    // (manual) starts empty and the admin hand-picks recipients.
    if (publishTargets.includes('partner') && distribution === 'broadcast') {
        for (const cid of cardIds) {
            await matchPartnersForCard(cid, { staged: true });
        }
    }
    const { data: updated } = await supabaseAdmin
        .from('subscription_cards')
        .select('*')
        .eq('id', cardId)
        .single();
    await logCardEvent({
        cardId,
        eventType: distribution === 'manual' ? 'soft_published' : 'published',
        actorId: actorId ?? null,
        actorType: actorId ? 'admin' : 'system',
        actorLabel: actorName ?? null,
        metadata: {
            distribution,
            publish_targets: publishTargets,
            child_card_ids: cardIds.slice(1),
        },
    });
    return { card: updated, cardIds };
}
