import { z } from 'zod';
import { hiringIdentitySchema } from './businessHiringProfiles';

// A card references saved, canonical profiles; it never embeds a second profile draft.
export const jobBriefSchema = hiringIdentitySchema.extend({
  request_id: z.string().uuid(),
  job_profile_id: z.string().uuid(),
  category_name: z.string().trim().min(1).max(200),
  openings_count: z.number().int().min(1).max(500).default(1),
  expected_joining_date: z.string().date().optional(),
});
