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
      .select('id, client_id, user_id, role_id, created_at')
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

    const roleIds = Array.from(new Set((access || []).map((a: any) => a.role_id).filter(Boolean)));
    const rolesMap: Record<string, any> = {};
    if (roleIds.length > 0) {
      const { data: roles } = await supabaseAdmin
        .from('roles')
        .select('id, name, color, is_system')
        .in('id', roleIds);
      (roles || []).forEach((r: any) => { rolesMap[r.id] = r; });
    }

    const byClient: Record<string, any[]> = {};
    for (const a of access || []) {
      (byClient[a.client_id] = byClient[a.client_id] || []).push({
        ...a,
        user: usersMap[a.user_id] || null,
        role: a.role_id ? rolesMap[a.role_id] || null : null,
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
      .select('id, client_id, user_id, role_id, created_at')
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

    const roleIds = Array.from(new Set((access || []).map((a: any) => a.role_id).filter(Boolean)));
    const rolesMap: Record<string, any> = {};
    if (roleIds.length > 0) {
      const { data: roles } = await supabaseAdmin
        .from('roles')
        .select('id, name, color, is_system')
        .in('id', roleIds);
      (roles || []).forEach((r: any) => { rolesMap[r.id] = r; });
    }

    res.json({
      success: true,
      data: {
        ...client,
        user_access: (access || []).map((a: any) => ({
          ...a,
          user: usersMap[a.user_id] || null,
          role: a.role_id ? rolesMap[a.role_id] || null : null,
        })),
      },
    });
  } catch (err) {
    console.error('Get client access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- Clients/Areas merge helpers ----
// Each client can have its own area (spaces.client_id). Access grants are
// mirrored onto that space so Areas visibility stays in sync.
async function getClientSpaceId(clientId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('spaces')
    .select('id')
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

async function roleAccessLevel(roleId: string | null): Promise<'manager' | 'member'> {
  if (!roleId) return 'member';
  const { data } = await supabaseAdmin
    .from('roles')
    .select('name')
    .eq('id', roleId)
    .maybeSingle();
  return data?.name === 'Squad Manager' ? 'manager' : 'member';
}

async function mirrorGrantToSpace(clientId: string, userId: string, roleId: string | null, invitedBy: string) {
  const spaceId = await getClientSpaceId(clientId);
  if (!spaceId) return;
  await supabaseAdmin.from('resource_memberships').upsert(
    {
      resource_type: 'space',
      resource_id: spaceId,
      user_id: userId,
      access_level: await roleAccessLevel(roleId),
      invited_by: invitedBy,
    },
    { onConflict: 'resource_type,resource_id,user_id' },
  );
}

// POST /admin/client-access/:clientId/users — grant a user access at a specific role
const addSchema = z.object({
  user_id: z.string().uuid(),
  role_id: z.string().uuid().optional(),
});

router.post('/:clientId/users', async (req: Request, res: Response) => {
  try {
    const body = addSchema.parse(req.body);

    // Default role if none provided: the seeded 'Client User' role
    let roleId: string | null = body.role_id || null;
    if (!roleId) {
      const { data: defaultRole } = await supabaseAdmin
        .from('roles')
        .select('id')
        .eq('name', 'Client User')
        .limit(1)
        .maybeSingle();
      roleId = defaultRole?.id || null;
    }

    const { data, error } = await supabaseAdmin
      .from('client_user_access')
      .insert({
        client_id: req.params.clientId,
        user_id: body.user_id,
        role_id: roleId,
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

    await mirrorGrantToSpace(req.params.clientId as string, body.user_id, roleId, req.userId!);

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, avatar_url, user_type')
      .eq('id', body.user_id)
      .single();

    let role = null;
    if (roleId) {
      const { data: r } = await supabaseAdmin
        .from('roles')
        .select('id, name, color, is_system')
        .eq('id', roleId)
        .single();
      role = r;
    }

    res.status(201).json({ success: true, data: { ...data, user, role } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add client user access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/client-access/:clientId/users/:userId — change role
const updateSchema = z.object({ role_id: z.string().uuid().nullable() });

router.put('/:clientId/users/:userId', async (req: Request, res: Response) => {
  try {
    const body = updateSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('client_user_access')
      .update({ role_id: body.role_id })
      .eq('client_id', req.params.clientId)
      .eq('user_id', req.params.userId)
      .select()
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    await mirrorGrantToSpace(req.params.clientId as string, req.params.userId as string, body.role_id, req.userId!);

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update client role error:', err);
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

    // Drop the mirrored space membership (if the client has an area)
    const spaceId = await getClientSpaceId(req.params.clientId as string);
    if (spaceId) {
      await supabaseAdmin
        .from('resource_memberships')
        .delete()
        .eq('resource_type', 'space')
        .eq('resource_id', spaceId)
        .eq('user_id', req.params.userId);
    }

    res.json({ success: true, message: 'Access revoked' });
  } catch (err) {
    console.error('Revoke access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
