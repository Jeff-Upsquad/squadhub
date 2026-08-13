import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireMiniAppOrAdmin } from '../middleware/miniApp';
import { getUserIdsByRoleId } from '../utils/roles';
import { isSupportAgent, ensureChannelMember } from '../utils/supportAccess';
import { supabaseAdmin } from '../supabase';

const router = Router();

const CATEGORIES = ['technical', 'accounts', 'financial', 'general'] as const;
type Category = (typeof CATEGORIES)[number];
const CATEGORY_LABEL: Record<Category, string> = {
  technical: 'Technical',
  accounts: 'Accounts',
  financial: 'Financial',
  general: 'General',
};

// PostgREST embed hints — the FK-named joins to the users table.
const TICKET_SELECT =
  '*, creator:users!support_tickets_created_by_fkey(id, display_name, avatar_url, email), ' +
  'assignee:users!support_tickets_assigned_to_fkey(id, display_name, avatar_url, email)';

// ---- Agent / access helpers ----------------------------------------------

/** May this user see / act on this ticket? Creator, assignee, or any agent. */
async function canAccessTicket(
  userId: string,
  ticket: { created_by: string; assigned_to: string | null },
): Promise<boolean> {
  if (ticket.created_by === userId) return true;
  if (ticket.assigned_to && ticket.assigned_to === userId) return true;
  return isSupportAgent(userId);
}

/** Ensure the one Support channel exists for a workspace; return its id. */
async function ensureSupportChannel(workspaceId: string, userId: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from('channels')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('channel_kind', 'support')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: created, error } = await supabaseAdmin
    .from('channels')
    .insert({
      workspace_id: workspaceId,
      name: 'Support',
      description: 'Raise a support ticket — our team will help you here.',
      is_private: false,
      created_by: userId,
      channel_kind: 'support',
    })
    .select('id')
    .single();
  if (error || !created) throw new Error(error?.message || 'Could not create support channel');
  return created.id;
}

/** Users assignable to tickets: admins + everyone granted the `support` app. */
async function listAgents(): Promise<
  { id: string; display_name: string | null; avatar_url: string | null; email: string | null }[]
> {
  const ids = new Set<string>();

  // Workspace admins.
  const { data: admins } = await supabaseAdmin
    .from('workspace_members')
    .select('user_id')
    .in('role', ['admin', 'super_admin']);
  for (const a of admins || []) if (a.user_id) ids.add(a.user_id as string);

  // Mini-app grants (direct + role-based).
  const { data: app } = await supabaseAdmin
    .from('mini_apps')
    .select('id')
    .eq('slug', 'support')
    .maybeSingle();
  if (app?.id) {
    const { data: direct } = await supabaseAdmin
      .from('mini_app_user_access')
      .select('user_id')
      .eq('mini_app_id', app.id);
    for (const d of direct || []) if (d.user_id) ids.add(d.user_id as string);

    const { data: roleGrants } = await supabaseAdmin
      .from('mini_app_role_access')
      .select('role_id')
      .eq('mini_app_id', app.id);
    for (const rg of roleGrants || []) {
      if (!rg.role_id) continue;
      const roleUserIds = await getUserIdsByRoleId(rg.role_id as string);
      for (const uid of roleUserIds) ids.add(uid);
    }
  }

  if (ids.size === 0) return [];
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, display_name, avatar_url, email')
    .in('id', Array.from(ids));
  return (users || []).sort((a, b) =>
    (a.display_name || a.email || '').localeCompare(b.display_name || b.email || ''),
  );
}

/** The workspace_id from the query, or the caller's own workspace membership. */
async function resolveWorkspaceId(req: Request): Promise<string | null> {
  const fromQuery = req.query.workspace_id as string | undefined;
  if (fromQuery) return fromQuery;
  const { data } = await supabaseAdmin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', req.userId!)
    .maybeSingle();
  return (data?.workspace_id as string) || null;
}

/** Fetch a ticket row (raw, no joins) or null. */
async function getTicketRow(id: string) {
  const { data } = await supabaseAdmin.from('support_tickets').select('*').eq('id', id).maybeSingle();
  return data;
}

/** Best-effort notification insert (the DB→socket bridge emits new_notification). */
async function notify(
  rows: { user_id: string; title: string; body?: string | null }[],
  ticketId: string,
  actorId: string,
  type: string,
): Promise<void> {
  const filtered = rows.filter((r) => r.user_id && r.user_id !== actorId);
  if (!filtered.length) return;
  await supabaseAdmin.from('notifications').insert(
    filtered.map((r) => ({
      user_id: r.user_id,
      type,
      reference_id: ticketId,
      reference_type: 'support_ticket',
      actor_id: actorId,
      title: r.title,
      body: r.body ?? null,
      metadata: { support_ticket_id: ticketId },
    })),
  );
}

// ---- Overview (user-facing channel) --------------------------------------
// Ensures the Support channel and returns the tickets this user may see:
// their own for regular users, all workspace tickets for agents.
router.get('/overview', requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string;
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id query param required' });
      return;
    }
    const channelId = await ensureSupportChannel(workspaceId, req.userId!);
    const agent = await isSupportAgent(req.userId!);
    // Agents converse in the real chat thread, so they need channel access.
    // (Admins already bypass via checkResourceAccess.)
    if (agent) await ensureChannelMember(channelId, req.userId!);

    let q = supabaseAdmin
      .from('support_tickets')
      .select(TICKET_SELECT)
      .eq('workspace_id', workspaceId)
      .order('last_activity_at', { ascending: false });
    if (!agent) q = q.eq('created_by', req.userId!);

    const { data: tickets, error } = await q;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    const open = (tickets || []).filter((t: any) => t.status === 'open');
    const closed = (tickets || []).filter((t: any) => t.status === 'closed');

    // Unread signal for the rail badge = this user's unread support notifications.
    const { count: unread } = await supabaseAdmin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.userId!)
      .eq('reference_type', 'support_ticket')
      .eq('is_read', false);

    res.json({
      success: true,
      data: {
        channel: { id: channelId, name: 'Support', channel_kind: 'support' },
        is_agent: agent,
        unread: unread || 0,
        tickets: { open, closed },
      },
    });
  } catch (err) {
    console.error('Support overview error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- Create a ticket ------------------------------------------------------
const createSchema = z.object({
  workspace_id: z.string().uuid(),
  category: z.enum(CATEGORIES),
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(8000),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

router.post('/tickets', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);
    const channelId = await ensureSupportChannel(body.workspace_id, req.userId!);
    // The creator converses in the real chat thread — grant channel access.
    await ensureChannelMember(channelId, req.userId!);

    // The opening description becomes a top-level channel message; its thread
    // is the conversation.
    const { data: rootMsg, error: msgErr } = await supabaseAdmin
      .from('messages')
      .insert({
        channel_id: channelId,
        sender_id: req.userId,
        content: body.description,
        type: 'text',
        mentions: [],
      })
      .select('id')
      .single();
    if (msgErr || !rootMsg) {
      res.status(500).json({ success: false, error: msgErr?.message || 'Could not open ticket' });
      return;
    }

    // Auto-assign by category routing rule, if one is configured.
    const { data: rule } = await supabaseAdmin
      .from('support_ticket_routing')
      .select('assignee_id')
      .eq('workspace_id', body.workspace_id)
      .eq('category', body.category)
      .maybeSingle();
    const autoAssignee = rule?.assignee_id || null;

    const { data: ticket, error: tErr } = await supabaseAdmin
      .from('support_tickets')
      .insert({
        workspace_id: body.workspace_id,
        channel_id: channelId,
        root_message_id: (rootMsg as any).id,
        category: body.category,
        subject: body.subject,
        priority: body.priority || 'normal',
        created_by: req.userId,
        assigned_to: autoAssignee,
        assigned_at: autoAssignee ? new Date().toISOString() : null,
      })
      .select(TICKET_SELECT)
      .single();
    if (tErr || !ticket) {
      res.status(500).json({ success: false, error: tErr?.message || 'Could not create ticket' });
      return;
    }
    const t = ticket as any;

    if (autoAssignee) {
      await notify(
        [
          {
            user_id: autoAssignee,
            title: `New ${CATEGORY_LABEL[body.category]} ticket assigned to you`,
            body: `SUP-${t.ticket_number}: ${body.subject}`,
          },
        ],
        t.id,
        req.userId!,
        'support_ticket_assigned',
      );
    }

    res.status(201).json({ success: true, data: ticket });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create ticket error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- Single ticket --------------------------------------------------------
router.get('/tickets/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const row = await getTicketRow(String(req.params.id));
    if (!row) {
      res.status(404).json({ success: false, error: 'Ticket not found' });
      return;
    }
    if (!(await canAccessTicket(req.userId!, row))) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }
    const { data: ticket } = await supabaseAdmin
      .from('support_tickets')
      .select(TICKET_SELECT)
      .eq('id', req.params.id)
      .single();
    res.json({ success: true, data: ticket });
  } catch (err) {
    console.error('Get ticket error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- Ticket conversation --------------------------------------------------
// Returns the opening message followed by every thread reply. Scoped per
// ticket so users only ever see their own conversation, never the raw channel.
router.get('/tickets/:id/messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const row = await getTicketRow(String(req.params.id));
    if (!row) {
      res.status(404).json({ success: false, error: 'Ticket not found' });
      return;
    }
    if (!(await canAccessTicket(req.userId!, row))) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }
    if (!row.root_message_id) {
      res.json({ success: true, data: [] });
      return;
    }
    const sel = '*, sender:users!sender_id(id, display_name, avatar_url, email)';
    const { data: root } = await supabaseAdmin
      .from('messages')
      .select(sel)
      .eq('id', row.root_message_id)
      .maybeSingle();
    const { data: replies } = await supabaseAdmin
      .from('messages')
      .select(sel)
      .eq('parent_message_id', row.root_message_id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true });
    const messages = [root, ...(replies || [])].filter(Boolean);
    res.json({ success: true, data: messages });
  } catch (err) {
    console.error('Get ticket messages error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const replySchema = z.object({
  content: z.string().trim().max(8000).optional(),
  type: z.enum(['text', 'image', 'audio', 'video', 'file']).default('text'),
  file_url: z.string().optional(),
  file_name: z.string().optional(),
  file_size: z.number().optional(),
  file_mime: z.string().optional(),
  duration_ms: z.number().optional(),
});

router.post('/tickets/:id/messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = replySchema.parse(req.body);
    if (!body.content && !body.file_url) {
      res.status(400).json({ success: false, error: 'Message content or a file is required' });
      return;
    }
    const row = await getTicketRow(String(req.params.id));
    if (!row) {
      res.status(404).json({ success: false, error: 'Ticket not found' });
      return;
    }
    if (!(await canAccessTicket(req.userId!, row))) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }
    if (!row.root_message_id) {
      res.status(409).json({ success: false, error: 'Ticket has no conversation root' });
      return;
    }

    const insertRow: Record<string, unknown> = {
      channel_id: row.channel_id,
      sender_id: req.userId,
      content: body.content || null,
      type: body.type,
      file_url: body.file_url || null,
      mentions: [],
      parent_message_id: row.root_message_id,
    };
    if (body.file_name) insertRow.file_name = body.file_name;
    if (body.file_size) insertRow.file_size = body.file_size;
    if (body.file_mime) insertRow.file_mime = body.file_mime;
    if (body.duration_ms) insertRow.duration_ms = body.duration_ms;

    const { data: message, error } = await supabaseAdmin
      .from('messages')
      .insert(insertRow)
      .select('*, sender:users!sender_id(id, display_name, avatar_url, email)')
      .single();
    if (error || !message) {
      res.status(500).json({ success: false, error: error?.message || 'Could not send' });
      return;
    }

    // Keep the legacy thread index in sync (mirrors /messages behaviour).
    await supabaseAdmin
      .from('message_threads')
      .insert({ parent_message_id: row.root_message_id, reply_message_id: message.id });

    await supabaseAdmin
      .from('support_tickets')
      .update({ last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', row.id);

    // Real-time to everyone viewing this ticket thread.
    const io = req.app.get('io');
    if (io) io.to(`support_ticket:${row.id}`).emit('support_ticket_message', { ticket_id: row.id, message });

    // Notify the "other side": the creator hears from agents, the assignee (and
    // creator) hear from each other.
    const recipients = new Set<string>();
    if (row.created_by !== req.userId) recipients.add(row.created_by);
    if (row.assigned_to && row.assigned_to !== req.userId) recipients.add(row.assigned_to);
    await notify(
      Array.from(recipients).map((user_id) => ({
        user_id,
        title: `New reply on SUP-${row.ticket_number}`,
        body: body.content ? body.content.slice(0, 140) : 'Sent an attachment',
      })),
      row.id,
      req.userId!,
      'support_ticket_reply',
    );

    res.status(201).json({ success: true, data: message });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Reply ticket error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- Status: close / reopen (creator or agent) ---------------------------
async function setStatus(req: Request, res: Response, status: 'open' | 'closed') {
  const row = await getTicketRow(String(req.params.id));
  if (!row) {
    res.status(404).json({ success: false, error: 'Ticket not found' });
    return;
  }
  if (!(await canAccessTicket(req.userId!, row))) {
    res.status(403).json({ success: false, error: 'Access denied' });
    return;
  }
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    closed_at: status === 'closed' ? new Date().toISOString() : null,
    closed_by: status === 'closed' ? req.userId : null,
  };
  const { data: ticket, error } = await supabaseAdmin
    .from('support_tickets')
    .update(patch)
    .eq('id', row.id)
    .select(TICKET_SELECT)
    .single();
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  const io = req.app.get('io');
  if (io) io.to(`support_ticket:${row.id}`).emit('support_ticket_updated', { ticket_id: row.id, status });
  res.json({ success: true, data: ticket });
}

router.post('/tickets/:id/close', requireAuth, (req, res) => setStatus(req, res, 'closed'));
router.post('/tickets/:id/reopen', requireAuth, (req, res) => setStatus(req, res, 'open'));

// Mark this ticket's notifications read for the caller — clears the rail badge
// when a ticket thread is opened (mirrors chat's read-on-open behaviour).
router.post('/tickets/:id/read', requireAuth, async (req: Request, res: Response) => {
  try {
    await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', req.userId!)
      .eq('reference_type', 'support_ticket')
      .eq('reference_id', String(req.params.id))
      .eq('is_read', false);
    res.json({ success: true });
  } catch (err) {
    console.error('Mark ticket read error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ==========================================================================
// Agent / admin triage — gated by the `support` mini app (or admin).
// ==========================================================================

// Full ticket list with filters — the management queue.
router.get('/tickets', requireAuth, requireMiniAppOrAdmin('support'), async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id could not be resolved' });
      return;
    }
    let q = supabaseAdmin
      .from('support_tickets')
      .select(TICKET_SELECT)
      .eq('workspace_id', workspaceId)
      .order('last_activity_at', { ascending: false });

    const status = req.query.status as string | undefined;
    if (status === 'open' || status === 'closed') q = q.eq('status', status);
    const category = req.query.category as string | undefined;
    if (category && (CATEGORIES as readonly string[]).includes(category)) q = q.eq('category', category);
    const assignee = req.query.assignee as string | undefined;
    if (assignee === 'unassigned') q = q.is('assigned_to', null);
    else if (assignee === 'me') q = q.eq('assigned_to', req.userId!);
    else if (assignee) q = q.eq('assigned_to', assignee);

    const { data, error } = await q;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('List tickets error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Assignable agents.
router.get('/agents', requireAuth, requireMiniAppOrAdmin('support'), async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await listAgents() });
  } catch (err) {
    console.error('List agents error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Assign / reassign / unassign a ticket.
async function assignTicket(req: Request, res: Response, assigneeId: string | null) {
  const row = await getTicketRow(String(req.params.id));
  if (!row) {
    res.status(404).json({ success: false, error: 'Ticket not found' });
    return;
  }
  const { data: ticket, error } = await supabaseAdmin
    .from('support_tickets')
    .update({
      assigned_to: assigneeId,
      assigned_by: assigneeId ? req.userId : null,
      assigned_at: assigneeId ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .select(TICKET_SELECT)
    .single();
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  if (assigneeId) {
    // The assignee replies in the real chat thread — grant channel access.
    await ensureChannelMember(row.channel_id, assigneeId);
    await notify(
      [
        {
          user_id: assigneeId,
          title: `Ticket SUP-${row.ticket_number} assigned to you`,
          body: row.subject,
        },
      ],
      row.id,
      req.userId!,
      'support_ticket_assigned',
    );
  }
  const io = req.app.get('io');
  if (io) io.to(`support_ticket:${row.id}`).emit('support_ticket_updated', { ticket_id: row.id, assigned_to: assigneeId });
  res.json({ success: true, data: ticket });
}

// Claim = assign to self (the manual pick-up-a-pending-ticket flow).
router.post('/tickets/:id/claim', requireAuth, requireMiniAppOrAdmin('support'), (req, res) =>
  assignTicket(req, res, req.userId!),
);

const assignSchema = z.object({ assignee_id: z.string().uuid().nullable() });
router.post('/tickets/:id/assign', requireAuth, requireMiniAppOrAdmin('support'), (req, res) => {
  try {
    const { assignee_id } = assignSchema.parse(req.body);
    return assignTicket(req, res, assignee_id);
  } catch {
    res.status(400).json({ success: false, error: 'assignee_id (uuid or null) required' });
  }
});

// ---- Auto-assign routing config ------------------------------------------
router.get('/routing', requireAuth, requireMiniAppOrAdmin('support'), async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id could not be resolved' });
      return;
    }
    const { data } = await supabaseAdmin
      .from('support_ticket_routing')
      .select('category, assignee_id, assignee:users!support_ticket_routing_assignee_id_fkey(id, display_name, avatar_url, email)')
      .eq('workspace_id', workspaceId);
    const byCat = new Map((data || []).map((r: any) => [r.category, r]));
    const rules = CATEGORIES.map((category) => {
      const r = byCat.get(category) as any;
      return { category, assignee_id: r?.assignee_id ?? null, assignee: r?.assignee ?? null };
    });
    res.json({ success: true, data: rules });
  } catch (err) {
    console.error('Get routing error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const routingSchema = z.object({
  workspace_id: z.string().uuid().optional(),
  rules: z.array(
    z.object({ category: z.enum(CATEGORIES), assignee_id: z.string().uuid().nullable() }),
  ),
});

router.put('/routing', requireAuth, requireMiniAppOrAdmin('support'), async (req: Request, res: Response) => {
  try {
    const body = routingSchema.parse(req.body);
    const workspaceId = body.workspace_id || (await resolveWorkspaceId(req));
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id could not be resolved' });
      return;
    }
    for (const rule of body.rules) {
      if (rule.assignee_id) {
        await supabaseAdmin
          .from('support_ticket_routing')
          .upsert(
            {
              workspace_id: workspaceId,
              category: rule.category,
              assignee_id: rule.assignee_id,
              updated_by: req.userId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'workspace_id,category' },
          );
      } else {
        await supabaseAdmin
          .from('support_ticket_routing')
          .delete()
          .eq('workspace_id', workspaceId)
          .eq('category', rule.category);
      }
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Put routing error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
