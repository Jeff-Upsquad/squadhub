import { z } from 'zod';

// SquadHire's application-decision notices (Profiles'
// application-decision.service sends `application_${decision}`). Each kind is
// written verbatim as notifications.type, so a new kind also needs adding to
// notifications_type_check — the test guards that.
export const TALENT_NOTICE_KINDS = [
  'application_approved',
  'application_rejected',
  'application_restored',
] as const;

// One-off SquadHire notice for a talent (application approved / rejected /
// restored). Addressed by email because the talent may not hold a SquadHub
// account yet — unknown emails are skipped, not errors.
export const talentNoticeSchema = z
  .object({
    kind: z.enum(TALENT_NOTICE_KINDS),
    title: z.string().min(1).max(200),
    body: z.string().max(1000).optional().default(''),
    route: z.string().max(200).optional().default('/notifications'),
    emails: z.array(z.string().email()).min(1).max(50),
  })
  .strict();
