import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireUserType } from '../middleware/userType';
import { supabaseAdmin } from '../supabase';
import { nowIST, todayIST, isNonWorkingDay } from '../utils/ist';
import { getWorkingCalendar } from '../utils/checkin';
import {
  computeProgress,
  getCompletedTasksWithClient,
  getOfficeAndTracked,
} from '../utils/timesheet';
import { PARTNER_USER_TYPES } from '@squadhub/shared';

const router = Router();

// Same scope as the check-in routes: internal + partner user types.
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /timesheet/today?date=YYYY-MM-DD — live state for the timesheet tab.
router.get('/today', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const today = todayIST();
    const date = (req.query.date as string) || today;

    if (!DATE_RE.test(date)) {
      res.status(400).json({ success: false, error: 'Invalid date' });
      return;
    }
    if (date > today) {
      res.status(400).json({ success: false, error: 'Cannot open a future timesheet' });
      return;
    }

    const isHoliday = await isNonWorkingDay(date);

    const { data: existingRows } = await supabaseAdmin
      .from('timesheets')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .limit(1);
    const existing = existingRows?.[0] || null;
    const alreadySubmitted = !!(existing && existing.status !== 'no_submission');

    const [{ office_timing, tracked_work_seconds }, completedTasks] = await Promise.all([
      getOfficeAndTracked(userId, date),
      getCompletedTasksWithClient(userId, date),
    ]);

    // When already submitted, show the stored snapshot; otherwise compute live.
    const progress = alreadySubmitted && Array.isArray(existing.progress)
      ? existing.progress
      : await computeProgress(userId, date);

    res.json({
      success: true,
      data: {
        date,
        is_holiday: isHoliday,
        is_backfill: !alreadySubmitted && !isHoliday && date < today,
        already_submitted: alreadySubmitted,
        timesheet: existing,
        progress,
        completed_tasks: completedTasks,
        tracked_work_seconds,
        office_timing,
      },
    });
  } catch (err) {
    console.error('Timesheet today error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /timesheet/missing — past working days (last 30) with no submission.
router.get('/missing', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const today = todayIST();
    const startObj = new Date(today + 'T00:00:00Z');
    startObj.setUTCDate(startObj.getUTCDate() - 30);
    const startDate = startObj.toISOString().split('T')[0];

    const calendar = await getWorkingCalendar(startDate, today);
    // Exclude today — that's the default tab, not a "missed" day.
    const candidates = calendar.workingDates.filter((d) => d < today);

    const { data: submitted } = await supabaseAdmin
      .from('timesheets')
      .select('date, status')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', today);

    const submittedDates = new Set(
      (submitted || [])
        .filter((s: any) => s.status !== 'no_submission')
        .map((s: any) => s.date),
    );

    const missing = candidates.filter((d) => !submittedDates.has(d)).sort((a, b) => (a < b ? 1 : -1));
    res.json({ success: true, data: missing });
  } catch (err) {
    console.error('Timesheet missing error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /timesheet/submit — submit (or backfill) a daily timesheet.
const progressLineSchema = z.object({
  client_id: z.string(),
  client_name: z.string().default(''),
  kind: z.enum(['hours', 'item']),
  label: z.string().default(''),
  target_day: z.number().default(0),
  target_week: z.number().default(0),
  target_month: z.number().default(0),
  achieved_day: z.number().default(0),
  achieved_week: z.number().default(0),
  achieved_month: z.number().default(0),
  auto_day: z.number().default(0),
});

const submitSchema = z.object({
  date: z.string().regex(DATE_RE),
  summary: z.string().max(5000).default(''),
  progress: z.array(progressLineSchema).default([]),
  completed_task_ids: z.array(z.string()).default([]),
});

router.post('/submit', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const body = submitSchema.parse(req.body);
    const today = todayIST();

    if (body.date > today) {
      res.status(400).json({ success: false, error: 'Cannot submit a future timesheet' });
      return;
    }
    if (await isNonWorkingDay(body.date)) {
      res.status(400).json({ success: false, error: 'That date is a holiday or non-working day' });
      return;
    }

    // on_time only when the sheet is for today; backfilled days are late.
    const status = body.date === today ? 'on_time' : 'late';

    const { office_timing, tracked_work_seconds } = await getOfficeAndTracked(userId, body.date);

    const { data, error } = await supabaseAdmin
      .from('timesheets')
      .upsert({
        user_id: userId,
        date: body.date,
        submitted_at: new Date().toISOString(),
        status,
        summary: body.summary,
        tracked_work_seconds,
        office_hours_total_seconds: office_timing?.office_hours_total_seconds || 0,
        completed_task_ids: body.completed_task_ids,
        progress: body.progress,
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
    console.error('Timesheet submit error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /timesheet/dashboard?view=week|month|3months|year — calendar of statuses.
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const view = (req.query.view as string) || 'month';
    const ist = nowIST();
    const today = todayIST();
    let startDate: string;
    let endDate: string = today;

    if (view === 'week') {
      const dow = ist.getUTCDay();
      const mondayOffset = dow === 0 ? 6 : dow - 1;
      const monday = new Date(ist);
      monday.setUTCDate(monday.getUTCDate() - mondayOffset);
      startDate = monday.toISOString().split('T')[0];
      const sunday = new Date(monday);
      sunday.setUTCDate(sunday.getUTCDate() + 6);
      endDate = sunday.toISOString().split('T')[0];
    } else if (view === '3months') {
      startDate = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 2, 1)).toISOString().split('T')[0];
    } else if (view === 'year') {
      startDate = `${ist.getUTCFullYear()}-01-01`;
    } else {
      startDate = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1)).toISOString().split('T')[0];
      endDate = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 0)).toISOString().split('T')[0];
    }

    const calendar = await getWorkingCalendar(startDate, endDate);
    const workingSet = new Set(calendar.workingDates);

    const { data: rows } = await supabaseAdmin
      .from('timesheets')
      .select('date, status, submitted_at')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate);
    const byDate = new Map((rows || []).map((r: any) => [r.date, r]));

    const days: any[] = [];
    let onTime = 0;
    let late = 0;
    let missed = 0;
    let totalWorking = 0;

    const cursor = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');
    while (cursor <= end) {
      const dateStr = cursor.toISOString().split('T')[0];
      if (calendar.holidayByDate.has(dateStr) || !workingSet.has(dateStr)) {
        days.push({ date: dateStr, status: 'holiday', submitted_at: null });
      } else if (dateStr > today) {
        days.push({ date: dateStr, status: 'future', submitted_at: null });
      } else {
        totalWorking++;
        const row = byDate.get(dateStr);
        const status = row && row.status !== 'no_submission' ? row.status : 'no_submission';
        days.push({ date: dateStr, status, submitted_at: row?.submitted_at ?? null });
        if (status === 'on_time') onTime++;
        else if (status === 'late') late++;
        else missed++;
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    res.json({
      success: true,
      data: {
        days,
        summary: {
          total_working_days: totalWorking,
          on_time: onTime,
          late,
          missed,
          submission_rate: totalWorking > 0 ? Math.round(((onTime + late) / totalWorking) * 100) : 100,
        },
      },
    });
  } catch (err) {
    console.error('Timesheet dashboard error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
