import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { nextTaskRecurrenceDate, type TaskRecurrence } from '@squadhub/shared';
import { PARTNER_USER_TYPES } from '@squadhub/shared';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { checkResourceAccess, meetsAccessLevel } from '../../middleware/permissions';
import { spawnRoutineInstance } from '../../services/routineSpawner';
import { todayIST } from '../../utils/ist';
import { hydrateAssignees, hydrateLists } from './tasks';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

// GET /pm/routines — every routine template on lists the caller can see,
// hydrated for the Routines management view: assignees, list/folder/space,
// instance stats and the next date the rule fires.
router.get('/routines', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .not('recurrence', 'is', null)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Access-filter by parent list (same approach as GET /pm/tasks/emergency).
    const rows = data || [];
    const listIds = Array.from(new Set(rows.map((t: any) => t.list_id).filter(Boolean)));
    const accessCache = new Map<string, boolean>();
    await Promise.all(listIds.map(async (listId) => {
      const level = await checkResourceAccess(req.userId!, 'list', listId as string);
      accessCache.set(listId as string, !!level);
    }));
    const visible = rows.filter((t: any) => accessCache.get(t.list_id) === true);

    // Instance stats per template (count + most recent occurrence date).
    const templateIds = visible.map((t: any) => t.id);
    const statsByTemplate = new Map<string, { count: number; last: string | null }>();
    if (templateIds.length > 0) {
      const { data: instances } = await supabaseAdmin
        .from('tasks')
        .select('recurring_parent_id, recurrence_instance_date')
        .in('recurring_parent_id', templateIds);
      for (const inst of (instances || []) as any[]) {
        const cur = statsByTemplate.get(inst.recurring_parent_id) || { count: 0, last: null };
        cur.count++;
        if (inst.recurrence_instance_date && (!cur.last || inst.recurrence_instance_date > cur.last)) {
          cur.last = inst.recurrence_instance_date;
        }
        statsByTemplate.set(inst.recurring_parent_id, cur);
      }
    }

    const today = todayIST();
    const hydrated = await hydrateLists(await hydrateAssignees(visible));
    const result = hydrated.map((t: any) => {
      const stats = statsByTemplate.get(t.id) || { count: 0, last: null };
      // "Next run": first firing date not already materialised.
      const from = stats.last && stats.last >= today
        ? nextDayStr(stats.last)
        : today;
      return {
        ...t,
        instance_count: stats.count,
        last_instance_date: stats.last,
        next_occurrence: t.recurrence_paused
          ? null
          : nextTaskRecurrenceDate(t.recurrence as TaskRecurrence, from),
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Get routines error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

function nextDayStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

async function requireTemplateMemberAccess(req: Request, res: Response, taskId: string): Promise<any | null> {
  const { data: template } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .maybeSingle();
  if (!template || !(template as any).recurrence) {
    res.status(404).json({ success: false, error: 'Routine not found' });
    return null;
  }
  const userLevel = await checkResourceAccess(req.userId!, 'list', (template as any).list_id);
  if (!userLevel || !meetsAccessLevel(userLevel, 'member')) {
    res.status(403).json({ success: false, error: 'Member access required' });
    return null;
  }
  return template;
}

// PATCH /pm/routines/:id — pause/resume spawning for a routine template.
const patchSchema = z.object({ paused: z.boolean() });

router.patch('/routines/:id', async (req: Request, res: Response) => {
  try {
    const { paused } = patchSchema.parse(req.body);
    const template = await requireTemplateMemberAccess(req, res, req.params.id as string);
    if (!template) return;

    const { data, error } = await supabaseAdmin
      .from('tasks')
      .update({ recurrence_paused: paused, last_modified_by: req.userId! })
      .eq('id', template.id)
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
    console.error('Patch routine error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/routines/:id/run — manually materialise today's instance,
// whether or not the rule fires today. Idempotent per (template, date).
router.post('/routines/:id/run', async (req: Request, res: Response) => {
  try {
    const template = await requireTemplateMemberAccess(req, res, req.params.id as string);
    if (!template) return;

    const date = todayIST();
    const outcome = await spawnRoutineInstance(template, date);
    if (outcome === 'error') {
      res.status(500).json({ success: false, error: 'Failed to spawn instance' });
      return;
    }
    res.json({ success: true, data: { date, outcome } });
  } catch (err) {
    console.error('Run routine error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
