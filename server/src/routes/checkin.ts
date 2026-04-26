import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireUserType } from '../middleware/userType';
import { supabaseAdmin } from '../supabase';
import { nowIST, todayIST, formatTimeIST, isNonWorkingDay } from '../utils/ist';
import { getUserRoleIds } from '../utils/roles';
import { PARTNER_USER_TYPES } from '@squadhub/shared';

const router = Router();

// All check-in routes require auth and a user type in scope
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES));

/** Resolve the on-time deadline for a user: office_timing.from_time → user_checkin_settings.deadline_time → '10:00' */
async function resolveDeadlineTime(userId: string): Promise<string> {
  const { data: officeTiming } = await supabaseAdmin
    .from('user_office_timing')
    .select('from_time')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  if (officeTiming?.from_time) return officeTiming.from_time;

  const { data: settingsRows } = await supabaseAdmin
    .from('user_checkin_settings')
    .select('deadline_time')
    .eq('user_id', userId)
    .limit(1);
  return settingsRows?.[0]?.deadline_time || '10:00';
}

// POST /checkin/submit — submit daily check-in
const submitSchema = z.object({
  completed_items: z.array(z.string()),
});

router.post('/submit', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const body = submitSchema.parse(req.body);
    const today = todayIST();

    // Check if already checked in today
    const { data: existing } = await supabaseAdmin
      .from('checkins')
      .select('id')
      .eq('user_id', userId)
      .eq('date', today)
      .neq('status', 'no_checkin')
      .limit(1);

    if (existing && existing.length > 0) {
      res.status(409).json({ success: false, error: 'You have already checked in today' });
      return;
    }

    // Check if today is a non-working day
    if (await isNonWorkingDay(today)) {
      res.status(400).json({ success: false, error: 'Today is a holiday or non-working day' });
      return;
    }

    // Get user's deadline time (office timing takes precedence over per-user settings)
    const deadlineTime = await resolveDeadlineTime(userId);

    // Get user's primary role (for audit snapshot saved on the checkin row)
    const { data: members } = await supabaseAdmin
      .from('workspace_members')
      .select('role_id')
      .eq('user_id', userId)
      .limit(1);
    const member = members?.[0] || null;

    // Validate required items across ALL roles (primary + secondary), deduped by item id
    const roleIds = await getUserRoleIds(userId);
    if (roleIds.length > 0) {
      const { data: configRows } = await supabaseAdmin
        .from('checkin_configs')
        .select('items')
        .in('role_id', roleIds);

      const seenIds = new Set<string>();
      const requiredIds: string[] = [];
      for (const cfg of configRows || []) {
        for (const item of ((cfg.items as any[]) || [])) {
          if (item.isRequired && !seenIds.has(item.id)) {
            seenIds.add(item.id);
            requiredIds.push(item.id);
          }
        }
      }
      const missing = requiredIds.filter((id) => !body.completed_items.includes(id));
      if (missing.length > 0) {
        res.status(400).json({ success: false, error: 'All required items must be completed' });
        return;
      }
    }

    // Determine status
    const currentTimeIST = formatTimeIST(new Date());
    const status = currentTimeIST <= deadlineTime ? 'on_time' : 'late';

    // Upsert check-in (may have a no_checkin placeholder from cron)
    const { data, error } = await supabaseAdmin
      .from('checkins')
      .upsert({
        user_id: userId,
        date: today,
        submitted_at: new Date().toISOString(),
        status,
        completed_items: body.completed_items,
        role_id: member?.role_id || null,
      }, { onConflict: 'user_id,date' })
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
    console.error('Check-in submit error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /checkin/today — get today's check-in status
router.get('/today', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const today = todayIST();

    const isHoliday = await isNonWorkingDay(today);

    const { data: checkinRows } = await supabaseAdmin
      .from('checkins')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .limit(1);
    const checkin = checkinRows?.[0] || null;

    // Get user's primary role (surfaced on the UI for role name/id)
    const { data: memberRows } = await supabaseAdmin
      .from('workspace_members')
      .select('role_id, roles(id, name)')
      .eq('user_id', userId)
      .limit(1);
    const member = memberRows?.[0] || null;

    // Checklist items are the UNION across primary + secondary roles (deduped by item id)
    const roleIds = await getUserRoleIds(userId);
    let checklistItems: any[] = [];
    if (roleIds.length > 0) {
      const { data: configRows } = await supabaseAdmin
        .from('checkin_configs')
        .select('items')
        .in('role_id', roleIds);

      const seenIds = new Set<string>();
      for (const cfg of configRows || []) {
        for (const item of ((cfg.items as any[]) || [])) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            checklistItems.push(item);
          }
        }
      }
    }

    // Get user's deadline (office timing takes precedence over per-user settings)
    const deadlineTime = await resolveDeadlineTime(userId);

    res.json({
      success: true,
      data: {
        checkin: checkin || null,
        is_holiday: isHoliday,
        checklist_items: checklistItems,
        deadline_time: deadlineTime,
        role: member?.roles || null,
        already_checked_in: !!(checkin && checkin.status !== 'no_checkin'),
      },
    });
  } catch (err) {
    console.error('Check-in today error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /checkin/dashboard — get check-in history for the current user
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const view = (req.query.view as string) || 'week';

    const ist = nowIST();
    let startDate: string;
    let endDate: string = todayIST();

    if (view === 'week') {
      const dayOfWeek = ist.getUTCDay();
      const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(ist);
      monday.setUTCDate(monday.getUTCDate() - mondayOffset);
      startDate = monday.toISOString().split('T')[0];
      const saturday = new Date(monday);
      saturday.setUTCDate(saturday.getUTCDate() + 6);
      endDate = saturday.toISOString().split('T')[0];
    } else if (view === 'month') {
      const firstOfMonth = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1));
      const lastOfMonth = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 0));
      startDate = firstOfMonth.toISOString().split('T')[0];
      endDate = lastOfMonth.toISOString().split('T')[0];
    } else if (view === '3months') {
      const firstOf3Months = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 3, 1));
      startDate = firstOf3Months.toISOString().split('T')[0];
    } else {
      // year
      startDate = `${ist.getUTCFullYear()}-01-01`;
    }

    // Fetch check-ins for the period
    const { data: checkins } = await supabaseAdmin
      .from('checkins')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });

    // Fetch holidays
    const { data: holidays } = await supabaseAdmin
      .from('holidays')
      .select('*');

    // Fetch working days config
    const { data: wdConfig } = await supabaseAdmin
      .from('working_days_config')
      .select('working_days')
      .limit(1)
      .single();

    const workingDays: number[] = wdConfig?.working_days || [1, 2, 3, 4, 5, 6];

    // Build day-by-day data
    const checkinMap = new Map((checkins || []).map((c: any) => [c.date, c]));
    const holidayDates = new Set((holidays || []).filter((h: any) => !h.is_recurring && h.date).map((h: any) => h.date));
    const recurringHolidays = (holidays || []).filter((h: any) => h.is_recurring);

    const days: any[] = [];
    let totalWorking = 0;
    let onTime = 0;
    let late = 0;
    let missed = 0;
    let holidayCount = 0;

    const current = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');
    const todayStr = todayIST();

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const dayOfWeek = current.getUTCDay();
      const month = current.getUTCMonth() + 1;
      const day = current.getUTCDate();

      const isNonWorking = !workingDays.includes(dayOfWeek);
      const isSpecificHoliday = holidayDates.has(dateStr);
      const isRecurringHoliday = recurringHolidays.some(
        (h: any) => h.recurring_month === month && h.recurring_day === day
      );

      if (isNonWorking || isSpecificHoliday || isRecurringHoliday) {
        days.push({ date: dateStr, status: 'holiday', submitted_at: null });
        holidayCount++;
      } else if (dateStr > todayStr) {
        // Future date - skip from counts
        days.push({ date: dateStr, status: 'future', submitted_at: null });
      } else {
        totalWorking++;
        const checkin = checkinMap.get(dateStr);
        if (checkin) {
          days.push({ date: dateStr, status: checkin.status, submitted_at: checkin.submitted_at });
          if (checkin.status === 'on_time') onTime++;
          else if (checkin.status === 'late') late++;
          else missed++;
        } else {
          days.push({ date: dateStr, status: 'no_checkin', submitted_at: null });
          missed++;
        }
      }

      current.setUTCDate(current.getUTCDate() + 1);
    }

    const attendanceRate = totalWorking > 0
      ? Math.round(((onTime + late) / totalWorking) * 100)
      : 100;

    res.json({
      success: true,
      data: {
        days,
        summary: {
          total_working_days: totalWorking,
          on_time: onTime,
          late,
          missed,
          holidays: holidayCount,
          attendance_rate: attendanceRate,
        },
      },
    });
  } catch (err) {
    console.error('Check-in dashboard error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
