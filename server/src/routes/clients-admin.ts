import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import {
  PIPELINE_STATUSES,
  transitionSubmissionStatus,
} from '../utils/submissionPipeline';
import { hydrateStagedSubscriptions } from '../utils/stagedSubscriptions';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

const countryIdSchema = z.string().uuid();

// ============================================================
// Helpers
// ============================================================

// Copy a plan's default deliverables into a new client_subscription
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

// Assign a set of plans to a client: inserts client_subscriptions rows
// and copies plan defaults into client_subscription_deliverables.
async function assignPlansToClient(clientId: string, planIds: string[]) {
  if (planIds.length === 0) return { error: null };

  // Look up subscription_id for each plan
  const { data: plans, error: planErr } = await supabaseAdmin
    .from('subscription_plans')
    .select('id, subscription_id')
    .in('id', planIds);

  if (planErr) return { error: planErr.message };
  if (!plans || plans.length !== planIds.length) {
    return { error: 'One or more plans not found' };
  }

  const inserts = plans.map((p: any) => ({
    client_id: clientId,
    subscription_id: p.subscription_id,
    plan_id: p.id,
  }));

  const { data: cs, error: csErr } = await supabaseAdmin
    .from('client_subscriptions')
    .insert(inserts)
    .select();

  if (csErr) return { error: csErr.message };

  // Copy default deliverables for each new client subscription
  await Promise.all(
    (cs || []).map((row: any) => copyPlanDeliverables(row.id, row.plan_id)),
  );

  return { error: null };
}

async function enrichClient(client: any, opts: { includeArchived?: boolean } = {}) {
  // Hydrate the country
  let country: any = null;
  if (client.country_id) {
    const { data: c } = await supabaseAdmin
      .from('countries')
      .select('*')
      .eq('id', client.country_id)
      .single();
    country = c;
  }

  // Hydrate sales persons
  const spIds = [client.primary_sales_person_id, client.secondary_sales_person_id].filter(Boolean);
  let primary_sales_person: any = null;
  let secondary_sales_person: any = null;
  if (spIds.length > 0) {
    const { data: sps } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, avatar_url')
      .in('id', spIds);
    const map: Record<string, any> = {};
    (sps || []).forEach((u: any) => { map[u.id] = u; });
    primary_sales_person = client.primary_sales_person_id ? map[client.primary_sales_person_id] || null : null;
    secondary_sales_person = client.secondary_sales_person_id ? map[client.secondary_sales_person_id] || null : null;
  }

  let csQuery = supabaseAdmin
    .from('client_subscriptions')
    .select('*')
    .eq('client_id', client.id);
  if (!opts.includeArchived) csQuery = csQuery.is('archived_at', null);
  const { data: cs } = await csQuery.order('created_at');

  if (!cs || cs.length === 0) {
    return { ...client, country, primary_sales_person, secondary_sales_person, subscriptions: [] };
  }

  const subIds = Array.from(new Set(cs.map((c: any) => c.subscription_id)));
  const planIds = Array.from(new Set(cs.map((c: any) => c.plan_id)));
  const csIds = cs.map((c: any) => c.id);

  const [{ data: subs }, { data: plans }, { data: pricing }, { data: delivs }] = await Promise.all([
    supabaseAdmin.from('subscriptions').select('*').in('id', subIds),
    supabaseAdmin.from('subscription_plans').select('*').in('id', planIds),
    supabaseAdmin.from('subscription_plan_pricing').select('*').in('plan_id', planIds),
    supabaseAdmin.from('client_subscription_deliverables').select('*').in('client_subscription_id', csIds).order('sort_order'),
  ]);

  const subsMap: Record<string, any> = {};
  (subs || []).forEach((s: any) => { subsMap[s.id] = s; });
  const plansMap: Record<string, any> = {};
  (plans || []).forEach((p: any) => { plansMap[p.id] = p; });
  const pricingByPlan: Record<string, any[]> = {};
  (pricing || []).forEach((p: any) => {
    (pricingByPlan[p.plan_id] = pricingByPlan[p.plan_id] || []).push(p);
  });
  const delivsByCs: Record<string, any[]> = {};
  (delivs || []).forEach((d: any) => {
    (delivsByCs[d.client_subscription_id] = delivsByCs[d.client_subscription_id] || []).push(d);
  });

  return {
    ...client,
    country,
    primary_sales_person,
    secondary_sales_person,
    subscriptions: cs.map((c: any) => ({
      ...c,
      subscription: subsMap[c.subscription_id] || null,
      plan: plansMap[c.plan_id]
        ? { ...plansMap[c.plan_id], pricing: pricingByPlan[c.plan_id] || [] }
        : null,
      deliverables: delivsByCs[c.id] || [],
    })),
  };
}

// ============================================================
// Client Submissions (New Clients)
// ============================================================

async function hydrateSalesPeopleOn<T extends { primary_sales_person_id?: string | null; secondary_sales_person_id?: string | null }>(rows: T[]): Promise<Array<T & { primary_sales_person?: any; secondary_sales_person?: any }>> {
  const ids = new Set<string>();
  rows.forEach((r) => {
    if (r.primary_sales_person_id) ids.add(r.primary_sales_person_id);
    if (r.secondary_sales_person_id) ids.add(r.secondary_sales_person_id);
  });
  if (ids.size === 0) return rows;
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, display_name, email, avatar_url')
    .in('id', Array.from(ids));
  const map: Record<string, any> = {};
  (data || []).forEach((u: any) => { map[u.id] = u; });
  return rows.map((r) => ({
    ...r,
    primary_sales_person: r.primary_sales_person_id ? map[r.primary_sales_person_id] || null : null,
    secondary_sales_person: r.secondary_sales_person_id ? map[r.secondary_sales_person_id] || null : null,
  }));
}

router.get('/submissions', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('client_submissions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    const enriched = await hydrateSalesPeopleOn(data || []);

    const stagedMap = await hydrateStagedSubscriptions(enriched.map((s: any) => s.id));
    const withStaged = enriched.map((s: any) => ({
      ...s,
      selected_subscriptions: stagedMap[s.id] || [],
    }));

    res.json({ success: true, data: withStaged });
  } catch (err) {
    console.error('List submissions error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /admin/clients/submissions/:id/sales-people — admin can add/change SPs
const updateSubmissionSpSchema = z.object({
  primary_sales_person_id: z.string().uuid().nullable().optional(),
  secondary_sales_person_id: z.string().uuid().nullable().optional(),
});

router.patch('/submissions/:id/sales-people', async (req: Request, res: Response) => {
  try {
    const body = updateSubmissionSpSchema.parse(req.body);
    const patch: Record<string, any> = {};
    if (body.primary_sales_person_id !== undefined) patch.primary_sales_person_id = body.primary_sales_person_id;
    if (body.secondary_sales_person_id !== undefined) patch.secondary_sales_person_id = body.secondary_sales_person_id;

    if (Object.keys(patch).length === 0) {
      res.json({ success: true, data: null });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('client_submissions')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const [enriched] = await hydrateSalesPeopleOn([data]);
    res.json({ success: true, data: enriched });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update submission SPs error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /admin/clients/:id/sales-people — admin can add/change SPs on approved clients
router.patch('/:id/sales-people', async (req: Request, res: Response) => {
  try {
    const body = updateSubmissionSpSchema.parse(req.body);
    const patch: Record<string, any> = {};
    if (body.primary_sales_person_id !== undefined) patch.primary_sales_person_id = body.primary_sales_person_id;
    if (body.secondary_sales_person_id !== undefined) patch.secondary_sales_person_id = body.secondary_sales_person_id;

    if (Object.keys(patch).length === 0) {
      res.json({ success: true, data: null });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('clients')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const [enriched] = await hydrateSalesPeopleOn([data]);
    res.json({ success: true, data: enriched });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update client SPs error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Count of leads in active pipeline (not converted/onboarding/closed) — drives the sidebar badge.
router.get('/submissions/count', async (_req: Request, res: Response) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('client_submissions')
      .select('*', { count: 'exact', head: true })
      .in('status', ['new', 'in_progress', 'selection']);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: { count: count || 0 } });
  } catch (err) {
    console.error('Count submissions error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /admin/clients/submissions/:id/status — admin updates pipeline status.
// Transitioning to 'converted' materialises the Client + client_subscriptions.
const submissionStatusSchema = z.object({
  status: z.enum(PIPELINE_STATUSES),
});

router.patch('/submissions/:id/status', async (req: Request, res: Response) => {
  try {
    const body = submissionStatusSchema.parse(req.body);
    const result = await transitionSubmissionStatus(req.params.id as string, body.status);
    if (!result.ok) {
      res.status(result.code).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, data: { status: result.status, client_id: result.clientId } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update submission status error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /admin/clients/submissions/:id/country — admin updates billing country on a lead.
const submissionCountrySchema = z.object({ country_id: z.string().uuid() });

router.patch('/submissions/:id/country', async (req: Request, res: Response) => {
  try {
    const body = submissionCountrySchema.parse(req.body);

    const { data: submission } = await supabaseAdmin
      .from('client_submissions')
      .select('status')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!submission) {
      res.status(404).json({ success: false, error: 'Submission not found' });
      return;
    }
    if (submission.status === 'converted' || submission.status === 'closed') {
      res.status(409).json({ success: false, error: 'Cannot change billing country on a converted or closed lead' });
      return;
    }

    const { data: country } = await supabaseAdmin
      .from('countries')
      .select('id, is_active')
      .eq('id', body.country_id)
      .maybeSingle();
    if (!country || !country.is_active) {
      res.status(400).json({ success: false, error: 'Country not found or inactive' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('client_submissions')
      .update({ country_id: body.country_id })
      .eq('id', req.params.id as string);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: { country_id: body.country_id } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Admin update lead country error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Staged subscription management — mirrors the sales endpoints but without the
// primary/secondary-SP guard (admin can edit any lead).
const addStagedSubSchema = z.object({
  subscription_id: z.string().uuid(),
  plan_id: z.string().uuid(),
});

router.get('/submissions/:id/subscriptions', async (req: Request, res: Response) => {
  try {
    const leadId = req.params.id as string;
    const map = await hydrateStagedSubscriptions([leadId]);
    res.json({ success: true, data: map[leadId] || [] });
  } catch (err) {
    console.error('Admin list staged subs error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/submissions/:id/subscriptions', async (req: Request, res: Response) => {
  try {
    const body = addStagedSubSchema.parse(req.body);

    const { data: submission } = await supabaseAdmin
      .from('client_submissions')
      .select('status')
      .eq('id', req.params.id)
      .maybeSingle();

    if (!submission) {
      res.status(404).json({ success: false, error: 'Submission not found' });
      return;
    }
    if (submission.status === 'converted' || submission.status === 'closed') {
      res.status(409).json({ success: false, error: 'Cannot edit subscriptions on a converted or closed lead' });
      return;
    }

    const { data: plan } = await supabaseAdmin
      .from('subscription_plans')
      .select('id, subscription_id, is_active')
      .eq('id', body.plan_id)
      .maybeSingle();
    if (!plan || plan.subscription_id !== body.subscription_id) {
      res.status(400).json({ success: false, error: 'Plan does not belong to the given subscription' });
      return;
    }
    if (!plan.is_active) {
      res.status(400).json({ success: false, error: 'Plan is inactive' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('client_submission_subscriptions')
      .insert({
        submission_id: req.params.id,
        subscription_id: body.subscription_id,
        plan_id: body.plan_id,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Admin add staged sub error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/submissions/:id/subscriptions/:rowId', async (req: Request, res: Response) => {
  try {
    const { data: submission } = await supabaseAdmin
      .from('client_submissions')
      .select('status')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!submission) {
      res.status(404).json({ success: false, error: 'Submission not found' });
      return;
    }
    if (submission.status === 'converted' || submission.status === 'closed') {
      res.status(409).json({ success: false, error: 'Cannot edit subscriptions on a converted or closed lead' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('client_submission_subscriptions')
      .delete()
      .eq('id', req.params.rowId)
      .eq('submission_id', req.params.id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Admin delete staged sub error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Clients Management
// ============================================================

// POST /admin/clients — manually create a client
const createClientSchema = z.object({
  business_name: z.string().min(1).max(200),
  contact_person: z.string().min(1).max(200),
  designation: z.string().max(200).optional().or(z.literal('')),
  contact_number: z.string().min(1).max(20),
  email: z.string().email(),
  business_address: z.string().min(1).max(1000),
  gst_registered: z.boolean(),
  gst_number: z.string().max(50).optional().or(z.literal('')),
  accounts_email: z.string().email().optional().or(z.literal('')),
  country_id: countryIdSchema,
  plan_ids: z.array(z.string().uuid()).min(1),
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createClientSchema.parse(req.body);

    const { data: client, error: clientErr } = await supabaseAdmin
      .from('clients')
      .insert({
        submission_id: null,
        business_name: body.business_name,
        contact_person: body.contact_person,
        designation: body.designation || null,
        contact_number: body.contact_number,
        email: body.email,
        business_address: body.business_address,
        gst_registered: body.gst_registered,
        gst_number: body.gst_number || null,
        accounts_email: body.accounts_email || null,
        country_id: body.country_id,
      })
      .select()
      .single();

    if (clientErr || !client) {
      res.status(500).json({ success: false, error: clientErr?.message || 'Failed to create client' });
      return;
    }

    const { error: assignErr } = await assignPlansToClient(client.id, body.plan_ids);
    if (assignErr) {
      res.status(500).json({ success: false, error: assignErr });
      return;
    }

    const enriched = await enrichClient(client);
    res.json({ success: true, data: enriched });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create client error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const enriched = await Promise.all((data || []).map((c: any) => enrichClient(c)));
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('List clients error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/count', async (_req: Request, res: Response) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('clients')
      .select('*', { count: 'exact', head: true });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: { count: count || 0 } });
  } catch (err) {
    console.error('Count clients error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) {
      res.status(404).json({ success: false, error: 'Client not found' });
      return;
    }

    const includeArchived = req.query.include_archived === '1';
    const enriched = await enrichClient(data, { includeArchived });
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Get client error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const updateClientSchema = z.object({
  business_name: z.string().min(1).max(200).optional(),
  contact_person: z.string().min(1).max(200).optional(),
  designation: z.string().max(200).optional(),
  contact_number: z.string().min(1).max(20).optional(),
  email: z.string().email().optional(),
  business_address: z.string().min(1).max(1000).optional(),
  gst_registered: z.boolean().optional(),
  gst_number: z.string().max(50).optional(),
  accounts_email: z.string().email().optional().or(z.literal('')),
  country_id: countryIdSchema.optional(),
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const body = updateClientSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('clients')
      .update(body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update client error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/clients/:id/status — change client status
const statusSchema = z.object({
  status: z.enum(['active', 'paused', 'cancelled']),
});

router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const body = statusSchema.parse(req.body);

    const { data: client, error } = await supabaseAdmin
      .from('clients')
      .update({ status: body.status })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    if (body.status === 'paused' || body.status === 'cancelled') {
      await supabaseAdmin
        .from('client_subscriptions')
        .update({ status: body.status })
        .eq('client_id', req.params.id)
        .eq('status', 'active');
    }

    if (body.status === 'active') {
      await supabaseAdmin
        .from('client_subscriptions')
        .update({ status: 'active' })
        .eq('client_id', req.params.id)
        .eq('status', 'paused');
    }

    const enriched = await enrichClient(client);
    res.json({ success: true, data: enriched });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update client status error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Client Subscription Management (add/remove plans + status)
// ============================================================

const addPlansSchema = z.object({
  plan_ids: z.array(z.string().uuid()).min(1),
});

router.post('/:id/subscriptions', async (req: Request, res: Response) => {
  try {
    const body = addPlansSchema.parse(req.body);
    const { error } = await assignPlansToClient(req.params.id as string, body.plan_ids);
    if (error) {
      res.status(500).json({ success: false, error });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add client subscriptions error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.put('/:clientId/subscriptions/:csId/status', async (req: Request, res: Response) => {
  try {
    const body = statusSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('client_subscriptions')
      .update({ status: body.status })
      .eq('id', req.params.csId)
      .eq('client_id', req.params.clientId)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update client subscription status error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Archive a client subscription (soft-delete via archived_at).
// Kept on DELETE to avoid breaking existing callers; behavior is now archive, not hard-delete.
router.delete('/:clientId/subscriptions/:csId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('client_subscriptions')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', req.params.csId)
      .eq('client_id', req.params.clientId)
      .is('archived_at', null);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Subscription archived' });
  } catch (err) {
    console.error('Archive client subscription error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/:clientId/subscriptions/:csId/unarchive', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('client_subscriptions')
      .update({ archived_at: null })
      .eq('id', req.params.csId)
      .eq('client_id', req.params.clientId);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Subscription unarchived' });
  } catch (err) {
    console.error('Unarchive client subscription error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Per-client deliverable overrides
// ============================================================

router.get('/:clientId/subscriptions/:csId/deliverables', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('client_subscription_deliverables')
      .select('*')
      .eq('client_subscription_id', req.params.csId)
      .order('sort_order');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('List client deliverables error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const createDeliverableSchema = z.object({
  kind: z.enum(['hours', 'item']),
  deliverable_type_id: z.string().uuid().nullable().optional(),
  per_day: z.number().min(0).default(0),
  per_week: z.number().min(0).default(0),
  per_month: z.number().min(0).default(0),
}).refine(
  (v) => (v.kind === 'hours' ? !v.deliverable_type_id : !!v.deliverable_type_id),
  { message: 'kind=hours requires no deliverable_type_id; kind=item requires one' },
);

router.post('/:clientId/subscriptions/:csId/deliverables', async (req: Request, res: Response) => {
  try {
    const body = createDeliverableSchema.parse(req.body);

    const { data: existing } = await supabaseAdmin
      .from('client_subscription_deliverables')
      .select('sort_order')
      .eq('client_subscription_id', req.params.csId)
      .order('sort_order', { ascending: false })
      .limit(1);
    const nextSort = ((existing?.[0]?.sort_order as number) ?? 0) + 1;

    const { data, error } = await supabaseAdmin
      .from('client_subscription_deliverables')
      .insert({
        client_subscription_id: req.params.csId,
        kind: body.kind,
        deliverable_type_id: body.kind === 'item' ? body.deliverable_type_id! : null,
        per_day: body.per_day,
        per_week: body.per_week,
        per_month: body.per_month,
        sort_order: nextSort,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create client deliverable error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const updateDeliverableSchema = z.object({
  deliverable_type_id: z.string().uuid().nullable().optional(),
  per_day: z.number().min(0).optional(),
  per_week: z.number().min(0).optional(),
  per_month: z.number().min(0).optional(),
  is_active: z.boolean().optional(),
});

router.put('/:clientId/subscriptions/:csId/deliverables/:id', async (req: Request, res: Response) => {
  try {
    const body = updateDeliverableSchema.parse(req.body);

    // Linked rows (source_plan_deliverable_id set) follow the plan — only is_active is editable here.
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('client_subscription_deliverables')
      .select('source_plan_deliverable_id')
      .eq('id', req.params.id)
      .eq('client_subscription_id', req.params.csId)
      .single();

    if (fetchErr || !existing) {
      res.status(404).json({ success: false, error: 'Deliverable not found' });
      return;
    }

    const patch: Record<string, any> = {};
    if (body.is_active !== undefined) patch.is_active = body.is_active;

    if (existing.source_plan_deliverable_id == null) {
      // Custom row: values are editable too
      if (body.deliverable_type_id !== undefined) patch.deliverable_type_id = body.deliverable_type_id;
      if (body.per_day !== undefined) patch.per_day = body.per_day;
      if (body.per_week !== undefined) patch.per_week = body.per_week;
      if (body.per_month !== undefined) patch.per_month = body.per_month;
    }

    if (Object.keys(patch).length === 0) {
      res.json({ success: true, data: null });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('client_subscription_deliverables')
      .update(patch)
      .eq('id', req.params.id)
      .eq('client_subscription_id', req.params.csId)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update client deliverable error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/:clientId/subscriptions/:csId/deliverables/:id', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('client_subscription_deliverables')
      .delete()
      .eq('id', req.params.id)
      .eq('client_subscription_id', req.params.csId);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Deliverable removed' });
  } catch (err) {
    console.error('Delete client deliverable error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/clients/:clientId/subscriptions/:csId/deliverables/reset
// Wipes overrides and re-copies the plan's current defaults.
router.post('/:clientId/subscriptions/:csId/deliverables/reset', async (req: Request, res: Response) => {
  try {
    const { data: cs, error: csErr } = await supabaseAdmin
      .from('client_subscriptions')
      .select('id, plan_id')
      .eq('id', req.params.csId)
      .eq('client_id', req.params.clientId)
      .single();

    if (csErr || !cs) {
      res.status(404).json({ success: false, error: 'Client subscription not found' });
      return;
    }

    await supabaseAdmin
      .from('client_subscription_deliverables')
      .delete()
      .eq('client_subscription_id', cs.id);

    await copyPlanDeliverables(cs.id, cs.plan_id);

    const { data } = await supabaseAdmin
      .from('client_subscription_deliverables')
      .select('*')
      .eq('client_subscription_id', cs.id)
      .order('sort_order');

    res.json({ success: true, data });
  } catch (err) {
    console.error('Reset deliverables error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
