import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';
import { todayIST, nowIST } from '../utils/ist';
import { getUserRoleIds } from '../utils/roles';

const router = Router();
router.use(requireAuth);

// Middleware: check that user has access to 'time-management' mini app
async function requireTimeManagementAccess(req: Request, res: Response, next: Function) {
  try {
    const userId = req.userId!;

    // Get the mini app
    const { data: app } = await supabaseAdmin
      .from('mini_apps')
      .select('id')
      .eq('slug', 'time-management')
      .eq('is_enabled', true)
      .single();

    if (!app) {
      res.status(403).json({ success: false, error: 'Time management module is not enabled' });
      return;
    }

    // Check direct user access
    const { data: userAccess } = await supabaseAdmin
      .from('mini_app_user_access')
      .select('id')
      .eq('mini_app_id', app.id)
      .eq('user_id', userId)
      .limit(1);

    if (userAccess && userAccess.length > 0) {
      next();
      return;
    }

    // Check role-based access across primary + secondary roles
    const roleIds = await getUserRoleIds(userId);

    if (roleIds.length > 0) {
      const { data: roleAccess } = await supabaseAdmin
        .from('mini_app_role_access')
        .select('id')
        .eq('mini_app_id', app.id)
        .in('role_id', roleIds)
        .limit(1);

      if (roleAccess && roleAccess.length > 0) {
        next();
        return;
      }
    }

    res.status(403).json({ success: false, error: 'Access denied to time management module' });
  } catch (err) {
    console.error('Time management access check error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

router.use(requireTimeManagementAccess as any);

// GET /admin/timer/team-status — real-time team status
router.get('/team-status', async (_req: Request, res: Response) => {
  try {
    const today = todayIST();

    // Get all active users
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, display_name, avatar_url')
      .eq('status', 'active');

    if (!users || users.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const userIds = users.map((u: any) => u.id);

    // Get active timers
    const { data: activeTimers } = await supabaseAdmin
      .from('timer_sessions')
      .select('*')
      .in('user_id', userIds)
      .is('end_time', null);

    // Get today's summaries
    const { data: summaries } = await supabaseAdmin
      .from('daily_time_summaries')
      .select('*')
      .in('user_id', userIds)
      .eq('date', today);

    const timerMap = new Map((activeTimers || []).map((t: any) => [t.user_id, t]));
    const summaryMap = new Map((summaries || []).map((s: any) => [s.user_id, s]));

    const teamStatus = users.map((u: any) => ({
      user_id: u.id,
      display_name: u.display_name,
      avatar_url: u.avatar_url,
      active_timer: timerMap.get(u.id) || null,
      today_summary: summaryMap.get(u.id) || null,
    }));

    res.json({ success: true, data: teamStatus });
  } catch (err) {
    console.error('Team status error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/timer/team-stats — aggregated stats for date range
router.get('/team-stats', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, user_id } = req.query;
    const today = todayIST();
    const startStr = (start_date as string) || today;
    const endStr = (end_date as string) || today;

    let query = supabaseAdmin
      .from('daily_time_summaries')
      .select('*, users:user_id(id, display_name, avatar_url)')
      .gte('date', startStr)
      .lte('date', endStr)
      .order('date', { ascending: false });

    if (user_id) {
      query = query.eq('user_id', user_id as string);
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('Team stats error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/timer/user/:userId/sessions — detailed sessions for a user on a date
router.get('/user/:userId/sessions', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const date = (req.query.date as string) || todayIST();

    const { data, error } = await supabaseAdmin
      .from('timer_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .order('start_time', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('User sessions error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/timer/export — CSV export
router.get('/export', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date } = req.query;
    const today = todayIST();
    const startStr = (start_date as string) || today;
    const endStr = (end_date as string) || today;

    const { data, error } = await supabaseAdmin
      .from('daily_time_summaries')
      .select('*, users:user_id(display_name)')
      .gte('date', startStr)
      .lte('date', endStr)
      .order('date', { ascending: true })
      .order('user_id', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const rows = (data || []).map((r: any) => ({
      user: (r.users as any)?.display_name || r.user_id,
      date: r.date,
      work_hours: (r.total_work_seconds / 3600).toFixed(2),
      break_hours: (r.total_break_seconds / 3600).toFixed(2),
      no_work_hours: (r.total_no_work_seconds / 3600).toFixed(2),
      sessions: r.session_count,
      first_start: r.first_start || '',
      last_stop: r.last_stop || '',
    }));

    const header = 'User,Date,Work Hours,Break Hours,No Work Hours,Sessions,First Start,Last Stop\n';
    const csv = header + rows.map((r: any) =>
      `"${r.user}","${r.date}","${r.work_hours}","${r.break_hours}","${r.no_work_hours}","${r.sessions}","${r.first_start}","${r.last_stop}"`
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="time-tracking-${startStr}-${endStr}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
