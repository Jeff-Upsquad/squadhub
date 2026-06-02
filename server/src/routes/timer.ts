import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireUserType } from '../middleware/userType';
import { getPrimaryRolePermissions } from '../middleware/permissions';
import { supabaseAdmin } from '../supabase';
import { nowIST, todayIST, IST_OFFSET_MS } from '../utils/ist';
import { PARTNER_USER_TYPES } from '@squadhub/shared';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES));

// ---- Helpers ----

/** Stop an active timer session, compute duration, update daily summary */
async function stopSession(sessionId: string): Promise<void> {
  const now = new Date();

  const { data: session } = await supabaseAdmin
    .from('timer_sessions')
    .select('*')
    .eq('id', sessionId)
    .is('end_time', null)
    .single();

  if (!session) return;

  const startTime = new Date(session.start_time);
  const durationSeconds = Math.round((now.getTime() - startTime.getTime()) / 1000);

  await supabaseAdmin
    .from('timer_sessions')
    .update({ end_time: now.toISOString(), duration_seconds: durationSeconds })
    .eq('id', sessionId);

  // Update daily summary
  await upsertDailySummary(session.user_id, session.date, session.timer_type, durationSeconds, now, session.workspace_id, session.context);
}

/**
 * Rebuild daily_time_summaries for a given (user, workspace, context, date)
 * by re-aggregating all completed timer_sessions for that day. Used after
 * edits or deletes, where incremental delta math is error-prone.
 */
async function rebuildDailySummary(
  userId: string,
  workspaceId: string,
  context: string,
  date: string,
): Promise<void> {
  const { data: sessions } = await supabaseAdmin
    .from('timer_sessions')
    .select('timer_type, duration_seconds, start_time, end_time')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .eq('context', context)
    .eq('date', date)
    .not('end_time', 'is', null);

  const rows = sessions || [];
  let totalWork = 0;
  let totalBreak = 0;
  let totalNoWork = 0;
  let firstStart: string | null = null;
  let lastStop: string | null = null;

  for (const s of rows as any[]) {
    const dur = s.duration_seconds || 0;
    if (s.timer_type === 'work') totalWork += dur;
    else if (s.timer_type === 'break') totalBreak += dur;
    else totalNoWork += dur;
    if (!firstStart || s.start_time < firstStart) firstStart = s.start_time;
    if (!lastStop || (s.end_time && s.end_time > lastStop)) lastStop = s.end_time;
  }

  const { data: existing } = await supabaseAdmin
    .from('daily_time_summaries')
    .select('id')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .eq('context', context)
    .eq('date', date)
    .single();

  const payload = {
    user_id: userId,
    workspace_id: workspaceId,
    context,
    date,
    total_work_seconds: totalWork,
    total_break_seconds: totalBreak,
    total_no_work_seconds: totalNoWork,
    session_count: rows.length,
    first_start: firstStart,
    last_stop: lastStop,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await supabaseAdmin.from('daily_time_summaries').update(payload).eq('id', existing.id);
  } else if (rows.length > 0) {
    await supabaseAdmin.from('daily_time_summaries').insert(payload);
  }
}

/** Upsert daily_time_summaries with the new session duration */
async function upsertDailySummary(
  userId: string,
  date: string,
  timerType: string,
  durationSeconds: number,
  stopTime: Date,
  workspaceId?: string,
  context: string = 'default',
): Promise<void> {
  let query = supabaseAdmin
    .from('daily_time_summaries')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .eq('context', context);

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data: existing } = await query.single();

  if (existing) {
    const updates: Record<string, any> = { updated_at: new Date().toISOString(), last_stop: stopTime.toISOString() };
    if (timerType === 'work') updates.total_work_seconds = existing.total_work_seconds + durationSeconds;
    else if (timerType === 'break') updates.total_break_seconds = existing.total_break_seconds + durationSeconds;
    else updates.total_no_work_seconds = existing.total_no_work_seconds + durationSeconds;
    updates.session_count = existing.session_count + 1;

    await supabaseAdmin
      .from('daily_time_summaries')
      .update(updates)
      .eq('id', existing.id);
  } else {
    const row: Record<string, any> = {
      user_id: userId,
      workspace_id: workspaceId,
      context,
      date,
      total_work_seconds: 0,
      total_break_seconds: 0,
      total_no_work_seconds: 0,
      session_count: 1,
      first_start: stopTime.toISOString(),
      last_stop: stopTime.toISOString(),
    };
    if (timerType === 'work') row.total_work_seconds = durationSeconds;
    else if (timerType === 'break') row.total_break_seconds = durationSeconds;
    else row.total_no_work_seconds = durationSeconds;

    await supabaseAdmin.from('daily_time_summaries').insert(row);
  }
}

// ---- Routes ----

// POST /timer/start — start a new timer (auto-stops any active one)
const startSchema = z.object({
  timer_type: z.enum(['work', 'break', 'no_work']),
  workspace_id: z.string().uuid(),
  context: z.string().default('default'),
});

router.post('/start', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { timer_type, workspace_id, context } = startSchema.parse(req.body);
    const today = todayIST();

    // Auto-stop any active timer in this workspace+context
    const { data: active } = await supabaseAdmin
      .from('timer_sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('workspace_id', workspace_id)
      .eq('context', context)
      .is('end_time', null)
      .limit(1);

    if (active && active.length > 0) {
      await stopSession(active[0].id);
    }

    // Create new session
    const { data, error } = await supabaseAdmin
      .from('timer_sessions')
      .insert({
        user_id: userId,
        workspace_id,
        context,
        date: today,
        timer_type,
        start_time: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Update first_start in daily summary if needed
    const { data: summary } = await supabaseAdmin
      .from('daily_time_summaries')
      .select('id, first_start')
      .eq('user_id', userId)
      .eq('workspace_id', workspace_id)
      .eq('context', context)
      .eq('date', today)
      .single();

    if (!summary) {
      await supabaseAdmin.from('daily_time_summaries').insert({
        user_id: userId,
        workspace_id,
        context,
        date: today,
        first_start: data.start_time,
      });
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Timer start error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /timer/stop — stop the active timer
const stopSchema = z.object({
  session_id: z.string().uuid().optional(),
  workspace_id: z.string().uuid(),
  context: z.string().default('default'),
});

router.post('/stop', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { session_id, workspace_id, context } = stopSchema.parse(req.body);

    // Find active session in this workspace+context
    let query = supabaseAdmin
      .from('timer_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('workspace_id', workspace_id)
      .eq('context', context)
      .is('end_time', null);

    if (session_id) {
      query = query.eq('id', session_id);
    }

    const { data: sessions } = await query.limit(1);

    if (!sessions || sessions.length === 0) {
      res.status(404).json({ success: false, error: 'No active timer found' });
      return;
    }

    const session = sessions[0];
    await stopSession(session.id);

    // Fetch updated session
    const { data: updated } = await supabaseAdmin
      .from('timer_sessions')
      .select('*')
      .eq('id', session.id)
      .single();

    res.json({ success: true, data: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Timer stop error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /timer/active — get current active timer
router.get('/active', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspace_id = req.query.workspace_id as string;
    const context = (req.query.context as string) || 'default';

    if (!workspace_id) {
      res.status(400).json({ success: false, error: 'workspace_id is required' });
      return;
    }

    const { data: sessions } = await supabaseAdmin
      .from('timer_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('workspace_id', workspace_id)
      .eq('context', context)
      .is('end_time', null)
      .limit(1);

    const session = sessions?.[0] || null;
    const elapsed_seconds = session
      ? Math.round((Date.now() - new Date(session.start_time).getTime()) / 1000)
      : 0;

    res.json({ success: true, data: { session, elapsed_seconds } });
  } catch (err) {
    console.error('Timer active error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /timer/stats — today's summary + active timer + weekly summaries
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspace_id = req.query.workspace_id as string;
    const context = (req.query.context as string) || 'default';
    const today = todayIST();

    if (!workspace_id) {
      res.status(400).json({ success: false, error: 'workspace_id is required' });
      return;
    }

    // Today's summary
    const { data: todaySummary } = await supabaseAdmin
      .from('daily_time_summaries')
      .select('*')
      .eq('user_id', userId)
      .eq('workspace_id', workspace_id)
      .eq('context', context)
      .eq('date', today)
      .single();

    // Active timer
    const { data: activeSessions } = await supabaseAdmin
      .from('timer_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('workspace_id', workspace_id)
      .eq('context', context)
      .is('end_time', null)
      .limit(1);

    // This week's summaries (Mon-Sun)
    const ist = nowIST();
    const dayOfWeek = ist.getUTCDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(ist);
    monday.setUTCDate(monday.getUTCDate() - mondayOffset);
    const startDate = monday.toISOString().split('T')[0];

    const { data: weekSummaries } = await supabaseAdmin
      .from('daily_time_summaries')
      .select('*')
      .eq('user_id', userId)
      .eq('workspace_id', workspace_id)
      .eq('context', context)
      .gte('date', startDate)
      .lte('date', today)
      .order('date', { ascending: true });

    // Office timing (drives the progress bar denominator)
    const { data: timing } = await supabaseAdmin
      .from('user_office_timing')
      .select('label, from_time, to_time, working_days, max_break_minutes, is_active')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    let officeTiming: null | {
      label: string;
      from_time: string;
      to_time: string;
      working_days: number[];
      max_break_minutes: number;
      office_hours_total_seconds: number;
    } = null;
    if (timing) {
      const [fh, fm] = timing.from_time.split(':').map(Number);
      const [th, tm] = timing.to_time.split(':').map(Number);
      const totalSeconds = Math.max(0, ((th * 60 + tm) - (fh * 60 + fm)) * 60);
      officeTiming = {
        label: timing.label,
        from_time: timing.from_time,
        to_time: timing.to_time,
        working_days: timing.working_days,
        max_break_minutes: timing.max_break_minutes,
        office_hours_total_seconds: totalSeconds,
      };
    }

    // Today's sessions (completed + active) for the edit list
    const { data: todaySessions } = await supabaseAdmin
      .from('timer_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('workspace_id', workspace_id)
      .eq('context', context)
      .eq('date', today)
      .order('start_time', { ascending: true });

    // Edit permission from the user's PRIMARY role
    const primary = await getPrimaryRolePermissions(userId);
    const timeLogEdit = {
      can_edit: primary.can_edit_time_logs === true,
      window_hours: typeof primary.time_edit_window_hours === 'number' ? primary.time_edit_window_hours : 0,
    };

    res.json({
      success: true,
      data: {
        today: todaySummary || null,
        active_timer: activeSessions?.[0] || null,
        week_summaries: weekSummaries || [],
        office_timing: officeTiming,
        today_sessions: todaySessions || [],
        time_log_edit: timeLogEdit,
      },
    });
  } catch (err) {
    console.error('Timer stats error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /timer/daily-summaries?from=YYYY-MM-DD&to=YYYY-MM-DD[&workspace_id=...][&context=...]
// Returns daily summaries for the current user in the given date range.
// Used by the space dashboard's hours-used cards.
router.get('/daily-summaries', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();

    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      res.status(400).json({ success: false, error: 'from and to query params (YYYY-MM-DD) are required' });
      return;
    }

    let query = supabaseAdmin
      .from('daily_time_summaries')
      .select('date, total_work_seconds')
      .eq('user_id', userId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true });

    const workspace_id = req.query.workspace_id as string | undefined;
    if (workspace_id) {
      query = query.eq('workspace_id', workspace_id);
    }

    const context = req.query.context as string | undefined;
    if (context) {
      query = query.eq('context', context);
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('Daily summaries error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /timer/sessions/:id — edit an owned session (start/end/type).
// Enforces: ownership, primary-role can_edit_time_logs, edit window.
const patchSchema = z.object({
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  timer_type: z.enum(['work', 'break', 'no_work']).optional(),
});

router.patch('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const sessionId = req.params.id;
    const body = patchSchema.parse(req.body);

    const { data: session } = await supabaseAdmin
      .from('timer_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    // 404 on ownership mismatch so existence isn't leaked
    if (!session || session.user_id !== userId) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    if (!session.end_time) {
      res.status(400).json({ success: false, error: 'Stop the timer before editing' });
      return;
    }

    const primary = await getPrimaryRolePermissions(userId);
    if (primary.can_edit_time_logs !== true) {
      res.status(403).json({ success: false, error: 'Your role cannot edit time logs' });
      return;
    }

    const windowHours = typeof primary.time_edit_window_hours === 'number' ? primary.time_edit_window_hours : 0;
    if (windowHours > 0) {
      const ageMs = Date.now() - new Date(session.end_time).getTime();
      if (ageMs > windowHours * 3600 * 1000) {
        res.status(403).json({ success: false, error: 'Edit window has expired' });
        return;
      }
    }

    const newStart = body.start_time ?? session.start_time;
    const newEnd = body.end_time ?? session.end_time;
    const newType = body.timer_type ?? session.timer_type;

    const startMs = new Date(newStart).getTime();
    const endMs = new Date(newEnd).getTime();
    if (!(endMs > startMs)) {
      res.status(400).json({ success: false, error: 'end_time must be after start_time' });
      return;
    }
    if (endMs > Date.now() + 60_000) {
      res.status(400).json({ success: false, error: 'end_time cannot be in the future' });
      return;
    }

    const duration = Math.round((endMs - startMs) / 1000);

    const { data: updated, error } = await supabaseAdmin
      .from('timer_sessions')
      .update({
        start_time: newStart,
        end_time: newEnd,
        timer_type: newType,
        duration_seconds: duration,
      })
      .eq('id', sessionId)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    await rebuildDailySummary(userId, session.workspace_id, session.context, session.date);
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Timer patch error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /timer/sessions/:id — delete an owned session.
router.delete('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const sessionId = req.params.id;

    const { data: session } = await supabaseAdmin
      .from('timer_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (!session || session.user_id !== userId) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    if (!session.end_time) {
      res.status(400).json({ success: false, error: 'Stop the timer before deleting' });
      return;
    }

    const primary = await getPrimaryRolePermissions(userId);
    if (primary.can_edit_time_logs !== true) {
      res.status(403).json({ success: false, error: 'Your role cannot edit time logs' });
      return;
    }

    const windowHours = typeof primary.time_edit_window_hours === 'number' ? primary.time_edit_window_hours : 0;
    if (windowHours > 0) {
      const ageMs = Date.now() - new Date(session.end_time).getTime();
      if (ageMs > windowHours * 3600 * 1000) {
        res.status(403).json({ success: false, error: 'Edit window has expired' });
        return;
      }
    }

    const { error } = await supabaseAdmin.from('timer_sessions').delete().eq('id', sessionId);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    await rebuildDailySummary(userId, session.workspace_id, session.context, session.date);
    res.json({ success: true });
  } catch (err) {
    console.error('Timer delete error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
