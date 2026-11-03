import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { jobBriefSchema } from '../../utils/jobBriefSchema';
import { hiringIdentitySchema, profileKindSchema, saveHiringProfile, hiringProfiles, ownedHiringJob, hiringError } from '../../utils/businessHiringProfiles';
import { resolveCrmCardAssigneesFromSubmission } from '../../utils/cardCrmAssignees';
import { supabaseAdmin } from '../../supabase';
import { logJobCardEvent } from '../../utils/jobCardEvents';
import { jobCardContent } from '../../utils/jobCardContent';

// Every route is mounted behind verifySquadhireCallbackSecret in the parent.
const router = Router();
function failure(err: any, res: Response) {
  if (err instanceof z.ZodError) {
    res.status(400).json({ success: false, error: err.errors.map((e) => e.message).join(' ') }); return;
  }
  console.error('[business-hiring]', err.message);
  res.status(err.status ?? 500).json({ success: false, error: err.status ? err.message : 'Could not save your hiring details. Please try again.' });
}
router.get('/profiles', async (req: Request, res: Response) => {
  try { res.json({ success: true, data: await hiringProfiles(hiringIdentitySchema.parse(req.query)) }); }
  catch (err) { failure(err, res); }
});
router.post('/profiles/:kind', async (req: Request, res: Response) => {
  try {
    const identity = hiringIdentitySchema.parse(req.body);
    const body = z.object({ id: z.string().uuid(), data: z.record(z.unknown()) }).parse(req.body);
    const profile = await saveHiringProfile(identity, profileKindSchema.parse(req.params.kind), body.id, body.data);
    res.json({ success: true, data: profile });
  } catch (err) { failure(err, res); }
});
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = jobBriefSchema.parse(req.body);
    const existing = await supabaseAdmin.from('job_cards').select('*').eq('id', body.request_id).maybeSingle();
    if (existing.error) throw existing.error;
    const { job, business, brand, location } = await ownedHiringJob(body, existing.data?.job_profile_id || body.job_profile_id);
    if (!job.squadhire_category_ids?.length) throw hiringError('Add a talent category to the job profile before submitting.');
    let card = existing.data;
    if (card) {
      if (card.customer_email?.toLowerCase() !== body.email.toLowerCase()) throw hiringError('This request ID is already in use.', 409);
    } else {
      const submission = business.lead_submission_id
        ? (await supabaseAdmin.from('client_submissions').select('*').eq('id', business.lead_submission_id).maybeSingle()).data : null;
      const role = ({ Designers: 'Designers', 'Video Editors': 'Editors', 'Designer + Editor': 'Designer plus Editor' } as Record<string, string>)[body.category_name] ?? body.category_name;
      const assignees = await resolveCrmCardAssigneesFromSubmission(submission, role);
      const result = await supabaseAdmin.from('job_cards').insert({
        id: body.request_id, source: 'shared_form', state: 'onboarding', job_profile_id: job.id,
        lead_submission_id: business.lead_submission_id, client_id: business.client_id,
        ...assignees, role_service_type: role, brief_note: job.description,
        customer_name: body.contact_name || business.contact_name, customer_company: business.name,
        customer_email: body.email, customer_phone: body.phone || business.contact_phone,
        customer_location: location?.address ?? null,
        package_min: job.salary_min, package_max: job.salary_max,
        package_currency: job.salary_currency, package_period: job.salary_period,
        openings_count: body.openings_count, expected_joining_date: body.expected_joining_date ?? null,
      }).select('*').single();
      if (result.error) throw result.error;
      card = result.data;
      await logJobCardEvent({ cardId: card.id, eventType: 'created', actorType: 'business',
        actorId: body.business_user_id, actorLabel: body.contact_name,
        metadata: { source: 'shared_form', job_profile_id: job.id } });
    }
    // Same snapshot builder admin publishing uses; no talent distribution here.
    res.status(existing.data ? 200 : 201).json({ success: true, data: {
      card, content: jobCardContent(card, job, business, brand, location),
    } });
  } catch (err) { failure(err, res); }
});
export default router;
