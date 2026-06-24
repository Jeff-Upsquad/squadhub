import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { PARTNER_USER_TYPES, type UserType } from '@squadhub/shared';
import { matchCardsForPartner } from '../utils/subscriptionCards';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

// GET /admin/partners — list all partner users with their client assignments
router.get('/', async (req: Request, res: Response) => {
  try {
    const search = (req.query.search as string) || '';
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('users')
      .select('*', { count: 'exact' })
      .in('user_type', PARTNER_USER_TYPES as unknown as string[])
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(`display_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { data: partners, error, count } = await query;

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Fetch assignments for all returned partners
    const partnerIds = (partners || []).map((p: any) => p.id);
    const { data: assignments } = partnerIds.length > 0
      ? await supabaseAdmin
          .from('partner_client_assignments')
          .select('*, clients(id, business_name, status)')
          .in('user_id', partnerIds)
      : { data: [] };

    // Group assignments by user_id
    const assignmentMap: Record<string, any[]> = {};
    (assignments || []).forEach((a: any) => {
      if (!assignmentMap[a.user_id]) assignmentMap[a.user_id] = [];
      assignmentMap[a.user_id].push({ ...a, client: a.clients, clients: undefined });
    });

    const enriched = (partners || []).map((p: any) => ({
      ...p,
      assignments: assignmentMap[p.id] || [],
    }));

    res.json({ success: true, data: enriched, total: count || 0, page, limit });
  } catch (err) {
    console.error('List partners error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/partners/:userId/assignments — get assignments for a specific partner
router.get('/:userId/assignments', async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;

    const { data, error } = await supabaseAdmin
      .from('partner_client_assignments')
      .select('*, clients(id, business_name, contact_person, status)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const enriched = (data || []).map((a: any) => ({
      ...a,
      client: a.clients,
      clients: undefined,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Get partner assignments error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/partners/:userId/assignments — assign a partner to a client
const createAssignmentSchema = z.object({
  client_id: z.string().uuid(),
  role: z.string().max(100).optional(),
});

router.post('/:userId/assignments', async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;
    const body = createAssignmentSchema.parse(req.body);

    // Verify user is a partner
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('user_type')
      .eq('id', userId)
      .single();

    if (!user || !PARTNER_USER_TYPES.includes(user.user_type as UserType)) {
      res.status(400).json({ success: false, error: 'User is not a partner' });
      return;
    }

    // Verify client exists
    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('id', body.client_id)
      .single();

    if (!client) {
      res.status(404).json({ success: false, error: 'Client not found' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('partner_client_assignments')
      .insert({
        user_id: userId,
        client_id: body.client_id,
        role: body.role || null,
      })
      .select('*, clients(id, business_name, status)')
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'Partner is already assigned to this client' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.status(201).json({
      success: true,
      data: { ...data, client: data.clients, clients: undefined },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create partner assignment error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/partners/:userId/assignments/:assignmentId — update assignment role
const updateAssignmentSchema = z.object({
  role: z.string().max(100).nullable(),
});

router.put('/:userId/assignments/:assignmentId', async (req: Request, res: Response) => {
  try {
    const { assignmentId } = req.params;
    const body = updateAssignmentSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('partner_client_assignments')
      .update({ role: body.role, updated_at: new Date().toISOString() })
      .eq('id', assignmentId)
      .select('*, clients(id, business_name, status)')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({
      success: true,
      data: { ...data, client: data.clients, clients: undefined },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update partner assignment error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/partners/:userId/assignments/:assignmentId — remove assignment
router.delete('/:userId/assignments/:assignmentId', async (req: Request, res: Response) => {
  try {
    const { assignmentId } = req.params;

    const { error } = await supabaseAdmin
      .from('partner_client_assignments')
      .delete()
      .eq('id', assignmentId);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Assignment removed' });
  } catch (err) {
    console.error('Delete partner assignment error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/partners/by-client/:clientId — list partners assigned to a specific client
router.get('/by-client/:clientId', async (req: Request, res: Response) => {
  try {
    const clientId = req.params.clientId;

    const { data, error } = await supabaseAdmin
      .from('partner_client_assignments')
      .select('*, users(id, email, display_name, avatar_url)')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const enriched = (data || []).map((a: any) => ({
      ...a,
      user: a.users,
      users: undefined,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Get client partners error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /admin/partners/:userId/targeting — set partner's subscription-card
// targeting profile (tier / experience / location / languages).
const targetingSchema = z.object({
  tier: z.enum(['Junior', 'Pro', 'Top Talents', 'Custom']).nullable(),
  min_experience_years: z.number().int().min(0).nullable(),
  country_id: z.string().uuid().nullable(),
  state_region: z.string().max(100).nullable(),
  languages: z.array(z.string().min(1).max(20)),
});

router.patch('/:userId/targeting', async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string;
    const body = targetingSchema.parse(req.body);

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, user_type')
      .eq('id', userId)
      .maybeSingle();
    if (!user || !PARTNER_USER_TYPES.includes(user.user_type as UserType)) {
      res.status(404).json({ success: false, error: 'Partner not found' });
      return;
    }

    const { data: updated, error } = await supabaseAdmin
      .from('users')
      .update({
        tier: body.tier,
        min_experience_years: body.min_experience_years,
        country_id: body.country_id,
        state_region: body.state_region,
        languages: body.languages,
      })
      .eq('id', userId)
      .select('id, tier, min_experience_years, country_id, state_region, languages')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    matchCardsForPartner(userId).catch((err) =>
      console.error('[partner-targeting] retroactive card match error:', err),
    );

    res.json({ success: true, data: updated });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update partner targeting error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
