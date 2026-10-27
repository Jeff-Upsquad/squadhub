import { supabaseAdmin } from '../supabase';
export async function publishJobRequirement(cardId: string, actorId: string | null, distribution?: 'broadcast' | 'manual') {
    const card = (await supabaseAdmin.from('job_cards').select('*').eq('id', cardId).maybeSingle()).data;
    if (!card || card.deleted_at) {
        throw Object.assign(new Error('Job card not found'), { status: 404 });
    }
    if (card.state !== 'onboarding') {
        throw Object.assign(new Error(card.state === 'new'
            ? 'Complete onboarding (attach a job profile) before publishing'
            : 'Card is already published or closed'), { status: 409 });
    }
    if (!card.job_profile_id) {
        throw Object.assign(new Error('Attach a job profile before publishing'), { status: 400 });
    }
    // Completeness gate — fail closed at publish time so a broken card never
    // reaches SquadHire (mirrors the subscription tier-required gate).
    const { data: profile } = await supabaseAdmin
        .from('job_profiles')
        .select('id, title, status, deleted_at, squadhire_category_ids, business_profile_id')
        .eq('id', card.job_profile_id)
        .maybeSingle();
    if (!profile || profile.deleted_at || profile.status !== 'active') {
        throw Object.assign(new Error('The linked job profile is missing or archived'), { status: 400 });
    }
    const categoryIds = Array.isArray(profile.squadhire_category_ids)
        ? (profile.squadhire_category_ids as string[])
        : [];
    if (categoryIds.length === 0) {
        throw Object.assign(new Error('Pick at least one SquadHire category on the job profile — without it the card cannot be broadcast.'), { status: 400 });
    }
    const { data: business } = await supabaseAdmin
        .from('business_profiles')
        .select('id, deleted_at')
        .eq('id', profile.business_profile_id)
        .maybeSingle();
    if (!business || business.deleted_at) {
        throw Object.assign(new Error('The linked business profile is missing'), { status: 400 });
    }
    const selectedDistribution = distribution ?? card.distribution ?? 'broadcast';
    const { data: updated, error: updErr } = await supabaseAdmin
        .from('job_cards')
        .update({
        state: 'published',
        distribution: selectedDistribution,
        published_at: new Date().toISOString(),
        published_by: actorId,
        recalled_at: null,
        squadhire_synced_at: null, squadhire_sync_attempts: 0, squadhire_sync_last_error: null,
    })
        .eq('id', cardId)
        .eq('state', 'onboarding')
        .select('*')
        .maybeSingle();
    if (updErr) {
        throw Object.assign(new Error(updErr.message), { status: 500 });
    }
    if (!updated) {
        throw Object.assign(new Error('Card state changed — refresh and try again'), { status: 409 });
    }
    return updated;
}
