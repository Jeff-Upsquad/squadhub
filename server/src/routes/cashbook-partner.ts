import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireUserType } from '../middleware/userType';
import { supabaseAdmin } from '../supabase';
import { generateR2DownloadUrl } from '../r2';
import { PARTNER_USER_TYPES } from '@squadhub/shared';

const router = Router();

// All routes require auth + partner-tier user type
router.use(requireAuth, requireUserType(...PARTNER_USER_TYPES));

// Helper: verify partner has access to a specific client
async function verifyClientAccess(userId: string, clientId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('cash_book_partner_access')
    .select('id')
    .eq('user_id', userId)
    .eq('client_id', clientId)
    .eq('is_enabled', true)
    .single();
  return !!data;
}

// GET /partner/cashbook/clients - List clients this partner has access to
router.get('/clients', async (req: Request, res: Response) => {
  try {
    const { data: accessList, error } = await supabaseAdmin
      .from('cash_book_partner_access')
      .select('client_id')
      .eq('user_id', req.userId!)
      .eq('is_enabled', true);

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch access list' });
      return;
    }

    const clientIds = (accessList || []).map(a => a.client_id);
    if (clientIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    // Fetch client info
    const { data: clients } = await supabaseAdmin
      .from('clients')
      .select('id, business_name, contact_person')
      .in('id', clientIds)
      .order('business_name', { ascending: true });

    // Get unposted counts per client
    const statsPromises = clientIds.map(async (clientId) => {
      const [{ count: unpostedEntries }, { count: unpostedChecks }, { count: unpostedExpenses }, { count: totalEntries }] = await Promise.all([
        supabaseAdmin
          .from('cash_book_entries')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .eq('is_posted', false)
          .eq('is_deleted', false),
        supabaseAdmin
          .from('check_entries')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .eq('is_posted', false)
          .eq('is_deleted', false),
        supabaseAdmin
          .from('cashbook_expense_entries')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .eq('is_posted', false)
          .eq('is_deleted', false),
        supabaseAdmin
          .from('cash_book_entries')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .eq('is_deleted', false),
      ]);
      return {
        client_id: clientId,
        unposted_entries: unpostedEntries || 0,
        unposted_checks: unpostedChecks || 0,
        unposted_expenses: unpostedExpenses || 0,
        total_entries: totalEntries || 0,
      };
    });

    const stats = await Promise.all(statsPromises);
    const statsMap = new Map(stats.map(s => [s.client_id, s]));

    const result = (clients || []).map(client => ({
      ...client,
      stats: statsMap.get(client.id) || { unposted_entries: 0, unposted_checks: 0, total_entries: 0 },
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Partner cashbook clients error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /partner/cashbook/clients/:clientId/entries
router.get('/clients/:clientId/entries', async (req: Request, res: Response) => {
  try {
    if (!await verifyClientAccess(req.userId!, req.params.clientId as string)) {
      res.status(403).json({ success: false, error: 'No access to this client' });
      return;
    }

    const { date_from, date_to, type, is_posted, page = '1', limit = '50' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabaseAdmin
      .from('cash_book_entries')
      .select(`
        *,
        user:users!cash_book_entries_user_id_fkey(id, display_name),
        category:cash_book_categories(id, name, type)
      `, { count: 'exact' })
      .eq('client_id', req.params.clientId)
      .eq('is_deleted', false)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (date_from) query = query.gte('entry_date', date_from as string);
    if (date_to) query = query.lte('entry_date', date_to as string);
    if (type) query = query.eq('entry_type', type as string);
    if (is_posted !== undefined) query = query.eq('is_posted', is_posted === 'true');

    const { data, count, error } = await query;

    if (error) {
      console.error('Partner entries fetch error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch entries' });
      return;
    }

    res.json({ success: true, data, total: count });
  } catch (err) {
    console.error('Partner entries error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /partner/cashbook/clients/:clientId/checks
router.get('/clients/:clientId/checks', async (req: Request, res: Response) => {
  try {
    if (!await verifyClientAccess(req.userId!, req.params.clientId as string)) {
      res.status(403).json({ success: false, error: 'No access to this client' });
      return;
    }

    const { check_type, status, date_from, date_to, page = '1', limit = '50' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabaseAdmin
      .from('check_entries')
      .select(`
        *,
        user:users!check_entries_user_id_fkey(id, display_name)
      `, { count: 'exact' })
      .eq('client_id', req.params.clientId)
      .eq('is_deleted', false)
      .order('check_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (check_type) query = query.eq('check_type', check_type as string);
    if (status) query = query.eq('status', status as string);
    if (date_from) query = query.gte('check_date', date_from as string);
    if (date_to) query = query.lte('check_date', date_to as string);

    const { data, count, error } = await query;

    if (error) {
      console.error('Partner checks fetch error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch checks' });
      return;
    }

    res.json({ success: true, data, total: count });
  } catch (err) {
    console.error('Partner checks error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /partner/cashbook/clients/:clientId/expenses
router.get('/clients/:clientId/expenses', async (req: Request, res: Response) => {
  try {
    if (!await verifyClientAccess(req.userId!, req.params.clientId as string)) {
      res.status(403).json({ success: false, error: 'No access to this client' });
      return;
    }

    const { type, is_posted, date_from, date_to, page = '1', limit = '50' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabaseAdmin
      .from('cashbook_expense_entries')
      .select(`
        *,
        user:users!cashbook_expense_entries_user_id_fkey(id, display_name),
        category:cash_book_categories(id, name, type)
      `, { count: 'exact' })
      .eq('client_id', req.params.clientId)
      .eq('is_deleted', false)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (type) query = query.eq('entry_type', type as string);
    if (is_posted !== undefined) query = query.eq('is_posted', is_posted === 'true');
    if (date_from) query = query.gte('entry_date', date_from as string);
    if (date_to) query = query.lte('entry_date', date_to as string);

    const { data, count, error } = await query;

    if (error) {
      console.error('Partner expenses fetch error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch expenses' });
      return;
    }

    res.json({ success: true, data, total: count });
  } catch (err) {
    console.error('Partner expenses error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /partner/cashbook/clients/:clientId/stats
router.get('/clients/:clientId/stats', async (req: Request, res: Response) => {
  try {
    if (!await verifyClientAccess(req.userId!, req.params.clientId as string)) {
      res.status(403).json({ success: false, error: 'No access to this client' });
      return;
    }

    const clientId = req.params.clientId;

    const [
      { data: cashInData },
      { data: cashOutData },
      { count: unpostedEntries },
      { count: unpostedChecks },
      { count: unpostedExpenses },
      { data: expenseData },
    ] = await Promise.all([
      supabaseAdmin.rpc('sum_entries_by_type', { p_client_id: clientId, p_type: 'cash_in' }).single(),
      supabaseAdmin.rpc('sum_entries_by_type', { p_client_id: clientId, p_type: 'cash_out' }).single(),
      supabaseAdmin
        .from('cash_book_entries')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId).eq('is_posted', false).eq('is_deleted', false),
      supabaseAdmin
        .from('check_entries')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId).eq('is_posted', false).eq('is_deleted', false),
      supabaseAdmin
        .from('cashbook_expense_entries')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId).eq('is_posted', false).eq('is_deleted', false),
      supabaseAdmin
        .from('cashbook_expense_entries')
        .select('entry_type, amount')
        .eq('client_id', clientId)
        .eq('is_deleted', false),
    ]);

    // Fallback: if RPC doesn't exist, compute via query
    let totalIn = 0;
    let totalOut = 0;

    if (cashInData && typeof cashInData === 'object' && 'total' in cashInData) {
      totalIn = Number(cashInData.total) || 0;
      totalOut = Number((cashOutData as any)?.total) || 0;
    } else {
      // Manual sum fallback
      const { data: entries } = await supabaseAdmin
        .from('cash_book_entries')
        .select('entry_type, amount')
        .eq('client_id', clientId)
        .eq('is_deleted', false);

      for (const e of entries || []) {
        if (e.entry_type === 'cash_in') totalIn += Number(e.amount);
        else totalOut += Number(e.amount);
      }
    }

    let totalExpenseOut = 0;
    let totalExpenseIn = 0;
    for (const e of expenseData || []) {
      if (e.entry_type === 'expense_out') totalExpenseOut += Number(e.amount);
      else totalExpenseIn += Number(e.amount);
    }

    res.json({
      success: true,
      data: {
        total_cash_in: totalIn,
        total_cash_out: totalOut,
        balance: totalIn - totalOut,
        unposted_entries: unpostedEntries || 0,
        unposted_checks: unpostedChecks || 0,
        unposted_expenses: unpostedExpenses || 0,
        total_expense_out: totalExpenseOut,
        total_expense_in: totalExpenseIn,
        expense_balance: totalExpenseIn - totalExpenseOut,
      },
    });
  } catch (err) {
    console.error('Partner stats error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /partner/cashbook/entries/post - Batch mark entries as posted
router.post('/entries/post', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      entry_ids: z.array(z.string().uuid()).min(1),
    });
    const body = schema.parse(req.body);
    const now = new Date().toISOString();

    // Verify partner has access to ALL entries' clients
    const { data: entries } = await supabaseAdmin
      .from('cash_book_entries')
      .select('id, client_id')
      .in('id', body.entry_ids);

    const clientIds = [...new Set((entries || []).map(e => e.client_id))];
    for (const clientId of clientIds) {
      if (!await verifyClientAccess(req.userId!, clientId)) {
        res.status(403).json({ success: false, error: 'No access to one or more clients' });
        return;
      }
    }

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
    console.error('Partner post entries error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /partner/cashbook/entries/unpost - Batch unmark entries
router.post('/entries/unpost', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      entry_ids: z.array(z.string().uuid()).min(1),
    });
    const body = schema.parse(req.body);
    const now = new Date().toISOString();

    const { data: entries } = await supabaseAdmin
      .from('cash_book_entries')
      .select('id, client_id')
      .in('id', body.entry_ids);

    const clientIds = [...new Set((entries || []).map(e => e.client_id))];
    for (const clientId of clientIds) {
      if (!await verifyClientAccess(req.userId!, clientId)) {
        res.status(403).json({ success: false, error: 'No access to one or more clients' });
        return;
      }
    }

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
    console.error('Partner unpost entries error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /partner/cashbook/checks/post - Batch mark checks as posted
router.post('/checks/post', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      check_ids: z.array(z.string().uuid()).min(1),
    });
    const body = schema.parse(req.body);
    const now = new Date().toISOString();

    const { data: checks } = await supabaseAdmin
      .from('check_entries')
      .select('id, client_id')
      .in('id', body.check_ids);

    const clientIds = [...new Set((checks || []).map(c => c.client_id))];
    for (const clientId of clientIds) {
      if (!await verifyClientAccess(req.userId!, clientId)) {
        res.status(403).json({ success: false, error: 'No access to one or more clients' });
        return;
      }
    }

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
    console.error('Partner post checks error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /partner/cashbook/checks/unpost - Batch unmark checks
router.post('/checks/unpost', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      check_ids: z.array(z.string().uuid()).min(1),
    });
    const body = schema.parse(req.body);
    const now = new Date().toISOString();

    const { data: checks } = await supabaseAdmin
      .from('check_entries')
      .select('id, client_id')
      .in('id', body.check_ids);

    const clientIds = [...new Set((checks || []).map(c => c.client_id))];
    for (const clientId of clientIds) {
      if (!await verifyClientAccess(req.userId!, clientId)) {
        res.status(403).json({ success: false, error: 'No access to one or more clients' });
        return;
      }
    }

    const { error } = await supabaseAdmin
      .from('check_entries')
      .update({
        is_posted: false,
        posted_by: null,
        posted_at: null,
        server_updated_at: now,
      })
      .in('id', body.check_ids);

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to unpost checks' });
      return;
    }

    const auditRows = body.check_ids.map(id => ({
      entry_id: id,
      entry_table: 'check_entries' as const,
      changed_by: req.userId!,
      action: 'unpost' as const,
      changes: {},
    }));
    await supabaseAdmin.from('cash_book_entry_audit').insert(auditRows);

    res.json({ success: true, message: `${body.check_ids.length} checks unmarked` });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Partner unpost checks error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /partner/cashbook/expenses/post - Batch mark expenses as posted
router.post('/expenses/post', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      expense_ids: z.array(z.string().uuid()).min(1),
    });
    const body = schema.parse(req.body);
    const now = new Date().toISOString();

    const { data: expenses } = await supabaseAdmin
      .from('cashbook_expense_entries')
      .select('id, client_id')
      .in('id', body.expense_ids);

    const clientIds = [...new Set((expenses || []).map(e => e.client_id))];
    for (const clientId of clientIds) {
      if (!await verifyClientAccess(req.userId!, clientId)) {
        res.status(403).json({ success: false, error: 'No access to one or more clients' });
        return;
      }
    }

    const { error } = await supabaseAdmin
      .from('cashbook_expense_entries')
      .update({
        is_posted: true,
        posted_by: req.userId!,
        posted_at: now,
        server_updated_at: now,
      })
      .in('id', body.expense_ids);

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to mark expenses as posted' });
      return;
    }

    const auditRows = body.expense_ids.map(id => ({
      entry_id: id,
      entry_table: 'cashbook_expense_entries' as const,
      changed_by: req.userId!,
      action: 'post' as const,
      changes: {},
    }));
    await supabaseAdmin.from('cash_book_entry_audit').insert(auditRows);

    res.json({ success: true, message: `${body.expense_ids.length} expenses marked as posted` });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Partner post expenses error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /partner/cashbook/expenses/unpost - Batch unmark expenses
router.post('/expenses/unpost', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      expense_ids: z.array(z.string().uuid()).min(1),
    });
    const body = schema.parse(req.body);
    const now = new Date().toISOString();

    const { data: expenses } = await supabaseAdmin
      .from('cashbook_expense_entries')
      .select('id, client_id')
      .in('id', body.expense_ids);

    const clientIds = [...new Set((expenses || []).map(e => e.client_id))];
    for (const clientId of clientIds) {
      if (!await verifyClientAccess(req.userId!, clientId)) {
        res.status(403).json({ success: false, error: 'No access to one or more clients' });
        return;
      }
    }

    const { error } = await supabaseAdmin
      .from('cashbook_expense_entries')
      .update({
        is_posted: false,
        posted_by: null,
        posted_at: null,
        server_updated_at: now,
      })
      .in('id', body.expense_ids);

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to unpost expenses' });
      return;
    }

    const auditRows = body.expense_ids.map(id => ({
      entry_id: id,
      entry_table: 'cashbook_expense_entries' as const,
      changed_by: req.userId!,
      action: 'unpost' as const,
      changes: {},
    }));
    await supabaseAdmin.from('cash_book_entry_audit').insert(auditRows);

    res.json({ success: true, message: `${body.expense_ids.length} expenses unmarked` });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Partner unpost expenses error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /partner/cashbook/photo/sign?key=<objectKey>[&download=1]
// Returns a short-lived signed GET URL. Verifies the partner has access to
// the client whose clientId is embedded in the key prefix. When download=1,
// the URL carries a Content-Disposition header so the browser downloads the
// file instead of rendering it inline.
router.get('/photo/sign', async (req: Request, res: Response) => {
  try {
    const key = typeof req.query.key === 'string' ? req.query.key : '';
    const match = key.match(/^cashbook\/([^/]+)\/[^/]+\/(.+)$/);
    if (!match) {
      res.status(400).json({ success: false, error: 'Invalid key' });
      return;
    }
    const clientId = match[1];
    const filename = match[2];
    if (!await verifyClientAccess(req.userId!, clientId)) {
      res.status(403).json({ success: false, error: 'No access to this client' });
      return;
    }
    const download = req.query.download === '1' || req.query.download === 'true';
    const url = await generateR2DownloadUrl(key, 3600, download ? filename : undefined);
    res.json({ success: true, data: { url, expiresIn: 3600 } });
  } catch (err) {
    console.error('Partner photo sign error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
