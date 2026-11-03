import { supabaseAdmin } from '../supabase';
import { buildSquadhireJobPayload, deliverJobCardToSquadhire } from './squadhireJobWebhook';

export async function redeliverPublishedCardsForJobProfiles(jobProfileIds: string[]): Promise<void> {
  if (jobProfileIds.length === 0) return;
  const { data: cards } = await supabaseAdmin
    .from('job_cards')
    .select('id')
    .in('job_profile_id', jobProfileIds)
    .eq('state', 'published')
    .not('published_at', 'is', null)
    .is('deleted_at', null);
  for (const card of cards ?? []) {
    buildSquadhireJobPayload(card.id)
      .then((payload) => payload && deliverJobCardToSquadhire(card.id, payload))
      .catch((err) => console.error('[job-profiles] redelivery error', err));
  }
}

export async function redeliverForBusinessProfile(businessProfileId: string): Promise<void> {
  const { data: profiles } = await supabaseAdmin
    .from('job_profiles')
    .select('id')
    .eq('business_profile_id', businessProfileId)
    .is('deleted_at', null);
  await redeliverPublishedCardsForJobProfiles((profiles ?? []).map((p: any) => p.id as string));
}

export async function redeliverForBrandProfile(brandProfileId: string): Promise<void> {
  const { data: profiles } = await supabaseAdmin
    .from('job_profiles')
    .select('id')
    .eq('brand_profile_id', brandProfileId)
    .is('deleted_at', null);
  await redeliverPublishedCardsForJobProfiles((profiles ?? []).map((p: any) => p.id as string));
}
