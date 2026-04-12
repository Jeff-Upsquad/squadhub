import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireCashBookAccess, requireCashBookAdmin } from '../middleware/cashbook';
import { supabaseAdmin } from '../supabase';
import { generateCashBookUploadUrl } from '../r2';

const router = Router();

// All routes require auth + cash book access
router.use(requireAuth, requireCashBookAccess);

// ---- Profile ----

// GET /cashbook/profile
router.get('/profile', async (req: Request, res: Response) => {
  try {
    const { data: cbUser } = await supabaseAdmin
      .from('cash_book_users')
      .select('id, role, client_id, is_active, created_at')
      .eq('user_id', req.userId!)
      .eq('is_active', true)
      .single();

    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('id, business_name, contact_person')
      .eq('id', req.cashBookClientId!)
      .single();

    res.json({ success: true, data: { ...cbUser, client } });
  } catch (err) {
    console.error('Cash book profile error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- Dashboard ----

// GET /cashbook/dashboard?date=2026-04-12
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];

    // Get cached opening balance from previous day
    const { data: prevBalance } = await supabaseAdmin
      .from('cash_book_daily_balances')
      .select('closing_balance')
      .eq('client_id', req.cashBookClientId!)
      .lt('balance_date', date)
      .order('balance_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    const openingBalance = prevBalance?.closing_balance ?? 0;

    // Compute today's live totals
    let entryQuery = supabaseAdmin
      .from('cash_book_entries')
      .select('entry_type, amount')
      .eq('client_id', req.cashBookClientId!)
      .eq('entry_date', date)
      .eq('is_deleted', false);

    // Staff sees only own entries
    if (req.cashBookRole === 'staff') {
      entryQuery = entryQuery.eq('user_id', req.userId!);
    }

    const { data: entries } = await entryQuery;

    let totalCashIn = 0;
    let totalCashOut = 0;
    let entryCount = 0;

    if (entries) {
      for (const entry of entries) {
        entryCount++;
        if (entry.entry_type === 'cash_in') {
          totalCashIn += Number(entry.amount);
        } else {
          totalCashOut += Number(entry.amount);
        }
      }
    }

    const closingBalance = Number(openingBalance) + totalCashIn - totalCashOut;

    res.json({
      success: true,
      data: {
        date,
        opening_balance: Number(openingBalance),
        total_cash_in: totalCashIn,
        total_cash_out: totalCashOut,
        closing_balance: closingBalance,
        entry_count: entryCount,
      },
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- Entries CRUD ----

const createEntrySchema = z.object({
  local_id: z.string().optional(),
  entry_type: z.enum(['cash_in', 'cash_out']),
  amount: z.number().positive(),
  entry_date: z.string(),
  description: z.string().max(500).optional(),
  category_id: z.string().uuid().optional(),
  party_name: z.string().max(200).optional(),
  payment_mode: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'other']).default('cash'),
  photo_url: z.string().optional(),
  photo_key: z.string().optional(),
});

// GET /cashbook/entries?date_from=&date_to=&type=&page=&limit=
router.get('/entries', async (req: Request, res: Response) => {
  try {
    const { date_from, date_to, type, page = '1', limit = '50' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabaseAdmin
      .from('cash_book_entries')
      .select('*, user:users!cash_book_entries_user_id_fkey(id, display_name), category:cash_book_categories(id, name, type)', { count: 'exact' })
      .eq('client_id', req.cashBookClientId!)
      .eq('is_deleted', false)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (req.cashBookRole === 'staff') {
      query = query.eq('user_id', req.userId!);
    }
    if (date_from) query = query.gte('entry_date', date_from as string);
    if (date_to) query = query.lte('entry_date', date_to as string);
    if (type) query = query.eq('entry_type', type as string);

    const { data, count, error } = await query;

    if (error) {
      console.error('Entries fetch error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch entries' });
      return;
    }

    res.json({ success: true, data, total: count });
  } catch (err) {
    console.error('Entries error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /cashbook/entries
router.post('/entries', async (req: Request, res: Response) => {
  try {
    const body = createEntrySchema.parse(req.body);

    // Dedup by local_id
    if (body.local_id) {
      const { data: existing } = await supabaseAdmin
        .from('cash_book_entries')
        .select('id')
        .eq('local_id', body.local_id)
        .maybeSingle();

      if (existing) {
        res.json({ success: true, data: existing, deduplicated: true });
        return;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('cash_book_entries')
      .insert({
        ...body,
        client_id: req.cashBookClientId!,
        user_id: req.userId!,
        server_updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Entry create error:', error);
      res.status(500).json({ success: false, error: 'Failed to create entry' });
      return;
    }

    // Audit
    await supabaseAdmin.from('cash_book_entry_audit').insert({
      entry_id: data.id,
      entry_table: 'cash_book_entries',
      changed_by: req.userId!,
      action: 'create',
      changes: { entry: { old: null, new: data } },
    });

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Entry create error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /cashbook/entries/:id
router.put('/entries/:id', async (req: Request, res: Response) => {
  try {
    const updateSchema = createEntrySchema.partial().extend({
      version: z.number().int().positive(),
    });
    const body = updateSchema.parse(req.body);

    // Fetch current entry
    const { data: current } = await supabaseAdmin
      .from('cash_book_entries')
      .select('*')
      .eq('id', req.params.id)
      .eq('client_id', req.cashBookClientId!)
      .single();

    if (!current) {
      res.status(404).json({ success: false, error: 'Entry not found' });
      return;
    }

    if (current.is_posted) {
      res.status(403).json({ success: false, error: 'Cannot edit a posted entry' });
      return;
    }

    // Staff can only edit own entries
    if (req.cashBookRole === 'staff' && current.user_id !== req.userId) {
      res.status(403).json({ success: false, error: 'Not allowed to edit this entry' });
      return;
    }

    // Version check (server-wins)
    if (current.version > body.version) {
      res.status(409).json({ success: false, error: 'Conflict', server_version: current });
      return;
    }

    const { version, ...updateFields } = body;
    const { data, error } = await supabaseAdmin
      .from('cash_book_entries')
      .update({
        ...updateFields,
        version: current.version + 1,
        server_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      console.error('Entry update error:', error);
      res.status(500).json({ success: false, error: 'Failed to update entry' });
      return;
    }

    // Audit
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const key of Object.keys(updateFields)) {
      if (current[key] !== (updateFields as Record<string, unknown>)[key]) {
        changes[key] = { old: current[key], new: (updateFields as Record<string, unknown>)[key] };
      }
    }
    await supabaseAdmin.from('cash_book_entry_audit').insert({
      entry_id: data.id,
      entry_table: 'cash_book_entries',
      changed_by: req.userId!,
      action: 'update',
      changes,
    });

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Entry update error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /cashbook/entries/:id
router.delete('/entries/:id', async (req: Request, res: Response) => {
  try {
    const { data: current } = await supabaseAdmin
      .from('cash_book_entries')
      .select('id, user_id, is_posted, is_deleted')
      .eq('id', req.params.id)
      .eq('client_id', req.cashBookClientId!)
      .single();

    if (!current) {
      res.status(404).json({ success: false, error: 'Entry not found' });
      return;
    }

    if (current.is_posted) {
      res.status(403).json({ success: false, error: 'Cannot delete a posted entry' });
      return;
    }

    if (req.cashBookRole === 'staff' && current.user_id !== req.userId) {
      res.status(403).json({ success: false, error: 'Not allowed to delete this entry' });
      return;
    }

    await supabaseAdmin
      .from('cash_book_entries')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: req.userId!,
        server_updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id);

    await supabaseAdmin.from('cash_book_entry_audit').insert({
      entry_id: current.id,
      entry_table: 'cash_book_entries',
      changed_by: req.userId!,
      action: 'delete',
      changes: {},
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Entry delete error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- Check Entries CRUD ----

const createCheckSchema = z.object({
  local_id: z.string().optional(),
  check_type: z.enum(['collection', 'deposit']),
  check_number: z.string().min(1).max(50),
  bank_name: z.string().min(1).max(200),
  amount: z.number().positive(),
  check_date: z.string(),
  party_name: z.string().min(1).max(200),
  status: z.enum(['received', 'deposited', 'cleared', 'bounced']).default('received'),
  deposit_date: z.string().optional(),
  clearance_date: z.string().optional(),
  bounce_reason: z.string().max(500).optional(),
  description: z.string().max(500).optional(),
  photo_url: z.string().optional(),
  photo_key: z.string().optional(),
});

// GET /cashbook/checks?date_from=&date_to=&check_type=&status=&page=&limit=
router.get('/checks', async (req: Request, res: Response) => {
  try {
    const { date_from, date_to, check_type, status, page = '1', limit = '50' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabaseAdmin
      .from('check_entries')
      .select('*, user:users!check_entries_user_id_fkey(id, display_name)', { count: 'exact' })
      .eq('client_id', req.cashBookClientId!)
      .eq('is_deleted', false)
      .order('check_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (req.cashBookRole === 'staff') {
      query = query.eq('user_id', req.userId!);
    }
    if (date_from) query = query.gte('check_date', date_from as string);
    if (date_to) query = query.lte('check_date', date_to as string);
    if (check_type) query = query.eq('check_type', check_type as string);
    if (status) query = query.eq('status', status as string);

    const { data, count, error } = await query;

    if (error) {
      console.error('Checks fetch error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch checks' });
      return;
    }

    res.json({ success: true, data, total: count });
  } catch (err) {
    console.error('Checks error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /cashbook/checks
router.post('/checks', async (req: Request, res: Response) => {
  try {
    const body = createCheckSchema.parse(req.body);

    // Dedup by local_id
    if (body.local_id) {
      const { data: existing } = await supabaseAdmin
        .from('check_entries')
        .select('id')
        .eq('local_id', body.local_id)
        .maybeSingle();

      if (existing) {
        res.json({ success: true, data: existing, deduplicated: true });
        return;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('check_entries')
      .insert({
        ...body,
        client_id: req.cashBookClientId!,
        user_id: req.userId!,
        server_updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Check create error:', error);
      res.status(500).json({ success: false, error: 'Failed to create check entry' });
      return;
    }

    await supabaseAdmin.from('cash_book_entry_audit').insert({
      entry_id: data.id,
      entry_table: 'check_entries',
      changed_by: req.userId!,
      action: 'create',
      changes: { entry: { old: null, new: data } },
    });

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Check create error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /cashbook/checks/:id
router.put('/checks/:id', async (req: Request, res: Response) => {
  try {
    const updateSchema = createCheckSchema.partial().extend({
      version: z.number().int().positive(),
    });
    const body = updateSchema.parse(req.body);

    const { data: current } = await supabaseAdmin
      .from('check_entries')
      .select('*')
      .eq('id', req.params.id)
      .eq('client_id', req.cashBookClientId!)
      .single();

    if (!current) {
      res.status(404).json({ success: false, error: 'Check entry not found' });
      return;
    }

    if (current.is_posted) {
      res.status(403).json({ success: false, error: 'Cannot edit a posted check entry' });
      return;
    }

    if (req.cashBookRole === 'staff' && current.user_id !== req.userId) {
      res.status(403).json({ success: false, error: 'Not allowed to edit this check entry' });
      return;
    }

    if (current.version > body.version) {
      res.status(409).json({ success: false, error: 'Conflict', server_version: current });
      return;
    }

    const { version, ...updateFields } = body;
    const { data, error } = await supabaseAdmin
      .from('check_entries')
      .update({
        ...updateFields,
        version: current.version + 1,
        server_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      console.error('Check update error:', error);
      res.status(500).json({ success: false, error: 'Failed to update check entry' });
      return;
    }

    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const key of Object.keys(updateFields)) {
      if (current[key] !== (updateFields as Record<string, unknown>)[key]) {
        changes[key] = { old: current[key], new: (updateFields as Record<string, unknown>)[key] };
      }
    }
    await supabaseAdmin.from('cash_book_entry_audit').insert({
      entry_id: data.id,
      entry_table: 'check_entries',
      changed_by: req.userId!,
      action: 'update',
      changes,
    });

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Check update error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /cashbook/checks/:id
router.delete('/checks/:id', async (req: Request, res: Response) => {
  try {
    const { data: current } = await supabaseAdmin
      .from('check_entries')
      .select('id, user_id, is_posted')
      .eq('id', req.params.id)
      .eq('client_id', req.cashBookClientId!)
      .single();

    if (!current) {
      res.status(404).json({ success: false, error: 'Check entry not found' });
      return;
    }

    if (current.is_posted) {
      res.status(403).json({ success: false, error: 'Cannot delete a posted check entry' });
      return;
    }

    if (req.cashBookRole === 'staff' && current.user_id !== req.userId) {
      res.status(403).json({ success: false, error: 'Not allowed to delete this check entry' });
      return;
    }

    await supabaseAdmin
      .from('check_entries')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: req.userId!,
        server_updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id);

    await supabaseAdmin.from('cash_book_entry_audit').insert({
      entry_id: current.id,
      entry_table: 'check_entries',
      changed_by: req.userId!,
      action: 'delete',
      changes: {},
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Check delete error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- Categories ----

// GET /cashbook/categories
router.get('/categories', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('cash_book_categories')
      .select('*')
      .eq('client_id', req.cashBookClientId!)
      .eq('is_active', true)
      .order('position', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch categories' });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Categories error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const categorySchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['cash_in', 'cash_out', 'both']),
  position: z.number().int().min(0).optional(),
});

// POST /cashbook/categories (client_admin only)
router.post('/categories', requireCashBookAdmin, async (req: Request, res: Response) => {
  try {
    const body = categorySchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('cash_book_categories')
      .insert({ ...body, client_id: req.cashBookClientId! })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'Category with this name already exists' });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to create category' });
      return;
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Category create error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /cashbook/categories/:id (client_admin only)
router.put('/categories/:id', requireCashBookAdmin, async (req: Request, res: Response) => {
  try {
    const body = categorySchema.partial().extend({
      is_active: z.boolean().optional(),
    }).parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('cash_book_categories')
      .update(body)
      .eq('id', req.params.id)
      .eq('client_id', req.cashBookClientId!)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to update category' });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Category update error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- Balances ----

// GET /cashbook/balances?date_from=&date_to=
router.get('/balances', async (req: Request, res: Response) => {
  try {
    const { date_from, date_to } = req.query;

    let query = supabaseAdmin
      .from('cash_book_daily_balances')
      .select('*')
      .eq('client_id', req.cashBookClientId!)
      .order('balance_date', { ascending: false });

    if (date_from) query = query.gte('balance_date', date_from as string);
    if (date_to) query = query.lte('balance_date', date_to as string);

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch balances' });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Balances error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- Offline Sync ----

// POST /cashbook/sync
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const syncSchema = z.object({
      last_synced_at: z.string().nullable(),
      push: z.object({
        entries: z.object({
          created: z.array(z.any()).default([]),
          updated: z.array(z.any()).default([]),
          deleted: z.array(z.object({ server_id: z.string(), version: z.number() })).default([]),
        }).default({ created: [], updated: [], deleted: [] }),
        checks: z.object({
          created: z.array(z.any()).default([]),
          updated: z.array(z.any()).default([]),
          deleted: z.array(z.object({ server_id: z.string(), version: z.number() })).default([]),
        }).default({ created: [], updated: [], deleted: [] }),
      }).default({ entries: { created: [], updated: [], deleted: [] }, checks: { created: [], updated: [], deleted: [] } }),
    });

    const body = syncSchema.parse(req.body);
    const now = new Date().toISOString();
    const clientId = req.cashBookClientId!;
    const userId = req.userId!;

    const entryResults: { created: any[]; updated: any[]; deleted: any[] } = { created: [], updated: [], deleted: [] };
    const checkResults: { created: any[]; updated: any[]; deleted: any[] } = { created: [], updated: [], deleted: [] };

    // --- Process entry pushes ---
    for (const entry of body.push.entries.created) {
      try {
        // Dedup
        if (entry.local_id) {
          const { data: existing } = await supabaseAdmin
            .from('cash_book_entries')
            .select('id')
            .eq('local_id', entry.local_id)
            .maybeSingle();

          if (existing) {
            entryResults.created.push({ local_id: entry.local_id, server_id: existing.id, status: 'ok' });
            continue;
          }
        }

        const { data, error } = await supabaseAdmin
          .from('cash_book_entries')
          .insert({
            client_id: clientId,
            user_id: userId,
            local_id: entry.local_id,
            entry_type: entry.entry_type,
            amount: entry.amount,
            entry_date: entry.entry_date,
            description: entry.description,
            category_id: entry.category_id,
            party_name: entry.party_name,
            payment_mode: entry.payment_mode || 'cash',
            photo_url: entry.photo_url,
            photo_key: entry.photo_key,
            server_updated_at: now,
          })
          .select('id')
          .single();

        if (error) {
          entryResults.created.push({ local_id: entry.local_id, server_id: '', status: 'error', error: error.message });
        } else {
          entryResults.created.push({ local_id: entry.local_id, server_id: data.id, status: 'ok' });
        }
      } catch {
        entryResults.created.push({ local_id: entry.local_id, server_id: '', status: 'error', error: 'Unexpected error' });
      }
    }

    for (const entry of body.push.entries.updated) {
      try {
        const { data: current } = await supabaseAdmin
          .from('cash_book_entries')
          .select('version, is_posted')
          .eq('id', entry.server_id)
          .eq('client_id', clientId)
          .single();

        if (!current || current.is_posted) {
          entryResults.updated.push({ server_id: entry.server_id, status: 'conflict', server_version: current });
          continue;
        }

        if (current.version > entry.version) {
          const { data: full } = await supabaseAdmin
            .from('cash_book_entries')
            .select('*')
            .eq('id', entry.server_id)
            .single();
          entryResults.updated.push({ server_id: entry.server_id, status: 'conflict', server_version: full });
          continue;
        }

        const { server_id, version, local_id, ...updateFields } = entry;
        await supabaseAdmin
          .from('cash_book_entries')
          .update({ ...updateFields, version: current.version + 1, server_updated_at: now, updated_at: now })
          .eq('id', server_id);

        entryResults.updated.push({ server_id, status: 'ok' });
      } catch {
        entryResults.updated.push({ server_id: entry.server_id, status: 'conflict' });
      }
    }

    for (const entry of body.push.entries.deleted) {
      try {
        const { data: current } = await supabaseAdmin
          .from('cash_book_entries')
          .select('version, is_posted')
          .eq('id', entry.server_id)
          .eq('client_id', clientId)
          .single();

        if (!current || current.is_posted) {
          entryResults.deleted.push({ server_id: entry.server_id, status: 'error' });
          continue;
        }

        await supabaseAdmin
          .from('cash_book_entries')
          .update({ is_deleted: true, deleted_at: now, deleted_by: userId, server_updated_at: now })
          .eq('id', entry.server_id);

        entryResults.deleted.push({ server_id: entry.server_id, status: 'ok' });
      } catch {
        entryResults.deleted.push({ server_id: entry.server_id, status: 'error' });
      }
    }

    // --- Process check pushes (same pattern) ---
    for (const check of body.push.checks.created) {
      try {
        if (check.local_id) {
          const { data: existing } = await supabaseAdmin
            .from('check_entries')
            .select('id')
            .eq('local_id', check.local_id)
            .maybeSingle();

          if (existing) {
            checkResults.created.push({ local_id: check.local_id, server_id: existing.id, status: 'ok' });
            continue;
          }
        }

        const { data, error } = await supabaseAdmin
          .from('check_entries')
          .insert({
            client_id: clientId,
            user_id: userId,
            local_id: check.local_id,
            check_type: check.check_type,
            check_number: check.check_number,
            bank_name: check.bank_name,
            amount: check.amount,
            check_date: check.check_date,
            party_name: check.party_name,
            status: check.status || 'received',
            deposit_date: check.deposit_date,
            clearance_date: check.clearance_date,
            bounce_reason: check.bounce_reason,
            description: check.description,
            photo_url: check.photo_url,
            photo_key: check.photo_key,
            server_updated_at: now,
          })
          .select('id')
          .single();

        if (error) {
          checkResults.created.push({ local_id: check.local_id, server_id: '', status: 'error', error: error.message });
        } else {
          checkResults.created.push({ local_id: check.local_id, server_id: data.id, status: 'ok' });
        }
      } catch {
        checkResults.created.push({ local_id: check.local_id, server_id: '', status: 'error', error: 'Unexpected error' });
      }
    }

    for (const check of body.push.checks.updated) {
      try {
        const { data: current } = await supabaseAdmin
          .from('check_entries')
          .select('version, is_posted')
          .eq('id', check.server_id)
          .eq('client_id', clientId)
          .single();

        if (!current || current.is_posted) {
          checkResults.updated.push({ server_id: check.server_id, status: 'conflict', server_version: current });
          continue;
        }

        if (current.version > check.version) {
          const { data: full } = await supabaseAdmin
            .from('check_entries')
            .select('*')
            .eq('id', check.server_id)
            .single();
          checkResults.updated.push({ server_id: check.server_id, status: 'conflict', server_version: full });
          continue;
        }

        const { server_id, version, local_id, ...updateFields } = check;
        await supabaseAdmin
          .from('check_entries')
          .update({ ...updateFields, version: current.version + 1, server_updated_at: now, updated_at: now })
          .eq('id', server_id);

        checkResults.updated.push({ server_id, status: 'ok' });
      } catch {
        checkResults.updated.push({ server_id: check.server_id, status: 'conflict' });
      }
    }

    for (const check of body.push.checks.deleted) {
      try {
        const { data: current } = await supabaseAdmin
          .from('check_entries')
          .select('version, is_posted')
          .eq('id', check.server_id)
          .eq('client_id', clientId)
          .single();

        if (!current || current.is_posted) {
          checkResults.deleted.push({ server_id: check.server_id, status: 'error' });
          continue;
        }

        await supabaseAdmin
          .from('check_entries')
          .update({ is_deleted: true, deleted_at: now, deleted_by: userId, server_updated_at: now })
          .eq('id', check.server_id);

        checkResults.deleted.push({ server_id: check.server_id, status: 'ok' });
      } catch {
        checkResults.deleted.push({ server_id: check.server_id, status: 'error' });
      }
    }

    // --- Pull changes since last sync ---
    const lastSyncedAt = body.last_synced_at || '1970-01-01T00:00:00Z';

    let entriesQuery = supabaseAdmin
      .from('cash_book_entries')
      .select('*')
      .eq('client_id', clientId)
      .gt('server_updated_at', lastSyncedAt);

    let checksQuery = supabaseAdmin
      .from('check_entries')
      .select('*')
      .eq('client_id', clientId)
      .gt('server_updated_at', lastSyncedAt);

    // Staff only sees own entries
    if (req.cashBookRole === 'staff') {
      entriesQuery = entriesQuery.eq('user_id', userId);
      checksQuery = checksQuery.eq('user_id', userId);
    }

    const [entriesRes, checksRes, categoriesRes] = await Promise.all([
      entriesQuery,
      checksQuery,
      supabaseAdmin.from('cash_book_categories').select('*').eq('client_id', clientId).eq('is_active', true),
    ]);

    const pulledEntries = entriesRes.data || [];
    const pulledChecks = checksRes.data || [];

    // Recompute daily balances for dates affected by pushed entries (fire-and-forget)
    const affectedDates = new Set<string>();
    for (const e of body.push.entries.created) { if (e.entry_date) affectedDates.add(e.entry_date); }
    for (const e of body.push.entries.updated) { if (e.entry_date) affectedDates.add(e.entry_date); }
    if (affectedDates.size > 0) {
      const sortedDates = [...affectedDates].sort();
      Promise.all(sortedDates.map(d => recomputeDailyBalance(clientId, d))).catch(() => {});
    }

    res.json({
      success: true,
      data: {
        synced_at: now,
        pull: {
          entries: {
            created_or_updated: pulledEntries.filter(e => !e.is_deleted),
            deleted_ids: pulledEntries.filter(e => e.is_deleted).map(e => e.id),
          },
          checks: {
            created_or_updated: pulledChecks.filter(c => !c.is_deleted),
            deleted_ids: pulledChecks.filter(c => c.is_deleted).map(c => c.id),
          },
          categories: categoriesRes.data || [],
        },
        push_results: {
          entries: entryResults,
          checks: checkResults,
        },
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Sync error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- Photo Upload ----

const presignSchema = z.object({
  filename: z.string().min(1).max(255),
  content_type: z.string().regex(/^image\/(jpeg|png|heic|heif|webp)$/),
  entry_type: z.enum(['cash_entry', 'check_entry']),
});

// POST /cashbook/upload/presign
router.post('/upload/presign', async (req: Request, res: Response) => {
  try {
    const body = presignSchema.parse(req.body);

    const result = await generateCashBookUploadUrl(
      req.cashBookClientId!,
      body.entry_type,
      body.filename,
      body.content_type,
    );

    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Presign error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- Staff Management (client_admin only) ----

// GET /cashbook/staff
router.get('/staff', requireCashBookAdmin, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('cash_book_users')
      .select('*, user:users!cash_book_users_user_id_fkey(id, display_name, email)')
      .eq('client_id', req.cashBookClientId!)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Staff fetch error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch staff' });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Staff error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /cashbook/staff/invite
router.post('/staff/invite', requireCashBookAdmin, async (req: Request, res: Response) => {
  try {
    const inviteSchema = z.object({
      email: z.string().email(),
    });
    const body = inviteSchema.parse(req.body);

    // Check if user already has cash book access for this client
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', body.email)
      .maybeSingle();

    if (existingUser) {
      const { data: existingCb } = await supabaseAdmin
        .from('cash_book_users')
        .select('id')
        .eq('user_id', existingUser.id)
        .eq('client_id', req.cashBookClientId!)
        .maybeSingle();

      if (existingCb) {
        res.status(409).json({ success: false, error: 'This user already has cash book access' });
        return;
      }
    }

    // Check for existing pending invitation
    const { data: existingInvite } = await supabaseAdmin
      .from('invitations')
      .select('id')
      .eq('email', body.email)
      .eq('status', 'pending')
      .maybeSingle();

    if (existingInvite) {
      res.status(409).json({ success: false, error: 'An invitation is already pending for this email' });
      return;
    }

    // Create invitation
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const { data: invitation, error } = await supabaseAdmin
      .from('invitations')
      .insert({
        email: body.email,
        invited_by: req.userId!,
        user_type: 'client',
        client_id: req.cashBookClientId!,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Invitation create error:', error);
      res.status(500).json({ success: false, error: 'Failed to create invitation' });
      return;
    }

    // If user already exists and is approved, directly add to cash_book_users
    if (existingUser) {
      const { data: userProfile } = await supabaseAdmin
        .from('users')
        .select('status')
        .eq('id', existingUser.id)
        .single();

      if (userProfile?.status === 'approved') {
        await supabaseAdmin.from('cash_book_users').insert({
          user_id: existingUser.id,
          client_id: req.cashBookClientId!,
          role: 'staff',
          invited_by: req.userId!,
        });

        await supabaseAdmin
          .from('invitations')
          .update({ status: 'accepted', accepted_at: new Date().toISOString() })
          .eq('id', invitation.id);

        res.status(201).json({ success: true, data: invitation, message: 'User added to cash book directly' });
        return;
      }
    }

    res.status(201).json({ success: true, data: invitation, message: 'Invitation sent' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Staff invite error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /cashbook/staff/:id (activate/deactivate)
router.put('/staff/:id', requireCashBookAdmin, async (req: Request, res: Response) => {
  try {
    const updateSchema = z.object({
      is_active: z.boolean(),
    });
    const body = updateSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('cash_book_users')
      .update({ is_active: body.is_active, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('client_id', req.cashBookClientId!)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to update staff' });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Staff update error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- Daily Balance Recomputation ----

async function recomputeDailyBalance(clientId: string, date: string): Promise<void> {
  try {
    // Get previous day's closing balance as the opening balance
    const { data: prevBalance } = await supabaseAdmin
      .from('cash_book_daily_balances')
      .select('closing_balance')
      .eq('client_id', clientId)
      .lt('balance_date', date)
      .order('balance_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    const openingBalance = Number(prevBalance?.closing_balance ?? 0);

    // Sum all non-deleted entries for the given date
    const { data: entries } = await supabaseAdmin
      .from('cash_book_entries')
      .select('entry_type, amount')
      .eq('client_id', clientId)
      .eq('entry_date', date)
      .eq('is_deleted', false);

    let totalCashIn = 0;
    let totalCashOut = 0;

    if (entries) {
      for (const entry of entries) {
        if (entry.entry_type === 'cash_in') {
          totalCashIn += Number(entry.amount);
        } else {
          totalCashOut += Number(entry.amount);
        }
      }
    }

    const closingBalance = openingBalance + totalCashIn - totalCashOut;

    // Upsert the daily balance record
    await supabaseAdmin
      .from('cash_book_daily_balances')
      .upsert(
        {
          client_id: clientId,
          balance_date: date,
          opening_balance: openingBalance,
          total_cash_in: totalCashIn,
          total_cash_out: totalCashOut,
          closing_balance: closingBalance,
        },
        { onConflict: 'client_id,balance_date' },
      );
  } catch (err) {
    console.error('recomputeDailyBalance error:', err);
  }
}

// POST /cashbook/balances/recompute — trigger recompute for a date range
router.post('/balances/recompute', requireCashBookAdmin, async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    });
    const { date_from, date_to } = schema.parse(req.body);
    const clientId = req.cashBookClientId!;

    // Generate all dates in range
    const dates: string[] = [];
    const current = new Date(date_from);
    const end = new Date(date_to);
    while (current <= end) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }

    // Recompute sequentially (each day depends on previous day's closing)
    for (const date of dates) {
      await recomputeDailyBalance(clientId, date);
    }

    res.json({ success: true, data: { dates_processed: dates.length } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Balance recompute error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export { recomputeDailyBalance };
export default router;
