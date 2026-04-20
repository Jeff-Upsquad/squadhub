import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

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

async function enrichClient(client: any) {
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

  const { data: cs } = await supabaseAdmin
    .from('client_subscriptions')
    .select('*')
    .eq('client_id', client.id)
    .order('created_at');

  if (!cs || cs.length === 0) {
    return { ...client, country, subscriptions: [] };
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

router.get('/submissions', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('client_submissions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('List submissions error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/submissions/count', async (_req: Request, res: Response) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('client_submissions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

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

// POST /admin/clients/submissions/:id/approve
const approveSchema = z.object({
  plan_ids: z.array(z.string().uuid()).min(1),
});

router.post('/submissions/:id/approve', async (req: Request, res: Response) => {
  try {
    const body = approveSchema.parse(req.body);

    const { data: submission, error: subErr } = await supabaseAdmin
      .from('client_submissions')
      .select('*')
      .eq('id', req.params.id)
      .eq('status', 'pending')
      .single();

    if (subErr || !submission) {
      res.status(404).json({ success: false, error: 'Submission not found or already processed' });
      return;
    }

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

    await supabaseAdmin
      .from('client_submissions')
      .update({ status: 'approved' })
      .eq('id', req.params.id);

    res.json({ success: true, data: client });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Approve submission error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/submissions/:id/reject', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('client_submissions')
      .update({ status: 'rejected' })
      .eq('id', req.params.id)
      .eq('status', 'pending');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Submission rejected' });
  } catch (err) {
    console.error('Reject submission error:', err);
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

    const enriched = await Promise.all((data || []).map(enrichClient));
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

    const enriched = await enrichClient(data);
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

router.delete('/:clientId/subscriptions/:csId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('client_subscriptions')
      .delete()
      .eq('id', req.params.csId)
      .eq('client_id', req.params.clientId);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Subscription removed' });
  } catch (err) {
    console.error('Remove client subscription error:', err);
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
});

router.put('/:clientId/subscriptions/:csId/deliverables/:id', async (req: Request, res: Response) => {
  try {
    const body = updateDeliverableSchema.parse(req.body);
    // Editing the row untethers it from the plan — it's now a customization.
    const { data, error } = await supabaseAdmin
      .from('client_subscription_deliverables')
      .update({ ...body, source_plan_deliverable_id: null })
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
