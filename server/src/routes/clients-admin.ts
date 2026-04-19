import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

// ============================================================
// Subscriptions CRUD
// ============================================================

// GET /admin/clients/subscriptions
router.get('/subscriptions', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('is_deleted', false)
      .order('name');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('List subscriptions error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const subscriptionSchema = z.object({
  name: z.string().min(1).max(200),
  squad: z.enum(['Content Squad', 'Accounts & Finance Squad', 'Marketing Squad', 'Tech Squad', 'Legal Squad', 'Hiring & HR Squad']),
  level: z.enum(['Junior', 'Pro', 'Elite']),
  plan: z.enum(['Starter', 'Basic', 'Plus', 'Pro', 'Personal']),
  price: z.number().int().min(0),
});

// POST /admin/clients/subscriptions
router.post('/subscriptions', async (req: Request, res: Response) => {
  try {
    const body = subscriptionSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .insert(body)
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
    console.error('Create subscription error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/clients/subscriptions/:id
router.put('/subscriptions/:id', async (req: Request, res: Response) => {
  try {
    const body = subscriptionSchema.partial().parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .update({ ...body, updated_at: new Date().toISOString() })
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
    console.error('Update subscription error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/clients/subscriptions/:id (soft delete)
router.delete('/subscriptions/:id', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('subscriptions')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Subscription deleted' });
  } catch (err) {
    console.error('Delete subscription error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Client Submissions (New Clients)
// ============================================================

// GET /admin/clients/submissions
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

// GET /admin/clients/submissions/count
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

// POST /admin/clients/submissions/:id/approve — approve & move to clients
const approveSchema = z.object({
  subscription_ids: z.array(z.string().uuid()).min(1),
});

router.post('/submissions/:id/approve', async (req: Request, res: Response) => {
  try {
    const body = approveSchema.parse(req.body);

    // Get submission
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

    // Create client
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
      })
      .select()
      .single();

    if (clientErr || !client) {
      res.status(500).json({ success: false, error: clientErr?.message || 'Failed to create client' });
      return;
    }

    // Assign subscriptions
    const subInserts = body.subscription_ids.map((sid) => ({
      client_id: client.id,
      subscription_id: sid,
    }));

    const { error: assignErr } = await supabaseAdmin
      .from('client_subscriptions')
      .insert(subInserts);

    if (assignErr) {
      res.status(500).json({ success: false, error: assignErr.message });
      return;
    }

    // Mark submission as approved
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

// POST /admin/clients/submissions/:id/reject
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

// Helper: enrich client with subscriptions
async function enrichClient(client: any) {
  const { data: cs } = await supabaseAdmin
    .from('client_subscriptions')
    .select('*')
    .eq('client_id', client.id)
    .order('created_at');

  const subIds = (cs || []).map((c: any) => c.subscription_id);
  let subsMap: Record<string, any> = {};
  if (subIds.length > 0) {
    const { data: subs } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .in('id', subIds);
    (subs || []).forEach((s: any) => { subsMap[s.id] = s; });
  }

  return {
    ...client,
    subscriptions: (cs || []).map((c: any) => ({
      ...c,
      subscription: subsMap[c.subscription_id] || null,
    })),
  };
}

// POST /admin/clients — manually create a client (no submission)
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
  subscription_ids: z.array(z.string().uuid()).min(1),
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
        designation: body.designation ? body.designation : null,
        contact_number: body.contact_number,
        email: body.email,
        business_address: body.business_address,
        gst_registered: body.gst_registered,
        gst_number: body.gst_number ? body.gst_number : null,
        accounts_email: body.accounts_email ? body.accounts_email : null,
      })
      .select()
      .single();

    if (clientErr || !client) {
      res.status(500).json({ success: false, error: clientErr?.message || 'Failed to create client' });
      return;
    }

    const subInserts = body.subscription_ids.map((sid) => ({
      client_id: client.id,
      subscription_id: sid,
    }));

    const { error: assignErr } = await supabaseAdmin
      .from('client_subscriptions')
      .insert(subInserts);

    if (assignErr) {
      res.status(500).json({ success: false, error: assignErr.message });
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

// GET /admin/clients
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

// GET /admin/clients/count
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

// GET /admin/clients/:id
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

// PUT /admin/clients/:id — update client info
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
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const body = updateClientSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('clients')
      .update({ ...body, updated_at: new Date().toISOString() })
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

// PUT /admin/clients/:id/status — change client status (pause/cancel/resume/reactivate)
const statusSchema = z.object({
  status: z.enum(['active', 'paused', 'cancelled']),
});

router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const body = statusSchema.parse(req.body);

    // Update client status
    const { data: client, error } = await supabaseAdmin
      .from('clients')
      .update({ status: body.status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // If pausing or cancelling, update all active subscriptions too
    if (body.status === 'paused' || body.status === 'cancelled') {
      await supabaseAdmin
        .from('client_subscriptions')
        .update({ status: body.status, updated_at: new Date().toISOString() })
        .eq('client_id', req.params.id)
        .eq('status', 'active');
    }

    // If resuming (active from paused), reactivate paused subscriptions
    if (body.status === 'active') {
      await supabaseAdmin
        .from('client_subscriptions')
        .update({ status: 'active', updated_at: new Date().toISOString() })
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
// Client Subscription Management
// ============================================================

// POST /admin/clients/:id/subscriptions — add subscriptions
const addSubsSchema = z.object({
  subscription_ids: z.array(z.string().uuid()).min(1),
});

router.post('/:id/subscriptions', async (req: Request, res: Response) => {
  try {
    const body = addSubsSchema.parse(req.body);
    const inserts = body.subscription_ids.map((sid) => ({
      client_id: req.params.id,
      subscription_id: sid,
    }));

    const { data, error } = await supabaseAdmin
      .from('client_subscriptions')
      .insert(inserts)
      .select();

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
    console.error('Add client subscriptions error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/clients/:clientId/subscriptions/:csId/status — change individual subscription status
router.put('/:clientId/subscriptions/:csId/status', async (req: Request, res: Response) => {
  try {
    const body = statusSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('client_subscriptions')
      .update({ status: body.status, updated_at: new Date().toISOString() })
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

// DELETE /admin/clients/:clientId/subscriptions/:csId — remove subscription
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

export default router;
