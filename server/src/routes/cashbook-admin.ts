import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { getDefaultRoleIdForUserType } from '../utils/defaultRole';
import { generateR2DownloadUrl } from '../r2';

const router = Router();

// All routes require auth + admin
router.use(requireAuth, requireAdmin);

// ---- Client Access Management ----

// GET /admin/cashbook/clients - List all active clients (used by partner access dropdown too)
router.get('/clients', async (_req: Request, res: Response) => {
  try {
    const { data: clients, error } = await supabaseAdmin
      .from('clients')
      .select('id, business_name, contact_person, email, status')
      .eq('status', 'active')
      .order('business_name', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch clients' });
      return;
    }

    res.json({ success: true, data: clients || [] });
  } catch (err) {
    console.error('Admin clients error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/cashbook/client-access - List clients added to cash book
router.get('/client-access', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('cash_book_client_access')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch client access' });
      return;
    }

    // Enrich with client info
    const clientIds = [...new Set((data || []).map(r => r.client_id))];

    const { data: clients } = await supabaseAdmin
      .from('clients')
      .select('id, business_name, contact_person, email')
      .in('id', clientIds.length ? clientIds : ['_']);

    const clientMap = new Map((clients || []).map(c => [c.id, c]));

    const enriched = (data || []).map(r => ({
      ...r,
      client: clientMap.get(r.client_id) || null,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Client access list error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/cashbook/client-access/available - Clients not yet added to cash book
router.get('/client-access/available', async (_req: Request, res: Response) => {
  try {
    // Get all client IDs that already have access
    const { data: existing } = await supabaseAdmin
      .from('cash_book_client_access')
      .select('client_id');

    const existingIds = (existing || []).map(r => r.client_id);

    // Get all clients not in that list
    let query = supabaseAdmin
      .from('clients')
      .select('id, business_name, contact_person, email, status')
      .order('business_name', { ascending: true });

    if (existingIds.length > 0) {
      query = query.not('id', 'in', `(${existingIds.join(',')})`);
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch available clients' });
      return;
    }

    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('Available clients error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/cashbook/client-access - Add a client to cash book
router.post('/client-access', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      client_id: z.string().uuid(),
    });
    const body = schema.parse(req.body);

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

    const { error } = await supabaseAdmin
      .from('cash_book_client_access')
      .upsert({
        client_id: body.client_id,
        is_enabled: true,
        enabled_by: req.userId!,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'client_id' });

    if (error) {
      console.error('Add client access error:', error);
      res.status(500).json({ success: false, error: 'Failed to add client' });
      return;
    }

    res.json({ success: true, message: 'Client added to Cash Book' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add client access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/cashbook/client-access/:id/toggle - Toggle enabled/disabled
router.put('/client-access/:id/toggle', async (req: Request, res: Response) => {
  try {
    const { data: existing } = await supabaseAdmin
      .from('cash_book_client_access')
      .select('id, is_enabled')
      .eq('id', req.params.id)
      .single();

    if (!existing) {
      res.status(404).json({ success: false, error: 'Access record not found' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('cash_book_client_access')
      .update({ is_enabled: !existing.is_enabled, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to toggle access' });
      return;
    }

    res.json({ success: true, is_enabled: !existing.is_enabled });
  } catch (err) {
    console.error('Toggle client access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/cashbook/client-access/:id - Remove client from cash book
router.delete('/client-access/:id', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('cash_book_client_access')
      .delete()
      .eq('id', req.params.id);

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to remove client access' });
      return;
    }

    res.json({ success: true, message: 'Client removed from Cash Book' });
  } catch (err) {
    console.error('Remove client access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- View Entries ----

// GET /admin/cashbook/entries?client_id=&date_from=&date_to=&type=&is_posted=&page=&limit=
router.get('/entries', async (req: Request, res: Response) => {
  try {
    const { client_id, date_from, date_to, type, is_posted, page = '1', limit = '50' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabaseAdmin
      .from('cash_book_entries')
      .select(`
        *,
        user:users!cash_book_entries_user_id_fkey(id, display_name),
        category:cash_book_categories(id, name, type),
        client:clients!cash_book_entries_client_id_fkey(id, business_name)
      `, { count: 'exact' })
      .eq('is_deleted', false)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (client_id) query = query.eq('client_id', client_id as string);
    if (date_from) query = query.gte('entry_date', date_from as string);
    if (date_to) query = query.lte('entry_date', date_to as string);
    if (type) query = query.eq('entry_type', type as string);
    if (is_posted !== undefined) query = query.eq('is_posted', is_posted === 'true');

    const { data, count, error } = await query;

    if (error) {
      console.error('Admin entries fetch error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch entries' });
      return;
    }

    res.json({ success: true, data, total: count });
  } catch (err) {
    console.error('Admin entries error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/cashbook/entries/:id - Single entry with audit trail
router.get('/entries/:id', async (req: Request, res: Response) => {
  try {
    const { data: entry, error } = await supabaseAdmin
      .from('cash_book_entries')
      .select(`
        *,
        user:users!cash_book_entries_user_id_fkey(id, display_name),
        category:cash_book_categories(id, name, type),
        client:clients!cash_book_entries_client_id_fkey(id, business_name)
      `)
      .eq('id', req.params.id)
      .single();

    if (error || !entry) {
      res.status(404).json({ success: false, error: 'Entry not found' });
      return;
    }

    // Fetch audit trail
    const { data: audit } = await supabaseAdmin
      .from('cash_book_entry_audit')
      .select('*, changed_by_user:users!cash_book_entry_audit_changed_by_fkey(id, display_name)')
      .eq('entry_id', req.params.id)
      .eq('entry_table', 'cash_book_entries')
      .order('created_at', { ascending: false });

    res.json({ success: true, data: { ...entry, audit: audit || [] } });
  } catch (err) {
    console.error('Admin entry detail error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/cashbook/entries/post - Batch mark as posted
router.post('/entries/post', async (req: Request, res: Response) => {
  try {
    const postSchema = z.object({
      entry_ids: z.array(z.string().uuid()).min(1),
    });
    const body = postSchema.parse(req.body);
    const now = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from('cash_book_entries')
      .update({
        is_posted: true,
        posted_by: req.userId!,
        posted_at: now,
        server_updated_at: now,
      })
      .in('id', body.entry_ids);

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to mark entries as posted' });
      return;
    }

    // Audit for each entry
    const auditRows = body.entry_ids.map(id => ({
      entry_id: id,
      entry_table: 'cash_book_entries' as const,
      changed_by: req.userId!,
      action: 'post' as const,
      changes: {},
    }));
    await supabaseAdmin.from('cash_book_entry_audit').insert(auditRows);

    res.json({ success: true, message: `${body.entry_ids.length} entries marked as posted` });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Post entries error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/cashbook/entries/unpost - Batch unmark
router.post('/entries/unpost', async (req: Request, res: Response) => {
  try {
    const unpostSchema = z.object({
      entry_ids: z.array(z.string().uuid()).min(1),
    });
    const body = unpostSchema.parse(req.body);
    const now = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from('cash_book_entries')
      .update({
        is_posted: false,
        posted_by: null,
        posted_at: null,
        server_updated_at: now,
      })
      .in('id', body.entry_ids);

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to unpost entries' });
      return;
    }

    const auditRows = body.entry_ids.map(id => ({
      entry_id: id,
      entry_table: 'cash_book_entries' as const,
      changed_by: req.userId!,
      action: 'unpost' as const,
      changes: {},
    }));
    await supabaseAdmin.from('cash_book_entry_audit').insert(auditRows);

    res.json({ success: true, message: `${body.entry_ids.length} entries unmarked` });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Unpost entries error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- View Checks ----

// GET /admin/cashbook/checks?client_id=&check_type=&status=&date_from=&date_to=&page=&limit=
router.get('/checks', async (req: Request, res: Response) => {
  try {
    const { client_id, check_type, status, date_from, date_to, page = '1', limit = '50' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabaseAdmin
      .from('check_entries')
      .select(`
        *,
        user:users!check_entries_user_id_fkey(id, display_name),
        client:clients!check_entries_client_id_fkey(id, business_name)
      `, { count: 'exact' })
      .eq('is_deleted', false)
      .order('check_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (client_id) query = query.eq('client_id', client_id as string);
    if (check_type) query = query.eq('check_type', check_type as string);
    if (status) query = query.eq('status', status as string);
    if (date_from) query = query.gte('check_date', date_from as string);
    if (date_to) query = query.lte('check_date', date_to as string);

    const { data, count, error } = await query;

    if (error) {
      console.error('Admin checks fetch error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch checks' });
      return;
    }

    res.json({ success: true, data, total: count });
  } catch (err) {
    console.error('Admin checks error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/cashbook/checks/post - Batch mark checks as posted
router.post('/checks/post', async (req: Request, res: Response) => {
  try {
    const postSchema = z.object({
      check_ids: z.array(z.string().uuid()).min(1),
    });
    const body = postSchema.parse(req.body);
    const now = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from('check_entries')
      .update({
        is_posted: true,
        posted_by: req.userId!,
        posted_at: now,
        server_updated_at: now,
      })
      .in('id', body.check_ids);

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to mark checks as posted' });
      return;
    }

    const auditRows = body.check_ids.map(id => ({
      entry_id: id,
      entry_table: 'check_entries' as const,
      changed_by: req.userId!,
      action: 'post' as const,
      changes: {},
    }));
    await supabaseAdmin.from('cash_book_entry_audit').insert(auditRows);

    res.json({ success: true, message: `${body.check_ids.length} checks marked as posted` });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Post checks error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- Stats ----

// GET /admin/cashbook/stats
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    // Count enabled clients
    const { count: enabledClients } = await supabaseAdmin
      .from('cash_book_client_access')
      .select('*', { count: 'exact', head: true })
      .eq('is_enabled', true);

    // Count total users
    const { count: totalUsers } = await supabaseAdmin
      .from('cash_book_users')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    // Count unposted entries
    const { count: unpostedEntries } = await supabaseAdmin
      .from('cash_book_entries')
      .select('*', { count: 'exact', head: true })
      .eq('is_posted', false)
      .eq('is_deleted', false);

    // Count unposted checks
    const { count: unpostedChecks } = await supabaseAdmin
      .from('check_entries')
      .select('*', { count: 'exact', head: true })
      .eq('is_posted', false)
      .eq('is_deleted', false);

    res.json({
      success: true,
      data: {
        enabled_clients: enabledClients || 0,
        total_users: totalUsers || 0,
        unposted_entries: unpostedEntries || 0,
        unposted_checks: unpostedChecks || 0,
      },
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/cashbook/clients/:clientId/users - List cash book users for a client
router.get('/clients/:clientId/users', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('cash_book_users')
      .select('*, user:users!cash_book_users_user_id_fkey(id, display_name, email)')
      .eq('client_id', req.params.clientId)
      .order('role', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Client users fetch error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch users' });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Client users error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/cashbook/clients/:clientId/users - Create a new cash book user
const createCashBookUserSchema = z.object({
  display_name: z.string().min(1).max(50),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['client_admin', 'staff']).default('staff'),
});

router.post('/clients/:clientId/users', async (req: Request, res: Response) => {
  try {
    const body = createCashBookUserSchema.parse(req.body ?? {});
    const clientId = req.params.clientId as string;

    // Verify client has cash book access enabled
    const { data: access } = await supabaseAdmin
      .from('cash_book_client_access')
      .select('id')
      .eq('client_id', clientId)
      .eq('is_enabled', true)
      .maybeSingle();

    if (!access) {
      res.status(404).json({ success: false, error: 'Client does not have Cash Book enabled' });
      return;
    }

    // Check if email already exists in users table
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', body.email)
      .maybeSingle();

    let userId: string;

    if (existingUser) {
      // Check if already a cash book user for this client
      const { data: existingCbUser } = await supabaseAdmin
        .from('cash_book_users')
        .select('id')
        .eq('user_id', existingUser.id)
        .eq('client_id', clientId)
        .maybeSingle();

      if (existingCbUser) {
        res.status(409).json({ success: false, error: 'User already exists for this client' });
        return;
      }
      userId = existingUser.id;
    } else {
      // Create Supabase Auth user
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: true,
        user_metadata: { display_name: body.display_name },
      });

      if (authError) {
        res.status(400).json({ success: false, error: authError.message });
        return;
      }

      userId = authData.user.id;

      // Insert into users table
      await supabaseAdmin.from('users').insert({
        id: userId,
        email: body.email,
        display_name: body.display_name,
        status: 'active',
        user_type: 'client',
      });

      // Add to the workspace so they have somewhere to land on first login.
      // Without this row GET /workspaces returns empty and the app gets stuck
      // on the "Welcome to SquadHub — workspace is being set up" screen.
      const { data: workspace } = await supabaseAdmin
        .from('workspaces')
        .select('id')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      const roleId = await getDefaultRoleIdForUserType('client');

      if (workspace && roleId) {
        const { error: memberError } = await supabaseAdmin
          .from('workspace_members')
          .upsert(
            { workspace_id: workspace.id, user_id: userId, role: 'member', role_id: roleId },
            { onConflict: 'workspace_id,user_id' }
          );

        if (memberError) {
          console.error('Cash book user workspace membership insert failed:', memberError);
          res.status(500).json({ success: false, error: `Failed to add user to workspace: ${memberError.message}` });
          return;
        }
      } else {
        console.error('Cash book user create: missing workspace or default client role', { hasWorkspace: !!workspace, hasRole: !!roleId });
        res.status(500).json({ success: false, error: 'Could not assign user to a workspace' });
        return;
      }
    }

    const role = body.role;

    // Insert cash_book_users row
    const { data: cbUser, error: cbError } = await supabaseAdmin
      .from('cash_book_users')
      .insert({
        user_id: userId,
        client_id: clientId,
        role,
        is_active: true,
        invited_by: req.userId!,
      })
      .select('*, user:users!cash_book_users_user_id_fkey(id, display_name, email)')
      .single();

    if (cbError) {
      console.error('Create cash book user error:', cbError);
      res.status(500).json({ success: false, error: 'Failed to create user' });
      return;
    }

    res.json({ success: true, data: cbUser });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create cash book user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/cashbook/clients/:clientId/users/:userId/toggle - Suspend/unsuspend user
router.put('/clients/:clientId/users/:userId/toggle', async (req: Request, res: Response) => {
  try {
    const { data: cbUser, error: fetchError } = await supabaseAdmin
      .from('cash_book_users')
      .select('id, is_active')
      .eq('id', req.params.userId)
      .eq('client_id', req.params.clientId)
      .single();

    if (fetchError || !cbUser) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const newStatus = !cbUser.is_active;
    const { error: updateError } = await supabaseAdmin
      .from('cash_book_users')
      .update({ is_active: newStatus, updated_at: new Date().toISOString() })
      .eq('id', cbUser.id);

    if (updateError) {
      res.status(500).json({ success: false, error: 'Failed to update user' });
      return;
    }

    res.json({ success: true, is_active: newStatus });
  } catch (err) {
    console.error('Toggle cash book user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/cashbook/clients/:clientId/users/:userId/role - Change user role
router.put('/clients/:clientId/users/:userId/role', async (req: Request, res: Response) => {
  try {
    const { role } = z.object({ role: z.enum(['client_admin', 'staff']) }).parse(req.body ?? {});

    const { error } = await supabaseAdmin
      .from('cash_book_users')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', req.params.userId)
      .eq('client_id', req.params.clientId);

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to update role' });
      return;
    }

    res.json({ success: true, role });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update cash book user role error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/cashbook/clients/:clientId/users/:userId - Remove user from cash book
router.delete('/clients/:clientId/users/:userId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('cash_book_users')
      .delete()
      .eq('id', req.params.userId)
      .eq('client_id', req.params.clientId);

    if (error) {
      console.error('Remove cash book user error:', error);
      res.status(500).json({ success: false, error: 'Failed to remove user' });
      return;
    }

    res.json({ success: true, message: 'User removed' });
  } catch (err) {
    console.error('Remove cash book user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- Partner Access Management ----

// GET /admin/cashbook/partner-access - List all partner access records
router.get('/partner-access', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('cash_book_partner_access')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch partner access' });
      return;
    }

    // Enrich with user and client info
    const userIds = [...new Set((data || []).map(r => r.user_id))];
    const clientIds = [...new Set((data || []).map(r => r.client_id))];

    const [{ data: users }, { data: clients }] = await Promise.all([
      supabaseAdmin.from('users').select('id, display_name, email').in('id', userIds.length ? userIds : ['_']),
      supabaseAdmin.from('clients').select('id, business_name').in('id', clientIds.length ? clientIds : ['_']),
    ]);

    const userMap = new Map((users || []).map(u => [u.id, u]));
    const clientMap = new Map((clients || []).map(c => [c.id, c]));

    const enriched = (data || []).map(r => ({
      ...r,
      user: userMap.get(r.user_id) || null,
      client: clientMap.get(r.client_id) || null,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Partner access list error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/cashbook/partner-access/partners - List all partner users for dropdown
router.get('/partner-access/partners', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email')
      .eq('user_type', 'partner')
      .order('display_name', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch partners' });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Partner list error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/cashbook/partner-access - Grant partner access to clients
router.post('/partner-access', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      user_id: z.string().uuid(),
      client_ids: z.array(z.string().uuid()).min(1),
    });
    const body = schema.parse(req.body);

    // Verify user is a partner
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, user_type')
      .eq('id', body.user_id)
      .single();

    if (!user || user.user_type !== 'partner') {
      res.status(400).json({ success: false, error: 'User is not a partner' });
      return;
    }

    // Upsert access rows (re-enable if previously disabled)
    const rows = body.client_ids.map(client_id => ({
      user_id: body.user_id,
      client_id,
      is_enabled: true,
      enabled_by: req.userId!,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabaseAdmin
      .from('cash_book_partner_access')
      .upsert(rows, { onConflict: 'user_id,client_id' });

    if (error) {
      console.error('Grant partner access error:', error);
      res.status(500).json({ success: false, error: 'Failed to grant partner access' });
      return;
    }

    res.json({ success: true, message: `Access granted to ${body.client_ids.length} client(s)` });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Grant partner access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/cashbook/partner-access/:id/toggle - Toggle enabled/disabled
router.put('/partner-access/:id/toggle', async (req: Request, res: Response) => {
  try {
    const { data: existing } = await supabaseAdmin
      .from('cash_book_partner_access')
      .select('id, is_enabled')
      .eq('id', req.params.id)
      .single();

    if (!existing) {
      res.status(404).json({ success: false, error: 'Access record not found' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('cash_book_partner_access')
      .update({ is_enabled: !existing.is_enabled, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to toggle access' });
      return;
    }

    res.json({ success: true, is_enabled: !existing.is_enabled });
  } catch (err) {
    console.error('Toggle partner access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/cashbook/partner-access/:id - Revoke access
router.delete('/partner-access/:id', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('cash_book_partner_access')
      .delete()
      .eq('id', req.params.id);

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to revoke access' });
      return;
    }

    res.json({ success: true, message: 'Access revoked' });
  } catch (err) {
    console.error('Revoke partner access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/cashbook/photo/sign?key=<objectKey>
// Returns a short-lived signed GET URL for any cash book photo. Admin can
// view all clients' photos; access is gated only by requireAdmin above.
router.get('/photo/sign', async (req: Request, res: Response) => {
  try {
    const key = typeof req.query.key === 'string' ? req.query.key : '';
    if (!key.startsWith('cashbook/')) {
      res.status(400).json({ success: false, error: 'Invalid key' });
      return;
    }
    const url = await generateR2DownloadUrl(key, 3600);
    res.json({ success: true, data: { url, expiresIn: 3600 } });
  } catch (err) {
    console.error('Admin photo sign error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
