import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

// GET /admin/client-access — list all clients with their current user access list
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data: clients, error } = await supabaseAdmin
      .from('clients')
      .select('id, business_name, contact_person, status, created_at')
      .order('business_name');
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!clients || clients.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const clientIds = clients.map((c) => c.id);
    const { data: access } = await supabaseAdmin
      .from('client_user_access')
      .select('id, client_id, user_id, access_level, created_at')
      .in('client_id', clientIds);

    const userIds = Array.from(new Set((access || []).map((a: any) => a.user_id)));
    const usersMap: Record<string, any> = {};
    if (userIds.length > 0) {
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id, display_name, email, avatar_url, user_type')
        .in('id', userIds);
      (users || []).forEach((u: any) => { usersMap[u.id] = u; });
    }

    const byClient: Record<string, any[]> = {};
    for (const a of access || []) {
      (byClient[a.client_id] = byClient[a.client_id] || []).push({
        ...a,
        user: usersMap[a.user_id] || null,
      });
    }

    const enriched = clients.map((c) => ({
      ...c,
      user_access: byClient[c.id] || [],
      user_access_count: (byClient[c.id] || []).length,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('List client access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/client-access/:clientId — detail with user access
router.get('/:clientId', async (req: Request, res: Response) => {
  try {
    const { data: client, error } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('id', req.params.clientId)
      .single();
    if (error || !client) {
      res.status(404).json({ success: false, error: 'Client not found' });
      return;
    }

    const { data: access } = await supabaseAdmin
      .from('client_user_access')
      .select('id, client_id, user_id, access_level, created_at')
      .eq('client_id', client.id);

    const userIds = (access || []).map((a: any) => a.user_id);
    const usersMap: Record<string, any> = {};
    if (userIds.length > 0) {
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id, display_name, email, avatar_url, user_type')
        .in('id', userIds);
      (users || []).forEach((u: any) => { usersMap[u.id] = u; });
    }

    res.json({
      success: true,
      data: {
        ...client,
        user_access: (access || []).map((a: any) => ({ ...a, user: usersMap[a.user_id] || null })),
      },
    });
  } catch (err) {
    console.error('Get client access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/client-access/:clientId/users — grant a user access
const addSchema = z.object({
  user_id: z.string().uuid(),
  access_level: z.enum(['member', 'admin']).optional(),
});

router.post('/:clientId/users', async (req: Request, res: Response) => {
  try {
    const body = addSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('client_user_access')
      .insert({
        client_id: req.params.clientId,
        user_id: body.user_id,
        access_level: body.access_level || 'member',
        created_by: req.userId!,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'User already has access to this client' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, avatar_url, user_type')
      .eq('id', body.user_id)
      .single();

    res.status(201).json({ success: true, data: { ...data, user } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add client user access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/client-access/:clientId/users/:userId — change access level
const levelSchema = z.object({ access_level: z.enum(['member', 'admin']) });

router.put('/:clientId/users/:userId', async (req: Request, res: Response) => {
  try {
    const body = levelSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('client_user_access')
      .update({ access_level: body.access_level })
      .eq('client_id', req.params.clientId)
      .eq('user_id', req.params.userId)
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
    console.error('Update access level error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/client-access/:clientId/users/:userId — revoke access
router.delete('/:clientId/users/:userId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('client_user_access')
      .delete()
      .eq('client_id', req.params.clientId)
      .eq('user_id', req.params.userId);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Access revoked' });
  } catch (err) {
    console.error('Revoke access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
