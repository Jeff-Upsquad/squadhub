import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

const addSchema = z.object({ squadhire_category_id: z.string().uuid() });

// GET /admin/subscriptions/:subscriptionId/squadhire-profiles
router.get('/:subscriptionId/squadhire-profiles', async (req: Request, res: Response) => {
  try {
    const { data: sub, error: subErr } = await supabaseAdmin
      .from('subscriptions')
      .select('id')
      .eq('id', req.params.subscriptionId)
      .maybeSingle();
    if (subErr) {
      res.status(500).json({ success: false, error: subErr.message });
      return;
    }
    if (!sub) {
      res.status(404).json({ success: false, error: 'Subscription not found' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('subscription_squadhire_profiles')
      .select('id, subscription_id, squadhire_category_id, created_at')
      .eq('subscription_id', req.params.subscriptionId)
      .order('created_at', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('List subscription squadhire profiles error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/subscriptions/:subscriptionId/squadhire-profiles
router.post('/:subscriptionId/squadhire-profiles', async (req: Request, res: Response) => {
  try {
    const body = addSchema.parse(req.body);

    const { data: sub, error: subErr } = await supabaseAdmin
      .from('subscriptions')
      .select('id')
      .eq('id', req.params.subscriptionId)
      .maybeSingle();
    if (subErr) {
      res.status(500).json({ success: false, error: subErr.message });
      return;
    }
    if (!sub) {
      res.status(404).json({ success: false, error: 'Subscription not found' });
      return;
    }

    const { error: insErr } = await supabaseAdmin
      .from('subscription_squadhire_profiles')
      .upsert(
        {
          subscription_id: req.params.subscriptionId,
          squadhire_category_id: body.squadhire_category_id,
        },
        { onConflict: 'subscription_id,squadhire_category_id', ignoreDuplicates: true }
      );
    if (insErr) {
      res.status(500).json({ success: false, error: insErr.message });
      return;
    }

    const { data: row } = await supabaseAdmin
      .from('subscription_squadhire_profiles')
      .select('id, subscription_id, squadhire_category_id, created_at')
      .eq('subscription_id', req.params.subscriptionId)
      .eq('squadhire_category_id', body.squadhire_category_id)
      .single();

    res.status(201).json({ success: true, data: row });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add subscription squadhire profile error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/subscriptions/:subscriptionId/squadhire-profiles/:mappingId
router.delete(
  '/:subscriptionId/squadhire-profiles/:mappingId',
  async (req: Request, res: Response) => {
    try {
      const { error } = await supabaseAdmin
        .from('subscription_squadhire_profiles')
        .delete()
        .eq('id', req.params.mappingId)
        .eq('subscription_id', req.params.subscriptionId);

      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      console.error('Remove subscription squadhire profile error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

export default router;
