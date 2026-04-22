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

  const inserts = stagedSubs.map((s: any) => ({
    client_id: client.id,
    subscription_id: s.subscription_id,
    plan_id: s.plan_id,
  }));

  if (inserts.length > 0) {
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

  return { clientId: client.id as string, created: true };
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
