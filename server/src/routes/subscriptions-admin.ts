import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

// ============================================================
// Helpers
// ============================================================

async function hydrateSubscription(subscriptionId: string) {
  const [{ data: sub }, { data: plans }, { data: types }] = await Promise.all([
    supabaseAdmin.from('subscriptions').select('*').eq('id', subscriptionId).single(),
    supabaseAdmin.from('subscription_plans').select('*').eq('subscription_id', subscriptionId).order('sort_order'),
    supabaseAdmin.from('subscription_deliverable_types').select('*').eq('subscription_id', subscriptionId).order('sort_order'),
  ]);

  if (!sub) return null;

  const planIds = (plans || []).map((p: any) => p.id);
  let delivsByPlan: Record<string, any[]> = {};
  if (planIds.length > 0) {
    const { data: delivs } = await supabaseAdmin
      .from('subscription_plan_deliverables')
      .select('*')
      .in('plan_id', planIds)
      .order('sort_order');
    (delivs || []).forEach((d: any) => {
      (delivsByPlan[d.plan_id] = delivsByPlan[d.plan_id] || []).push(d);
    });
  }

  const typeById: Record<string, any> = {};
  (types || []).forEach((t: any) => { typeById[t.id] = t; });

  return {
    ...sub,
    plans: (plans || []).map((p: any) => ({
      ...p,
      deliverables: (delivsByPlan[p.id] || []).map((d: any) => ({
        ...d,
        deliverable_type: d.deliverable_type_id ? typeById[d.deliverable_type_id] || null : null,
      })),
    })),
    deliverable_types: types || [],
  };
}

// ============================================================
// Subscriptions catalog (hardcoded 2 rows — no create/delete)
// ============================================================

// GET /admin/subscriptions — list both subscriptions fully hydrated
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data: subs, error } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .order('sort_order');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const hydrated = await Promise.all((subs || []).map((s: any) => hydrateSubscription(s.id)));
    res.json({ success: true, data: hydrated.filter(Boolean) });
  } catch (err) {
    console.error('List subscriptions error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/subscriptions/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const data = await hydrateSubscription(req.params.id as string);
    if (!data) {
      res.status(404).json({ success: false, error: 'Subscription not found' });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('Get subscription error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/subscriptions/:id — toggle active, update name/description
const updateSubscriptionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  is_active: z.boolean().optional(),
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const body = updateSubscriptionSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
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
    console.error('Update subscription error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Plans: toggle + prices
// ============================================================

const updatePlanSchema = z.object({
  is_active: z.boolean().optional(),
  price_inr: z.number().int().min(0).nullable().optional(),
  price_usd: z.number().int().min(0).nullable().optional(),
});

router.put('/:id/plans/:planId', async (req: Request, res: Response) => {
  try {
    const body = updatePlanSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('subscription_plans')
      .update(body)
      .eq('id', req.params.planId)
      .eq('subscription_id', req.params.id)
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
    console.error('Update plan error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Deliverable types (per subscription)
// ============================================================

const createDeliverableTypeSchema = z.object({
  name: z.string().min(1).max(200),
});

router.post('/:id/deliverable-types', async (req: Request, res: Response) => {
  try {
    const body = createDeliverableTypeSchema.parse(req.body);

    // Determine next sort_order
    const { data: existing } = await supabaseAdmin
      .from('subscription_deliverable_types')
      .select('sort_order')
      .eq('subscription_id', req.params.id)
      .order('sort_order', { ascending: false })
      .limit(1);
    const nextSort = ((existing?.[0]?.sort_order as number) ?? 0) + 1;

    const { data, error } = await supabaseAdmin
      .from('subscription_deliverable_types')
      .insert({
        subscription_id: req.params.id,
        name: body.name,
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
    console.error('Create deliverable type error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const updateDeliverableTypeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  is_active: z.boolean().optional(),
});

router.put('/deliverable-types/:typeId', async (req: Request, res: Response) => {
  try {
    const body = updateDeliverableTypeSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('subscription_deliverable_types')
      .update(body)
      .eq('id', req.params.typeId)
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
    console.error('Update deliverable type error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Plan deliverables (defaults per plan)
// ============================================================

// GET /admin/subscriptions/:id/plans/:planId/deliverables
router.get('/:id/plans/:planId/deliverables', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('subscription_plan_deliverables')
      .select('*')
      .eq('plan_id', req.params.planId)
      .order('sort_order');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('List plan deliverables error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const createPlanDeliverableSchema = z.object({
  kind: z.enum(['hours', 'item']),
  deliverable_type_id: z.string().uuid().nullable().optional(),
  per_day: z.number().min(0).default(0),
  per_week: z.number().min(0).default(0),
  per_month: z.number().min(0).default(0),
}).refine(
  (v) => (v.kind === 'hours' ? !v.deliverable_type_id : !!v.deliverable_type_id),
  { message: 'kind=hours requires no deliverable_type_id; kind=item requires one' },
);

router.post('/:id/plans/:planId/deliverables', async (req: Request, res: Response) => {
  try {
    const body = createPlanDeliverableSchema.parse(req.body);

    const { data: existing } = await supabaseAdmin
      .from('subscription_plan_deliverables')
      .select('sort_order')
      .eq('plan_id', req.params.planId)
      .order('sort_order', { ascending: false })
      .limit(1);
    const nextSort = ((existing?.[0]?.sort_order as number) ?? 0) + 1;

    const { data, error } = await supabaseAdmin
      .from('subscription_plan_deliverables')
      .insert({
        plan_id: req.params.planId,
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
    console.error('Create plan deliverable error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const updatePlanDeliverableSchema = z.object({
  deliverable_type_id: z.string().uuid().nullable().optional(),
  per_day: z.number().min(0).optional(),
  per_week: z.number().min(0).optional(),
  per_month: z.number().min(0).optional(),
});

router.put('/plan-deliverables/:id', async (req: Request, res: Response) => {
  try {
    const body = updatePlanDeliverableSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('subscription_plan_deliverables')
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
    console.error('Update plan deliverable error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/plan-deliverables/:id', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('subscription_plan_deliverables')
      .delete()
      .eq('id', req.params.id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Deliverable removed' });
  } catch (err) {
    console.error('Delete plan deliverable error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
