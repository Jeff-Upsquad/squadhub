import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import { ensureHubContact } from './leadLookup';
import { businessProfileSchema, brandProfileSchema, jobProfileSchema, locationSchema } from './jobProfileSchemas';
import { redeliverForBusinessProfile, redeliverForBrandProfile, redeliverPublishedCardsForJobProfiles } from './jobProfileDelivery';

export const hiringIdentitySchema = z.object({
  business_user_id: z.string().uuid(), email: z.string().email(),
  phone: z.string().max(40).optional(), contact_name: z.string().max(200).optional(),
});
export type HiringIdentity = z.infer<typeof hiringIdentitySchema>;
export const profileKindSchema = z.enum(['business', 'brand', 'job', 'location']);
export type ProfileKind = z.infer<typeof profileKindSchema>;
export function hiringError(message: string, status = 400): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}
function check(error: { message: string } | null) { if (error) throw hiringError(error.message, 500); }
const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

// Identity comes ONLY from Profiles' authenticated backend, through the signed bridge.
// Never accept a business/brand/job ID as evidence of ownership.
export async function ownedBusinesses(identity: HiringIdentity): Promise<any[]> {
  const [byId, byEmail] = await Promise.all([
    supabaseAdmin.from('client_submissions').select('id').eq('squadhire_business_user_id', identity.business_user_id),
    supabaseAdmin.from('client_submissions').select('id').ilike('email', escapeLike(identity.email.toLowerCase())),
  ]);
  check(byId.error); check(byEmail.error);
  const submissionIds = [...new Set([...(byId.data ?? []), ...(byEmail.data ?? [])].map((r: any) => r.id))];
  if (!submissionIds.length) return [];
  const clients = await supabaseAdmin.from('clients').select('id').in('submission_id', submissionIds);
  check(clients.error);
  const clientIds = (clients.data ?? []).map((r: any) => r.id);
  const filters = [`lead_submission_id.in.(${submissionIds.join(',')})`];
  if (clientIds.length) filters.push(`client_id.in.(${clientIds.join(',')})`);
  const result = await supabaseAdmin.from('business_profiles').select('*').or(filters.join(','))
    .is('deleted_at', null).order('updated_at', { ascending: false });
  check(result.error);
  return result.data ?? [];
}
export async function hiringProfiles(identity: HiringIdentity) {
  const businesses = await ownedBusinesses(identity);
  const ids = businesses.map((b: any) => b.id);
  if (!ids.length) return { businesses, brands: [], jobs: [], locations: [] };
  const [brands, jobs, locations] = await Promise.all([
    supabaseAdmin.from('brand_profiles').select('*').in('business_profile_id', ids).is('deleted_at', null).order('created_at'),
    supabaseAdmin.from('job_profiles').select('*').in('business_profile_id', ids).is('deleted_at', null).order('updated_at', { ascending: false }),
    supabaseAdmin.from('business_locations').select('*').in('business_profile_id', ids).order('created_at'),
  ]);
  for (const result of [brands, jobs, locations]) check(result.error);
  return { businesses, brands: brands.data ?? [], jobs: jobs.data ?? [], locations: locations.data ?? [] };
}
export async function assertOwnedBusiness(identity: HiringIdentity, id: string) {
  const business = (await ownedBusinesses(identity)).find((b: any) => b.id === id);
  if (!business) throw hiringError('This business profile does not belong to your account.', 403);
  return business;
}
async function child(table: string, id: string, businessId: string) {
  let query = supabaseAdmin.from(table).select('*').eq('id', id).eq('business_profile_id', businessId);
  if (table !== 'business_locations') query = query.is('deleted_at', null);
  const result = await query.maybeSingle(); check(result.error);
  if (!result.data) throw hiringError('The selected profile or location belongs to a different business or is unavailable.', 403);
  return result.data;
}

export async function saveHiringProfile(identity: HiringIdentity, kind: ProfileKind, id: string, raw: Record<string, unknown>) {
  const tables = { business: 'business_profiles', brand: 'brand_profiles', job: 'job_profiles', location: 'business_locations' };
  const table = tables[kind];
  let body: Record<string, any>;
  let parent: any;
  if (kind === 'business') {
    // Owner columns are always server-resolved, never copied from the browser.
    body = businessProfileSchema.omit({ lead_submission_id: true, client_id: true }).parse(raw);
  } else {
    const businessId = z.string().uuid().parse(raw.business_profile_id);
    parent = await assertOwnedBusiness(identity, businessId);
    if (kind === 'brand') body = { ...brandProfileSchema.parse(raw), business_profile_id: businessId };
    else if (kind === 'location') body = { ...locationSchema.parse(raw), business_profile_id: businessId };
    else {
      body = jobProfileSchema.parse(raw);
      if (body.brand_profile_id) await child('brand_profiles', body.brand_profile_id, businessId);
      if (body.location_id) await child('business_locations', body.location_id, businessId);
      if (!body.squadhire_category_ids?.length) throw hiringError('Choose at least one talent category.');
      if (body.min_experience_years != null && body.max_experience_years != null && body.max_experience_years < body.min_experience_years) throw hiringError('Maximum experience must be at least the minimum.');
      if (body.salary_min != null && body.salary_max != null && body.salary_max < body.salary_min) throw hiringError('Maximum salary must be at least the minimum.');
      if (body.work_mode !== 'remote' && !body.location_id) throw hiringError('Choose a work location for an on-site or hybrid role.');
    }
  }
  let existingQuery = supabaseAdmin.from(table).select('*').eq('id', id);
  if (kind !== 'location') existingQuery = existingQuery.is('deleted_at', null);
  const existing = await existingQuery.maybeSingle(); check(existing.error);
  if (existing.data) {
    if (kind === 'business') await assertOwnedBusiness(identity, id);
    else if (existing.data.business_profile_id !== parent.id) throw hiringError('This profile does not belong to the selected business.', 403);
  } else if (kind === 'business') {
    const { submission, client } = await ensureHubContact({ email: identity.email, phone: identity.phone,
      contact_name: identity.contact_name || body.contact_name, business_name: body.name });
    if (!submission) throw hiringError('Could not link the business profile to your account.', 502);
    const owners = await ownedBusinesses(identity);
    if (owners.length) throw hiringError('A business profile already exists. Select it to edit or continue.', 409);
    body.lead_submission_id = submission.id; body.client_id = client?.id ?? null;
  }
  const result = existing.data
    ? await supabaseAdmin.from(table).update(body).eq('id', id).select('*').single()
    : await supabaseAdmin.from(table).insert({ ...body, id }).select('*').single();
  check(result.error);
  if (!result.data) throw hiringError('The profile could not be saved.', 500);
  if (existing.data) {
    const refresh = kind === 'business' || kind === 'location' ? redeliverForBusinessProfile(kind === 'business' ? id : parent.id)
      : kind === 'brand' ? redeliverForBrandProfile(id) : redeliverPublishedCardsForJobProfiles([id]);
    void refresh.catch((error) => console.error('[business-profiles] published snapshot refresh failed', error.message));
  }
  return result.data;
}

export async function ownedHiringJob(identity: HiringIdentity, jobId: string) {
  const result = await supabaseAdmin.from('job_profiles').select('*').eq('id', jobId).is('deleted_at', null).maybeSingle();
  check(result.error);
  if (!result.data) throw hiringError('Job profile not found.', 404);
  const job = result.data;
  const business = await assertOwnedBusiness(identity, job.business_profile_id);
  if (job.status !== 'active') throw hiringError('Choose an active job profile.');
  const brand = job.brand_profile_id ? await child('brand_profiles', job.brand_profile_id, business.id) : null;
  const location = job.location_id ? await child('business_locations', job.location_id, business.id) : null;
  return { job, business, brand, location };
}
