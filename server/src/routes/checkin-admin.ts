import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { todayIST, formatTimeIST } from '../utils/ist';
import { getEligibleUsers, getWorkingCalendar, resolveDeadlineTimes } from '../utils/checkin';

const router = Router();

// All admin check-in routes require auth + admin
router.use(requireAuth);
router.use(requireAdmin);

// ============================================================
// Holiday Management
// ============================================================

// GET /admin/checkin/holidays — list all holidays
router.get('/holidays', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('holidays')
      .select('*')
      .order('date', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Get holidays error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/checkin/holidays — add a holiday
const createHolidaySchema = z.object({
  name: z.string().min(1).max(100),
  date: z.string().optional(),
  is_recurring: z.boolean().default(false),
  recurring_month: z.number().min(1).max(12).optional(),
  recurring_day: z.number().min(1).max(31).optional(),
});

router.post('/holidays', async (req: Request, res: Response) => {
  try {
    const body = createHolidaySchema.parse(req.body);

    if (body.is_recurring) {
      if (!body.recurring_month || !body.recurring_day) {
        res.status(400).json({ success: false, error: 'Recurring holidays require month and day' });
        return;
      }
    } else {
      if (!body.date) {
        res.status(400).json({ success: false, error: 'Non-recurring holidays require a date' });
        return;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('holidays')
      .insert({
        name: body.name,
        date: body.is_recurring ? null : body.date,
        is_recurring: body.is_recurring,
        recurring_month: body.is_recurring ? body.recurring_month : null,
        recurring_day: body.is_recurring ? body.recurring_day : null,
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
    console.error('Create holiday error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/checkin/holidays/:id — update a holiday
router.put('/holidays/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const body = createHolidaySchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('holidays')
      .update({
        name: body.name,
        date: body.is_recurring ? null : body.date,
        is_recurring: body.is_recurring,
        recurring_month: body.is_recurring ? body.recurring_month : null,
        recurring_day: body.is_recurring ? body.recurring_day : null,
      })
      .eq('id', id)
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
    console.error('Update holiday error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/checkin/holidays/:id — delete a holiday
router.delete('/holidays/:id', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('holidays')
      .delete()
      .eq('id', req.params.id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Holiday deleted' });
  } catch (err) {
    console.error('Delete holiday error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Working Days Configuration
// ============================================================

// GET /admin/checkin/working-days — get working days config
router.get('/working-days', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('working_days_config')
      .select('*')
      .limit(1)
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Get working days error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/checkin/working-days — update working days config
const workingDaysSchema = z.object({
  working_days: z.array(z.number().min(0).max(6)),
});

router.put('/working-days', async (req: Request, res: Response) => {
  try {
    const body = workingDaysSchema.parse(req.body);

    // Get the existing config ID
    const { data: existing } = await supabaseAdmin
      .from('working_days_config')
      .select('id')
      .limit(1)
      .single();

    if (!existing) {
      res.status(404).json({ success: false, error: 'Working days config not found' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('working_days_config')
      .update({ working_days: body.working_days, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
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
    console.error('Update working days error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Check-In Configuration (per role)
// ============================================================

// GET /admin/checkin/configs — list all check-in configs
router.get('/configs', async (_req: Request, res: Response) => {
  try {
    const { data: roles } = await supabaseAdmin
      .from('roles')
      .select('id, name, color')
      .order('name');

    const { data: configs } = await supabaseAdmin
      .from('checkin_configs')
      .select('*');

    const configMap = new Map((configs || []).map((c: any) => [c.role_id, c]));

    const result = (roles || []).map((role: any) => ({
      role,
      config: configMap.get(role.id) || { role_id: role.id, items: [] },
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Get checkin configs error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/checkin/configs/:roleId — update checklist items for a role
const updateConfigSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    label: z.string().min(1),
    description: z.string().default(''),
    isRequired: z.boolean().default(false),
    order: z.number(),
  })),
});

router.put('/configs/:roleId', async (req: Request, res: Response) => {
  try {
    const roleId = req.params.roleId;
    const body = updateConfigSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('checkin_configs')
      .upsert({
        role_id: roleId,
        items: body.items,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'role_id' })
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
    console.error('Update checkin config error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// User Check-In Settings (deadline per user)
// ============================================================

// GET /admin/checkin/user-settings — list all user settings
router.get('/user-settings', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_checkin_settings')
      .select('*, users(id, display_name, email)')
      .order('created_at');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Get user settings error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/checkin/user-settings/:userId — set deadline for a user
const userSettingsSchema = z.object({
  deadline_time: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format'),
});

router.put('/user-settings/:userId', async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;
    const body = userSettingsSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('user_checkin_settings')
      .upsert({
        user_id: userId,
        deadline_time: body.deadline_time,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
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
    console.error('Update user settings error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Check-In History (admin view)
// ============================================================

// GET /admin/checkin/history — view all check-in records with filters
router.get('/history', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;
    const userId = req.query.user_id as string;
    const roleId = req.query.role_id as string;
    const status = req.query.status as string;
    const startDate = req.query.start_date as string;
    const endDate = req.query.end_date as string;

    let query = supabaseAdmin
      .from('checkins')
      .select('*, users(id, display_name, email, avatar_url)', { count: 'exact' })
      .order('date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (userId) query = query.eq('user_id', userId);
    if (roleId) query = query.eq('role_id', roleId);
    if (status) query = query.eq('status', status);
    if (startDate) query = query.gte('date', startDate);
    if (endDate) query = query.lte('date', endDate);

    const { data, error, count } = await query;

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data, total: count || 0, page, limit });
  } catch (err) {
    console.error('Check-in history error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Check-In Overview (admin dashboard)
// ============================================================

// GET /admin/checkin/overview?days=N — today's status + N-day trend + per-user leaderboard
router.get('/overview', async (req: Request, res: Response) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 30));
    const today = todayIST();
    const startDateObj = new Date(today + 'T00:00:00Z');
    startDateObj.setUTCDate(startDateObj.getUTCDate() - days + 1);
    const startDate = startDateObj.toISOString().split('T')[0];

    const calendar = await getWorkingCalendar(startDate, today);
    const workingDateSet = new Set(calendar.workingDates);
    const todayHoliday = calendar.holidayByDate.get(today) ?? null;
    const todayIsWorking = workingDateSet.has(today);

    const eligible = await getEligibleUsers();
    const eligibleIds = eligible.map((u) => u.id);

    // Role lookup (first workspace_member match wins, mirroring resolveDeadline behavior)
    const { data: members } = await supabaseAdmin
      .from('workspace_members')
      .select('user_id, roles(name)')
      .in('user_id', eligibleIds.length > 0 ? eligibleIds : ['00000000-0000-0000-0000-000000000000']);
    const roleMap = new Map<string, string | null>();
    for (const m of (members || []) as any[]) {
      if (!roleMap.has(m.user_id)) roleMap.set(m.user_id, m.roles?.name ?? null);
    }

    const deadlines = await resolveDeadlineTimes(eligibleIds);

    // Today's checkins
    const { data: todayCheckins } = await supabaseAdmin
      .from('checkins')
      .select('user_id, status, submitted_at')
      .eq('date', today);
    const todayMap = new Map<string, { status: string; submitted_at: string | null }>();
    for (const c of (todayCheckins || []) as any[]) {
      todayMap.set(c.user_id, { status: c.status, submitted_at: c.submitted_at ?? null });
    }

    const currentTimeIST = formatTimeIST(new Date());
    let onTime = 0;
    let late = 0;
    let pending = 0;
    let missed = 0;
    const todayList: any[] = [];

    if (todayIsWorking) {
      for (const u of eligible) {
        const c = todayMap.get(u.id);
        const deadline = deadlines.get(u.id) || '10:00';
        let status: 'on_time' | 'late' | 'pending' | 'no_checkin';
        let submitted_at: string | null = null;

        if (c) {
          status = c.status as any;
          submitted_at = c.submitted_at;
        } else {
          status = currentTimeIST <= deadline ? 'pending' : 'no_checkin';
        }

        if (status === 'on_time') onTime++;
        else if (status === 'late') late++;
        else if (status === 'pending') pending++;
        else missed++;

        todayList.push({
          user_id: u.id,
          display_name: u.display_name,
          email: u.email,
          avatar_url: u.avatar_url,
          role: roleMap.get(u.id) ?? null,
          status,
          submitted_at,
          deadline_time: deadline,
        });
      }
    }

    const totalEligible = todayIsWorking ? eligible.length : 0;
    const attendanceRate = totalEligible > 0 ? (onTime + late) / totalEligible : 0;

    // Range checkins for trend + leaderboard
    const { data: rangeCheckins } = eligibleIds.length > 0
      ? await supabaseAdmin
          .from('checkins')
          .select('user_id, date, status')
          .gte('date', startDate)
          .lte('date', today)
          .in('user_id', eligibleIds)
      : { data: [] as any[] };

    // Trend buckets (only seeded for working days)
    const trendBuckets = new Map<string, { onTime: number; late: number; missed: number }>();
    for (const date of calendar.workingDates) {
      trendBuckets.set(date, { onTime: 0, late: 0, missed: 0 });
    }
    for (const c of (rangeCheckins || []) as any[]) {
      const bucket = trendBuckets.get(c.date);
      if (!bucket) continue;
      if (c.status === 'on_time') bucket.onTime++;
      else if (c.status === 'late') bucket.late++;
      else if (c.status === 'no_checkin') bucket.missed++;
    }
    const trend: Array<{ date: string; isWorkingDay: boolean; onTime: number; late: number; missed: number }> = [];
    {
      const cursor = new Date(startDate + 'T00:00:00Z');
      const end = new Date(today + 'T00:00:00Z');
      while (cursor <= end) {
        const dateStr = cursor.toISOString().split('T')[0];
        const isWD = workingDateSet.has(dateStr);
        const b = trendBuckets.get(dateStr);
        trend.push({
          date: dateStr,
          isWorkingDay: isWD,
          onTime: b?.onTime ?? 0,
          late: b?.late ?? 0,
          missed: b?.missed ?? 0,
        });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    // Leaderboard buckets per eligible user
    const userBuckets = new Map<string, { onTime: number; late: number; missed: number }>();
    for (const u of eligible) userBuckets.set(u.id, { onTime: 0, late: 0, missed: 0 });
    for (const c of (rangeCheckins || []) as any[]) {
      if (!workingDateSet.has(c.date)) continue;
      const bucket = userBuckets.get(c.user_id);
      if (!bucket) continue;
      if (c.status === 'on_time') bucket.onTime++;
      else if (c.status === 'late') bucket.late++;
      else if (c.status === 'no_checkin') bucket.missed++;
    }

    const totalWorkingDays = calendar.workingDates.length;
    const leaderboard = eligible.map((u) => {
      const b = userBuckets.get(u.id) || { onTime: 0, late: 0, missed: 0 };
      const rate = totalWorkingDays > 0 ? (b.onTime + b.late) / totalWorkingDays : 0;
      return {
        user_id: u.id,
        display_name: u.display_name,
        email: u.email,
        role: roleMap.get(u.id) ?? null,
        working_days: totalWorkingDays,
        on_time: b.onTime,
        late: b.late,
        missed: b.missed,
        attendance_rate: rate,
      };
    });
    leaderboard.sort((a, b) => b.attendance_rate - a.attendance_rate || a.missed - b.missed);

    res.json({
      success: true,
      data: {
        today: {
          date: today,
          isWorkingDay: todayIsWorking,
          holidayName: todayHoliday,
          totalEligible,
          onTime,
          late,
          pending,
          missed,
          attendanceRate,
          checkins: todayList,
        },
        trend,
        leaderboard,
        windowDays: days,
      },
    });
  } catch (err) {
    console.error('Check-in overview error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
