import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '../supabase';
import { config } from '../config';
import { logTaskActivity } from '../utils/taskActivity';

// ============================================================
// Build Agent bridge API
//
// Machine-to-machine endpoints used by an external build agent
// (ZCode automation on a dev Mac today; a VPS runner later) to
// consume SquadHub tasks as a build queue. This is the stable
// contract between SquadHub and any executor:
//
//   GET  /agent/ready-tasks        tasks with status 'ready_to_code'
//   POST /agent/tasks/:id/claim    atomically ready_to_code → in_progress
//   POST /agent/tasks/:id/status   lifecycle status write (validated)
//   POST /agent/tasks/:id/comment  progress / completion notes
//   GET  /agent/tasks/:id          single task refresh
//
// Auth is a static bearer token (AGENT_API_TOKEN env), NOT a user
// JWT — the agent has no Supabase account. When AGENT_API_TOKEN is
// unset every endpoint returns 503, so dev boxes without wiring are
// closed by default. Comments/activity attribution uses AGENT_USER_ID
// (a dedicated "Build Agent" user row) when configured.
// ============================================================

const router = Router();

// Statuses the agent may set via /status. Everything else in the catalog
// (triage, priorities, routines) is human-owned. 'follow_ups' is the
// waiting-for-a-human-reply state used by the ask-in-comments loop.
const AGENT_STATUSES = [
  'in_progress',
  'in_code_review',
  'testing_qa',
  'ready_for_deploy',
  'blocked',
  'closed',
  'follow_ups',
] as const;

const statusSchema = z.object({
  status: z.enum(AGENT_STATUSES),
  note: z.string().max(2000).optional(),
  // true → stamp metadata.agent_awaiting_since (marking "I asked a question in
  // comments, waiting for the human"); false/omitted with status follow_ups
  // clears it. The awaiting-reply queue only surfaces tasks with the stamp.
  awaiting_reply: z.boolean().optional(),
});

const commentSchema = z.object({
  content: z.string().min(1).max(5000),
});

function requireAgentToken(req: Request, res: Response, next: NextFunction): void {
  if (!config.agentApiToken) {
    res.status(503).json({ success: false, error: 'Agent API is not configured (AGENT_API_TOKEN unset)' });
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing or invalid authorization header' });
    return;
  }
  const token = authHeader.split(' ')[1];
  const expected = Buffer.from(config.agentApiToken);
  const provided = Buffer.from(token);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    res.status(401).json({ success: false, error: 'Invalid agent token' });
    return;
  }
  next();
}

router.use(requireAgentToken);

interface AgentTaskAttachment {
  id: string;
  file_name: string;
  mime_type: string;
  file_size: number | null;
  url: string;
}

interface AgentTaskPayload {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  created_at: string;
  list: { id: string; name: string } | null;
  folder: { id: string; name: string } | null;
  space: { id: string; name: string } | null;
  // Part of the brief: the executor downloads and inspects these (public R2
  // URLs, same ones the app uses) when deciding what to do with the task.
  attachments: AgentTaskAttachment[];
}

// Resolve list/folder/space names and attachments for a set of tasks in bulk.
// Done as separate queries (not embeds) to avoid FK-ambiguity with the
// task_list_links junction, mirroring how pm/tasks.ts resolves paths.
async function hydrateListPaths(
  tasks: Array<Record<string, any>>,
): Promise<AgentTaskPayload[]> {
  const listIds = Array.from(new Set(tasks.map((t) => t.list_id).filter(Boolean)));
  const listById = new Map<string, any>();

  if (listIds.length) {
    const { data: lists } = await supabaseAdmin
      .from('lists')
      .select('id, name, folder_id, folders(id, name), spaces(id, name)')
      .in('id', listIds);
    for (const l of lists || []) listById.set(l.id, l);
  }

  const taskIds = tasks.map((t) => t.id);
  const attachmentsByTask = new Map<string, AgentTaskAttachment[]>();
  if (taskIds.length) {
    const { data: attachments } = await supabaseAdmin
      .from('task_attachments')
      .select('id, task_id, file_name, mime_type, file_size, file_url')
      .in('task_id', taskIds)
      .order('uploaded_at', { ascending: true });
    for (const a of attachments || []) {
      const list = attachmentsByTask.get(a.task_id) || [];
      list.push({ id: a.id, file_name: a.file_name, mime_type: a.mime_type, file_size: a.file_size, url: a.file_url });
      attachmentsByTask.set(a.task_id, list);
    }
  }

  return tasks.map((t) => {
    const list = listById.get(t.list_id);
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      due_date: t.due_date,
      created_at: t.created_at,
      list: list ? { id: list.id, name: list.name } : null,
      folder: list?.folders ? { id: list.folders.id, name: list.folders.name } : null,
      space: list?.spaces ? { id: list.spaces.id, name: list.spaces.name } : null,
      attachments: attachmentsByTask.get(t.id) || [],
    };
  });
}

// GET /agent/ready-tasks — the build queue. Routine templates and subtasks
// are excluded (same visibility rules as list views). Panel-dispatched tasks
// (metadata.build_requested_at, newest first) jump ahead of the usual
// oldest-first ordering.
router.get('/ready-tasks', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 25, 100);
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('status', 'ready_to_code')
      .is('recurrence', null)
      .is('parent_task_id', null)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const rows = (data || []).slice().sort((a: any, b: any) => {
      const da = a?.metadata?.build_requested_at ? Date.parse(a.metadata.build_requested_at) : 0;
      const db = b?.metadata?.build_requested_at ? Date.parse(b.metadata.build_requested_at) : 0;
      if (da !== db) return db - da; // dispatched first, newest dispatch first
      return Date.parse(a.created_at) - Date.parse(b.created_at); // then oldest task
    });

    res.json({ success: true, data: await hydrateListPaths(rows) });
  } catch (err) {
    console.error('Agent ready-tasks error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /agent/tasks/:id — refresh a claimed task mid-run.
router.get('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('id', req.params.id as string)
      .maybeSingle();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    res.json({ success: true, data: (await hydrateListPaths([data]))[0] });
  } catch (err) {
    console.error('Agent task fetch error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /agent/tasks/:id/claim — the lock. The status guard makes the
// transition atomic: if another executor claimed first, zero rows match
// and this returns 409 instead of double-building.
router.post('/tasks/:id/claim', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .update({ status: 'in_progress' })
      .eq('id', req.params.id as string)
      .eq('status', 'ready_to_code')
      .select('id')
      .maybeSingle();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!data) {
      res.status(409).json({ success: false, error: 'Task is not in ready_to_code (already claimed or changed)' });
      return;
    }

    await logAgentActivity(req.params.id as string, 'ready_to_code', 'in_progress');

    const { data: task, error: taskError } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('id', req.params.id as string)
      .maybeSingle();

    if (taskError || !task) {
      res.status(500).json({ success: false, error: 'Claimed but failed to re-fetch task' });
      return;
    }

    res.json({ success: true, data: (await hydrateListPaths([task]))[0] });
  } catch (err) {
    console.error('Agent claim error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// For each task id, find the bot's last comment (the open question) and the
// latest human comment after it (the reply), if any. Requires agentUserId.
async function latestExchanges(
  taskIds: string[],
): Promise<Map<string, { question: string | null; reply: { content: string; created_at: string } | null }>> {
  const out = new Map<string, { question: string | null; reply: { content: string; created_at: string } | null }>();
  if (!config.agentUserId || !taskIds.length) {
    for (const id of taskIds) out.set(id, { question: null, reply: null });
    return out;
  }

  const { data: comments } = await supabaseAdmin
    .from('task_comments')
    .select('task_id, user_id, content, created_at')
    .in('task_id', taskIds)
    .order('created_at', { ascending: true });

  const byTask = new Map<string, any[]>();
  for (const c of comments || []) {
    const list = byTask.get(c.task_id) || [];
    list.push(c);
    byTask.set(c.task_id, list);
  }

  for (const id of taskIds) {
    const list = byTask.get(id) || [];
    let question: string | null = null;
    let questionAt: string | null = null;
    for (const c of list) {
      if (c.user_id === config.agentUserId) {
        question = c.content;
        questionAt = c.created_at;
      }
    }
    let reply: { content: string; created_at: string } | null = null;
    if (questionAt) {
      for (const c of list) {
        if (c.user_id !== config.agentUserId && c.created_at > questionAt) {
          reply = { content: c.content, created_at: c.created_at };
        }
      }
    }
    out.set(id, { question, reply });
  }
  return out;
}

// GET /agent/awaiting-reply — tasks the agent parked in follow_ups with a
// pending question, where a human has since replied in comments. Replies
// outrank new work: the SOP serves this queue before ready-tasks.
router.get('/awaiting-reply', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 25, 100);
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('status', 'follow_ups')
      .not('metadata->agent_awaiting_since', 'is', null)
      .is('recurrence', null)
      .is('parent_task_id', null)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const rows = data || [];
    const exchanges = await latestExchanges(rows.map((t: any) => t.id));
    const withReplies = rows.filter((t: any) => exchanges.get(t.id)?.reply);
    const hydrated = await hydrateListPaths(withReplies);

    res.json({
      success: true,
      data: hydrated.map((t, i) => ({
        ...t,
        question: exchanges.get(withReplies[i].id)?.question,
        reply: exchanges.get(withReplies[i].id)?.reply,
      })),
    });
  } catch (err) {
    console.error('Agent awaiting-reply error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /agent/tasks/:id/claim-reply — the reply-side lock. Atomically moves
// follow_ups → in_progress and clears the awaiting stamp; a second executor
// gets 409. Returns the task with the question + the human reply.
router.post('/tasks/:id/claim-reply', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;

    const { data: task } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .maybeSingle();
    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }
    if (task.status !== 'follow_ups' || !task.metadata?.agent_awaiting_since) {
      res.status(409).json({ success: false, error: 'Task is not awaiting a reply' });
      return;
    }

    const { data: updated, error } = await supabaseAdmin
      .from('tasks')
      .update({
        status: 'in_progress',
        metadata: { ...((task.metadata as Record<string, unknown>) || {}), agent_awaiting_since: null },
      })
      .eq('id', taskId)
      .eq('status', 'follow_ups')
      .select('id')
      .maybeSingle();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!updated) {
      res.status(409).json({ success: false, error: 'Task is not awaiting a reply (already claimed)' });
      return;
    }

    await logAgentActivity(taskId, 'follow_ups', 'in_progress', 'reply received, re-claimed');

    const [exchange] = [...(await latestExchanges([taskId])).values()];
    const [hydrated] = await hydrateListPaths([{ ...task, status: 'in_progress' }]);

    res.json({ success: true, data: { ...hydrated, question: exchange?.question, reply: exchange?.reply } });
  } catch (err) {
    console.error('Agent claim-reply error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /agent/tasks/:id/status — lifecycle write. 'closed' fires the same
// DB completion trigger a human status change does (notify_task_completed).
router.post('/tasks/:id/status', async (req: Request, res: Response) => {
  try {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }
    const { status, note, awaiting_reply } = parsed.data;

    const { data: existing } = await supabaseAdmin
      .from('tasks')
      .select('id, status, metadata')
      .eq('id', req.params.id as string)
      .maybeSingle();
    if (!existing) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    const patch: Record<string, unknown> = { status };
    if (awaiting_reply === true || (status === 'follow_ups' && awaiting_reply !== false)) {
      patch.metadata = {
        ...((existing.metadata as Record<string, unknown>) || {}),
        agent_awaiting_since: new Date().toISOString(),
      };
    } else if (awaiting_reply === false && existing.metadata?.agent_awaiting_since) {
      patch.metadata = {
        ...((existing.metadata as Record<string, unknown>) || {}),
        agent_awaiting_since: null,
      };
    }

    const { error } = await supabaseAdmin
      .from('tasks')
      .update(patch)
      .eq('id', req.params.id as string);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    await logAgentActivity(req.params.id as string, existing.status, status, note);

    res.json({ success: true, data: { id: req.params.id, status } });
  } catch (err) {
    console.error('Agent status error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /agent/tasks/:id/comment — progress / completion notes on the task
// feed. Requires AGENT_USER_ID so the comment renders as a real user
// ("Build Agent") instead of an orphan row.
router.post('/tasks/:id/comment', async (req: Request, res: Response) => {
  try {
    if (!config.agentUserId) {
      res.status(400).json({
        success: false,
        error: 'AGENT_USER_ID is not configured — create a dedicated Build Agent user and set its UUID',
      });
      return;
    }

    const parsed = commentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }

    const { data: task } = await supabaseAdmin
      .from('tasks')
      .select('id')
      .eq('id', req.params.id as string)
      .maybeSingle();
    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('task_comments')
      .insert({
        task_id: req.params.id,
        user_id: config.agentUserId,
        content: parsed.data.content.trim(),
        mentions: [],
      })
      .select('id, created_at')
      .single();

    if (error) {
      // Most likely an FK violation from a stale/incorrect AGENT_USER_ID.
      res.status(400).json({ success: false, error: error.message });
      return;
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('Agent comment error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

async function logAgentActivity(taskId: string, fromStatus: string, toStatus: string, note?: string): Promise<void> {
  if (!config.agentUserId) return;
  try {
    await logTaskActivity(taskId, config.agentUserId, [
      {
        event_type: 'agent_status_changed',
        field: 'status',
        old_value: fromStatus,
        new_value: note ? `${toStatus} (${note})` : toStatus,
      },
    ]);
  } catch (err) {
    // Activity logging is best-effort — never fail a status write for it.
    console.error('Agent activity log error:', err);
  }
}

export default router;
