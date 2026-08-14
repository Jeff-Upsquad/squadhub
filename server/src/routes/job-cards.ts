import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';
import { categorizeJobCard } from '../utils/jobStage';

/**
 * Job Cards — client-facing view.
 *
 * GET /job-cards/mine lists the job cards that belong to the logged-in
 * client. Resolution mirrors how clients are identified elsewhere: the
 * account email matched (case-insensitively) against the converted clients
 * rows AND against the lead submissions — job cards link both via DIRECT FKs
 * (lead_submission_id / client_id), so no read-time brief re-matching.
 */

const router = Router();

router.use(requireAuth);

router.get('/mine', async (req: Request, res: Response) => {
  try {
    const email = req.userEmail?.trim().toLowerCase();
    if (!email) {
      res.json({ success: true, data: [] });
      return;
    }

    // Resolve the user's clients/submissions by email first (the historical
    // path), then fall back to id-based resolution via client_user_access so
    // job cards keep showing even if the email copies are stale.
    let [{ data: clients }, { data: submissions }] = await Promise.all([
      supabaseAdmin.from('clients').select('id, submission_id').ilike('email', email),
      supabaseAdmin.from('client_submissions').select('id').ilike('email', email),
    ]);
    let clientIds = (clients ?? []).map((c: any) => c.id as string);
    let submissionIds = (submissions ?? []).map((s: any) => s.id as string);

    if (clientIds.length === 0 && submissionIds.length === 0 && req.userId) {
      const { data: access } = await supabaseAdmin
        .from('client_user_access')
        .select('client_id')
        .eq('user_id', req.userId);
      const accessClientIds = Array.from(
        new Set((access ?? []).map((a: any) => a.client_id as string)),
      );
      if (accessClientIds.length > 0) {
        const { data: accessClients } = await supabaseAdmin
          .from('clients')
          .select('id, submission_id')
          .in('id', accessClientIds);
        clientIds = (accessClients ?? []).map((c: any) => c.id as string);
        submissionIds = (accessClients ?? [])
          .map((c: any) => c.submission_id as string)
          .filter(Boolean);
      }
    }

    if (clientIds.length === 0 && submissionIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const orParts: string[] = [];
    if (clientIds.length > 0) orParts.push(`client_id.in.(${clientIds.join(',')})`);
    if (submissionIds.length > 0) orParts.push(`lead_submission_id.in.(${submissionIds.join(',')})`);

    const { data: cards, error } = await supabaseAdmin
      .from('job_cards')
      .select('*')
      .or(orParts.join(','))
      .is('deleted_at', null)
      .is('archived_at', null)
      .order('created_at', { ascending: false });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const list = cards ?? [];
    const profileIds = Array.from(new Set(list.map((c: any) => c.job_profile_id).filter(Boolean))) as string[];
    const profileById: Record<string, any> = {};
    const businessById: Record<string, any> = {};
    const brandById: Record<string, any> = {};
    if (profileIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('job_profiles')
        .select('id, title, business_profile_id, brand_profile_id, employment_type, work_mode, salary_min, salary_max, salary_currency, salary_period')
        .in('id', profileIds);
      (profiles ?? []).forEach((p: any) => { profileById[p.id] = p; });
      const businessIds = Array.from(new Set((profiles ?? []).map((p: any) => p.business_profile_id).filter(Boolean)));
      const brandIds = Array.from(new Set((profiles ?? []).map((p: any) => p.brand_profile_id).filter(Boolean)));
      const [{ data: businesses }, { data: brands }] = await Promise.all([
        businessIds.length > 0
          ? supabaseAdmin.from('business_profiles').select('id, name, logo_url').in('id', businessIds)
          : Promise.resolve({ data: [] } as { data: any[] }),
        brandIds.length > 0
          ? supabaseAdmin.from('brand_profiles').select('id, name, logo_url').in('id', brandIds)
          : Promise.resolve({ data: [] } as { data: any[] }),
      ]);
      (businesses ?? []).forEach((b: any) => { businessById[b.id] = b; });
      (brands ?? []).forEach((b: any) => { brandById[b.id] = b; });
    }

    res.json({
      success: true,
      data: list.map((card: any) => {
        const profile = card.job_profile_id ? profileById[card.job_profile_id] ?? null : null;
        return {
          ...card,
          stage: categorizeJobCard(card),
          job_profile: profile,
          business_profile: profile?.business_profile_id ? businessById[profile.business_profile_id] ?? null : null,
          brand_profile: profile?.brand_profile_id ? brandById[profile.brand_profile_id] ?? null : null,
        };
      }),
    });
  } catch (err: any) {
    console.error('List my job cards error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
