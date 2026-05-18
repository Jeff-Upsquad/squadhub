import { supabaseAdmin } from '../supabase';

export const PIPELINE_STATUSES = [
  'new',
  'in_progress',
  'selection',
  'converted',
  'onboarding',
  'closed',
] as const;

export type PipelineStatus = typeof PIPELINE_STATUSES[number];

export function isPipelineStatus(v: unknown): v is PipelineStatus {
  return typeof v === 'string' && (PIPELINE_STATUSES as readonly string[]).includes(v);
}

export type TransitionResult =
  | { ok: true; status: PipelineStatus; clientId: string | null }
  | { ok: false; code: number; error: string };

async function copyPlanDeliverables(clientSubscriptionId: string, planId: string) {
  const { data: planDelivs } = await supabaseAdmin
    .from('subscription_plan_deliverables')
    .select('*')
    .eq('plan_id', planId)
    .order('sort_order');

  if (!planDelivs || planDelivs.length === 0) return;

  const rows = planDelivs.map((d: any) => ({
    client_subscription_id: clientSubscriptionId,
    source_plan_deliverable_id: d.id,
    kind: d.kind,
    deliverable_type_id: d.deliverable_type_id,
    per_day: d.per_day,
    per_week: d.per_week,
    per_month: d.per_month,
    sort_order: d.sort_order,
  }));

  await supabaseAdmin.from('client_subscription_deliverables').insert(rows);
}

export async function attachStagedSubsToClient(
  clientId: string,
  stagedSubs: any[],
): Promise<void> {
  if (!stagedSubs || stagedSubs.length === 0) return;

  const inserts = stagedSubs.map((s: any) => ({
    client_id: clientId,
    subscription_id: s.subscription_id,
    plan_id: s.plan_id,
  }));

  const { data: cs, error: csErr } = await supabaseAdmin
    .from('client_subscriptions')
    .insert(inserts)
    .select();

  if (csErr) {
    throw new Error(csErr.message);
  }

  await Promise.all(
    (cs || []).map((row: any) => copyPlanDeliverables(row.id, row.plan_id)),
  );
}

async function materialiseClientFromSubmission(submission: any, stagedSubs: any[]) {
  const { data: existing } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('submission_id', submission.id)
    .maybeSingle();

  if (existing) return { clientId: existing.id as string, created: false };

  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .insert({
      submission_id: submission.id,
      business_name: submission.business_name,
      contact_person: submission.contact_person,
      designation: submission.designation,
      contact_number: submission.contact_number,
      email: submission.email,
      business_address: submission.business_address,
      gst_registered: submission.gst_registered,
      gst_number: submission.gst_number,
      accounts_email: submission.accounts_email,
      country_id: submission.country_id,
      primary_sales_person_id: submission.primary_sales_person_id || null,
      secondary_sales_person_id: submission.secondary_sales_person_id || null,
    })
    .select()
    .single();

  if (clientErr || !client) {
    throw new Error(clientErr?.message || 'Failed to create client');
  }

  await attachStagedSubsToClient(client.id, stagedSubs);

  return { clientId: client.id as string, created: true };
}

export type ClientMatchReason = 'submission_id' | 'business_name' | 'email' | 'phone';

export type ExistingClientMatch = {
  id: string;
  business_name: string;
  submission_id: string | null;
  matchedBy: ClientMatchReason;
};

// Look up an existing client that should "absorb" this lead's staged subscriptions.
// Priority: submission_id (lead previously converted) → business_name (trim+lower exact) → email (ilike) → phone (digit-suffix).
// Skips matches whose id we've already seen at a higher-priority rule; warns if rules disagree.
export async function findExistingClientForSubmission(
  submission: any,
): Promise<ExistingClientMatch | null> {
  if (!submission) return null;

  const submissionId: string | undefined = submission.id;
  const businessName: string | undefined = (submission.business_name ?? '').toString().trim();
  const email: string | undefined = (submission.email ?? '').toString().trim();
  const rawPhone: string | undefined = (submission.contact_number ?? '').toString().trim();

  const candidates: ExistingClientMatch[] = [];

  if (submissionId) {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('id, business_name, submission_id')
      .eq('submission_id', submissionId)
      .limit(1);
    if (error) throw new Error(error.message);
    if (data && data.length > 0) {
      candidates.push({
        id: data[0].id,
        business_name: data[0].business_name,
        submission_id: data[0].submission_id,
        matchedBy: 'submission_id',
      });
    }
  }

  if (businessName) {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('id, business_name, submission_id')
      .ilike('business_name', businessName)
      .limit(5);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const same = (row.business_name ?? '').toString().trim().toLowerCase() === businessName.toLowerCase();
      if (same && !candidates.some((c) => c.id === row.id)) {
        candidates.push({
          id: row.id,
          business_name: row.business_name,
          submission_id: row.submission_id,
          matchedBy: 'business_name',
        });
      }
    }
  }

  if (email && email.includes('@')) {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('id, business_name, submission_id')
      .ilike('email', email)
      .limit(5);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (!candidates.some((c) => c.id === row.id)) {
        candidates.push({
          id: row.id,
          business_name: row.business_name,
          submission_id: row.submission_id,
          matchedBy: 'email',
        });
      }
    }
  }

  if (rawPhone) {
    const cleaned = rawPhone.replace(/\D/g, '');
    if (cleaned.length >= 7) {
      const { data, error } = await supabaseAdmin
        .from('clients')
        .select('id, business_name, submission_id, contact_number')
        .ilike('contact_number', `%${cleaned.slice(-10)}`)
        .limit(5);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        if (!candidates.some((c) => c.id === row.id)) {
          candidates.push({
            id: row.id,
            business_name: row.business_name,
            submission_id: row.submission_id,
            matchedBy: 'phone',
          });
        }
      }
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    const distinctIds = Array.from(new Set(candidates.map((c) => c.id)));
    if (distinctIds.length > 1) {
      console.warn(
        '[findExistingClientForSubmission] Multiple distinct client candidates for submission',
        submissionId,
        candidates.map((c) => ({ id: c.id, matchedBy: c.matchedBy, business_name: c.business_name })),
      );
    }
  }

  return candidates[0];
}

// Attach a lead's staged subscriptions onto an already-existing client and mark the lead as converted.
// Used when findExistingClientForSubmission returns a hit — we don't want to create a duplicate clients row.
export async function attachSubmissionToExistingClient(
  submissionId: string,
  clientId: string,
): Promise<TransitionResult> {
  const { data: submission, error: subErr } = await supabaseAdmin
    .from('client_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle();

  if (subErr) return { ok: false, code: 500, error: subErr.message };
  if (!submission) return { ok: false, code: 404, error: 'Submission not found' };

  const { data: stagedSubs, error: stagedErr } = await supabaseAdmin
    .from('client_submission_subscriptions')
    .select('*')
    .eq('submission_id', submissionId);

  if (stagedErr) return { ok: false, code: 500, error: stagedErr.message };
  if (!stagedSubs || stagedSubs.length === 0) {
    return {
      ok: false,
      code: 400,
      error: 'At least one subscription must be selected before converting this lead.',
    };
  }

  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, submission_id')
    .eq('id', clientId)
    .maybeSingle();

  if (clientErr) return { ok: false, code: 500, error: clientErr.message };
  if (!client) return { ok: false, code: 404, error: 'Existing client not found' };

  // Skip duplicate inserts: only attach the staged subs whose subscription_id isn't already linked.
  const { data: existingLinks, error: linkErr } = await supabaseAdmin
    .from('client_subscriptions')
    .select('subscription_id')
    .eq('client_id', clientId);
  if (linkErr) return { ok: false, code: 500, error: linkErr.message };
  const linkedIds = new Set((existingLinks ?? []).map((r: any) => r.subscription_id));
  const subsToAttach = stagedSubs.filter((s: any) => !linkedIds.has(s.subscription_id));

  try {
    await attachStagedSubsToClient(clientId, subsToAttach);
  } catch (e: any) {
    return { ok: false, code: 500, error: e?.message || 'Failed to attach subscriptions' };
  }

  // Back-fill submission_id on the client only if it's currently null — don't overwrite history.
  if (!client.submission_id) {
    await supabaseAdmin
      .from('clients')
      .update({ submission_id: submissionId })
      .eq('id', clientId)
      .is('submission_id', null);
  }

  if (submission.status !== 'converted') {
    const { error: updErr } = await supabaseAdmin
      .from('client_submissions')
      .update({ status: 'converted' })
      .eq('id', submissionId);
    if (updErr) return { ok: false, code: 500, error: updErr.message };
  }

  return { ok: true, status: 'converted', clientId };
}

export async function transitionSubmissionStatus(
  submissionId: string,
  newStatus: PipelineStatus,
): Promise<TransitionResult> {
  if (!isPipelineStatus(newStatus)) {
    return { ok: false, code: 400, error: `Invalid status: ${newStatus}` };
  }

  const { data: submission, error: subErr } = await supabaseAdmin
    .from('client_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle();

  if (subErr) return { ok: false, code: 500, error: subErr.message };
  if (!submission) return { ok: false, code: 404, error: 'Submission not found' };

  const currentStatus = submission.status as PipelineStatus;

  if (currentStatus === newStatus) {
    const { data: client } = await supabaseAdmin
      .from('clients').select('id').eq('submission_id', submissionId).maybeSingle();
    return { ok: true, status: currentStatus, clientId: client?.id ?? null };
  }

  if (currentStatus === 'converted' && newStatus !== 'onboarding' && newStatus !== 'closed') {
    return {
      ok: false,
      code: 409,
      error: 'Cannot move a converted lead back to an earlier pipeline stage (client already created).',
    };
  }

  let clientId: string | null = null;

  if (newStatus === 'converted') {
    const { data: stagedSubs, error: stagedErr } = await supabaseAdmin
      .from('client_submission_subscriptions')
      .select('*')
      .eq('submission_id', submissionId);

    if (stagedErr) return { ok: false, code: 500, error: stagedErr.message };
    if (!stagedSubs || stagedSubs.length === 0) {
      return {
        ok: false,
        code: 400,
        error: 'At least one subscription must be selected before converting this lead.',
      };
    }

    try {
      const result = await materialiseClientFromSubmission(submission, stagedSubs);
      clientId = result.clientId;
    } catch (e: any) {
      return { ok: false, code: 500, error: e?.message || 'Failed to materialise client' };
    }
  } else {
    const { data: client } = await supabaseAdmin
      .from('clients').select('id').eq('submission_id', submissionId).maybeSingle();
    clientId = client?.id ?? null;
  }

  const { error: updErr } = await supabaseAdmin
    .from('client_submissions')
    .update({ status: newStatus })
    .eq('id', submissionId);

  if (updErr) return { ok: false, code: 500, error: updErr.message };

  return { ok: true, status: newStatus, clientId };
}
