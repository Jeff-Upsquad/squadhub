import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

// All routes require auth + admin
router.use(requireAuth, requireAdmin);

// ---- Client Access Management ----

// GET /admin/cashbook/clients - List all clients with cash book access status
router.get('/clients', async (_req: Request, res: Response) => {
  try {
    // Get all active clients
    const { data: clients, error } = await supabaseAdmin
      .from('clients')
      .select('id, business_name, contact_person, email, status')
      .eq('status', 'active')
      .order('business_name', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch clients' });
      return;
    }

    // Get cash book access for all clients
    const { data: accessList } = await supabaseAdmin
      .from('cash_book_client_access')
      .select('client_id, is_enabled, enabled_by, created_at');

    const accessMap = new Map((accessList || []).map(a => [a.client_id, a]));

    const result = (clients || []).map(client => ({
      ...client,
      cash_book: accessMap.get(client.id) || null,
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Admin clients error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/cashbook/clients/:clientId/enable
router.post('/clients/:clientId/enable', async (req: Request, res: Response) => {
  try {
    const enableSchema = z.object({
      admin_user_id: z.string().uuid().optional(),
    });
    const body = enableSchema.parse(req.body);

    const clientId = req.params.clientId;

    // Verify client exists
    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('id, email, contact_person')
      .eq('id', clientId)
      .single();

    if (!client) {
      res.status(404).json({ success: false, error: 'Client not found' });
      return;
    }

    // Upsert cash_book_client_access
    const { error: accessError } = await supabaseAdmin
      .from('cash_book_client_access')
      .upsert({
        client_id: clientId,
        is_enabled: true,
        enabled_by: req.userId!,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'client_id' });

    if (accessError) {
      console.error('Enable error:', accessError);
      res.status(500).json({ success: false, error: 'Failed to enable cash book' });
      return;
    }

    // If admin_user_id is provided, make them the client_admin
    if (body.admin_user_id) {
      await supabaseAdmin
        .from('cash_book_users')
        .upsert({
          user_id: body.admin_user_id,
          client_id: clientId,
          role: 'client_admin',
          invited_by: req.userId!,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,client_id' });
    }

    res.json({ success: true, message: 'Cash book enabled for client' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Enable error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/cashbook/clients/:clientId/disable
router.post('/clients/:clientId/disable', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('cash_book_client_access')
      .update({ is_enabled: false, updated_at: new Date().toISOString() })
      .eq('client_id', req.params.clientId);

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to disable cash book' });
      return;
    }

    res.json({ success: true, message: 'Cash book disabled for client' });
  } catch (err) {
    console.error('Disable error:', err);
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

export default router;
