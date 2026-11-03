import { z } from 'zod';

// Canonical schemas shared by admin and the authenticated business profile editor.
const photoSchema = z.object({
  url: z.string().min(1),
  caption: z.string().max(300).nullable().optional(),
});

export const businessProfileSchema = z.object({
  lead_submission_id: z.string().uuid().nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(200),
  about: z.string().max(8000).nullable().optional(),
  industry: z.string().max(200).nullable().optional(),
  company_size: z.string().max(50).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  socials: z.record(z.string()).optional(),
  logo_url: z.string().max(1000).nullable().optional(),
  photos: z.array(photoSchema).optional(),
  culture: z.string().max(8000).nullable().optional(),
  perks: z.array(z.string().max(300)).optional(),
  founded_year: z.number().int().min(1800).max(2100).nullable().optional(),
  contact_name: z.string().max(200).nullable().optional(),
  contact_email: z.string().email().nullable().optional(),
  contact_phone: z.string().max(30).nullable().optional(),
});

export const locationSchema = z.object({
  label: z.string().min(1).max(200),
  address: z.string().min(1).max(1000),
  city: z.string().max(200).nullable().optional(),
  region: z.string().max(200).nullable().optional(),
  district: z.string().max(200).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  // NULL = shared business-level venue; set = an outlet of this brand
  // (must belong to the same business profile as the location).
  brand_profile_id: z.string().uuid().nullable().optional(),
  country_id: z.string().uuid().nullable().optional(),
  postal_code: z.string().max(20).nullable().optional(),
  google_maps_url: z.string().max(1000).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  is_primary: z.boolean().optional(),
});

export const brandProfileSchema = z.object({
  name: z.string().min(1).max(200),
  about: z.string().max(8000).nullable().optional(),
  industry: z.string().max(200).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  socials: z.record(z.string()).optional(),
  logo_url: z.string().max(1000).nullable().optional(),
  photos: z.array(photoSchema).optional(),
});

// Preference-rule keys use the SquadHire matcher vocabulary (contract §3) —
// same shape as job_cards.rule_overrides minus the explicit-null semantics.
const preferenceRulesSchema = z
  .object({
    category_ids: z.array(z.string().uuid()).optional(),
    target_tiers: z.array(z.string().max(40)).optional(),
    min_experience_years: z.number().int().min(0).optional(),
    max_experience_years: z.number().int().min(0).optional(),
    target_languages: z.array(z.string().max(40)).optional(),
    target_country_names: z.array(z.string().max(120)).optional(),
    target_regions: z.array(z.string().max(120)).optional(),
    min_age: z.number().int().min(0).max(100).optional(),
    max_age: z.number().int().min(0).max(100).optional(),
    target_genders: z.array(z.string().max(30)).optional(),
    target_districts: z.array(z.string().max(120)).optional(),
  })
  .strict();

const workingHoursSchema = z.object({
  start: z.string().max(10).optional(),
  end: z.string().max(10).optional(),
  timezone: z.string().max(60).optional(),
});

export const jobProfileSchema = z.object({
  business_profile_id: z.string().uuid(),
  brand_profile_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(16000).nullable().optional(),
  responsibilities: z.array(z.string().max(1000)).optional(),
  requirements: z.array(z.string().max(1000)).optional(),
  skills: z.array(z.string().max(120)).optional(),
  min_experience_years: z.number().int().min(0).nullable().optional(),
  max_experience_years: z.number().int().min(0).nullable().optional(),
  education: z.string().max(500).nullable().optional(),
  employment_type: z.enum(['full_time', 'part_time', 'contract', 'internship']).optional(),
  work_mode: z.enum(['onsite', 'remote', 'hybrid']).optional(),
  location_id: z.string().uuid().nullable().optional(),
  working_days: z.array(z.string().max(10)).optional(),
  working_hours: workingHoursSchema.nullable().optional(),
  salary_min: z.number().int().min(0).nullable().optional(),
  salary_max: z.number().int().min(0).nullable().optional(),
  salary_currency: z.string().max(10).optional(),
  salary_period: z.enum(['monthly', 'annual']).optional(),
  benefits: z.array(z.string().max(300)).optional(),
  growth_path: z.string().max(4000).nullable().optional(),
  preference_rules: preferenceRulesSchema.optional(),
  squadhire_category_ids: z.array(z.string().uuid()).optional(),
  status: z.enum(['active', 'archived']).optional(),
});
