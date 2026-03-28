import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

// GET /admin/invitations — list all invitations
router.get('/', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;

    let query = supabaseAdmin
      .from('invitations')
      .select('*, roles(id, name, color)')
      .order('invited_at', { ascending: false });

    if (status && ['pending', 'accepted', 'expired'].includes(status)) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Attach invited_by user info
    const inviterIds = [...new Set((data || []).map((i: any) => i.invited_by))];
    const { data: inviters } = await supabaseAdmin
      .from('users')
      .select('id, display_name')
      .in('id', inviterIds);

    const inviterMap = new Map((inviters || []).map((u: any) => [u.id, u]));

    const enriched = (data || []).map((inv: any) => ({
      ...inv,
      role: inv.roles,
      roles: undefined,
      invited_by_user: inviterMap.get(inv.invited_by) || null,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('List invitations error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/invitations — create a new invitation
const createSchema = z.object({
  email: z.string().email(),
  role_id: z.string().uuid().optional(),
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    // Check if email already has a pending invitation
    const { data: existing } = await supabaseAdmin
      .from('invitations')
      .select('id')
      .eq('email', body.email)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      res.status(409).json({ success: false, error: 'A pending invitation already exists for this email' });
      return;
    }

    // Check if user already exists and is approved
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, status')
      .eq('email', body.email)
      .maybeSingle();

    if (existingUser?.status === 'approved') {
      res.status(409).json({ success: false, error: 'A user with this email already exists and is approved' });
      return;
    }

    // Determine role: use provided or fall back to default
    let roleId = body.role_id || null;
    if (!roleId) {
      const { data: defaultRole } = await supabaseAdmin
        .from('roles')
        .select('id')
        .eq('is_default', true)
        .single();
      roleId = defaultRole?.id || null;
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('invitations')
      .insert({
        email: body.email,
        role_id: roleId,
        invited_by: req.userId,
        status: 'pending',
        expires_at: expiresAt,
      })
      .select('*, roles(id, name, color)')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.status(201).json({
      success: true,
      data: { ...data, role: data.roles, roles: undefined },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create invitation error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/invitations/:id/resend — resend (re-invite) an expired or pending invitation
router.put('/:id/resend', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('invitations')
      .update({
        status: 'pending',
        expires_at: expiresAt,
        invited_at: new Date().toISOString(),
        invited_by: req.userId,
      })
      .eq('id', id)
      .in('status', ['pending', 'expired'])
      .select('*, roles(id, name, color)')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({
      success: true,
      data: { ...data, role: data.roles, roles: undefined },
    });
  } catch (err) {
    console.error('Resend invitation error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/invitations/:id — revoke a pending invitation
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;

    const { error } = await supabaseAdmin
      .from('invitations')
      .delete()
      .eq('id', id)
      .eq('status', 'pending');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Invitation revoked' });
  } catch (err) {
    console.error('Revoke invitation error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
