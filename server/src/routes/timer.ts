import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireUserType } from '../middleware/userType';
import { supabaseAdmin } from '../supabase';
import { nowIST, todayIST, IST_OFFSET_MS } from '../utils/ist';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal'));

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

    res.json({
      success: true,
      data: {
        today: todaySummary || null,
        active_timer: activeSessions?.[0] || null,
        week_summaries: weekSummaries || [],
      },
    });
  } catch (err) {
    console.error('Timer stats error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
