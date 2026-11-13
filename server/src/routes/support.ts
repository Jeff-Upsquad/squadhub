import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireMiniAppOrAdmin } from '../middleware/miniApp';
import { getUserIdsByRoleId } from '../utils/roles';
import { isSupportAgent, ensureChannelMember } from '../utils/supportAccess';
import { supabaseAdmin } from '../supabase';
import { SAAS_REQUESTER_USER_ID, notifySaasIfExternalTicket } from '../utils/saasSupport';

const router = Router();

/**
 * A failure whose message the HTTP routes have always returned verbatim (DB
 * insert errors on create/reply). Anything else stays a generic 500, exactly
 * as before the create/reply logic moved into the shared *Core helpers.
 */
export class SupportCoreError extends Error {}

function exposedError(err: unknown): string {
  return err instanceof SupportCoreError ? err.message : 'Internal server error';
}

export const CATEGORIES = ['technical', 'accounts', 'financial', 'general'] as const;
export type Category = (typeof CATEGORIES)[number];
const CATEGORY_LABEL: Record<Category, string> = {
  technical: 'Technical',
  accounts: 'Accounts',
  financial: 'Financial',
  general: 'General',
};

// PostgREST embed hints — the FK-named joins to the users table.
export const TICKET_SELECT =
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
export async function ensureSupportChannel(workspaceId: string, userId: string): Promise<string> {
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
export async function getTicketRow(id: string) {
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
  // The SaaS requester proxy is a placeholder, not a person — never notify it
  // (the SaaS user is notified via the bridge instead).
  const filtered = rows.filter(
    (r) => r.user_id && r.user_id !== actorId && r.user_id !== SAAS_REQUESTER_USER_ID,
  );
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

export interface CreateTicketCoreInput {
  workspaceId: string;
  creatorId: string;
  category: Category;
  subject: string;
  description: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  /** Set for tickets raised from Squad Hub SaaS over the bridge. */
  externalRequesterId?: string | null;
  /** Optional messages.metadata on the opening message (bridge requester info). */
  rootMetadata?: Record<string, unknown> | null;
}

/**
 * Open a ticket: the description becomes a top-level Support-channel message
 * (its thread is the conversation), the ticket row is numbered by trigger, and
 * the category routing rule auto-assigns + notifies. Shared by POST /tickets
 * and the SaaS bridge (POST /bridge/v1/support/tickets). Throws on failure.
 */
export async function createSupportTicketCore(input: CreateTicketCoreInput): Promise<any> {
  const channelId = await ensureSupportChannel(input.workspaceId, input.creatorId);
  // The creator converses in the real chat thread — grant channel access.
  // (Not for the SaaS requester proxy: it never signs in.)
  if (input.creatorId !== SAAS_REQUESTER_USER_ID) {
    await ensureChannelMember(channelId, input.creatorId);
  }

  // The opening description becomes a top-level channel message; its thread
  // is the conversation.
  const rootInsert: Record<string, unknown> = {
    channel_id: channelId,
    sender_id: input.creatorId,
    content: input.description,
    type: 'text',
    mentions: [],
  };
  if (input.rootMetadata) rootInsert.metadata = input.rootMetadata;
  const { data: rootMsg, error: msgErr } = await supabaseAdmin
    .from('messages')
    .insert(rootInsert)
    .select('id')
    .single();
  if (msgErr || !rootMsg) throw new SupportCoreError(msgErr?.message || 'Could not open ticket');

  // Auto-assign by category routing rule, if one is configured.
  const { data: rule } = await supabaseAdmin
    .from('support_ticket_routing')
    .select('assignee_id')
    .eq('workspace_id', input.workspaceId)
    .eq('category', input.category)
    .maybeSingle();
  const autoAssignee = rule?.assignee_id || null;

  const ticketInsert: Record<string, unknown> = {
    workspace_id: input.workspaceId,
    channel_id: channelId,
    root_message_id: (rootMsg as any).id,
    category: input.category,
    subject: input.subject,
    priority: input.priority || 'normal',
    created_by: input.creatorId,
    assigned_to: autoAssignee,
    assigned_at: autoAssignee ? new Date().toISOString() : null,
  };
  if (input.externalRequesterId) ticketInsert.external_requester_id = input.externalRequesterId;
  const { data: ticket, error: tErr } = await supabaseAdmin
    .from('support_tickets')
    .insert(ticketInsert)
    .select(TICKET_SELECT)
    .single();
  if (tErr || !ticket) throw new SupportCoreError(tErr?.message || 'Could not create ticket');
  const t = ticket as any;

  if (autoAssignee) {
    await notify(
      [
        {
          user_id: autoAssignee,
          title: `New ${CATEGORY_LABEL[input.category]} ticket assigned to you`,
          body: `SUP-${t.ticket_number}: ${input.subject}`,
        },
      ],
      t.id,
      input.creatorId,
      'support_ticket_assigned',
    );
  }
  return ticket;
}

router.post('/tickets', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);
    const ticket = await createSupportTicketCore({
      workspaceId: body.workspace_id,
      creatorId: req.userId!,
      category: body.category,
      subject: body.subject,
      description: body.description,
      priority: body.priority,
    });
    res.status(201).json({ success: true, data: ticket });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create ticket error:', err);
    res.status(500).json({ success: false, error: exposedError(err) });
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

export const replySchema = z.object({
  content: z.string().trim().max(8000).optional(),
  type: z.enum(['text', 'image', 'audio', 'video', 'file']).default('text'),
  file_url: z.string().optional(),
  file_name: z.string().optional(),
  file_size: z.number().optional(),
  file_mime: z.string().optional(),
  duration_ms: z.number().optional(),
});

export type TicketReplyBody = z.infer<typeof replySchema>;

/**
 * Post a reply into a ticket's thread: inserts the thread message, keeps the
 * legacy thread index + ticket activity in sync, emits realtime, notifies the
 * other side, and — for tickets raised from Squad Hub SaaS — tells the SaaS so
 * the requester gets an in-app notification. Shared by
 * POST /tickets/:id/messages and the SaaS bridge. Throws on failure.
 */
export async function postSupportTicketReplyCore(input: {
  row: any;
  senderId: string;
  body: TicketReplyBody;
  metadata?: Record<string, unknown> | null;
  io?: any;
}): Promise<any> {
  const { row, senderId, body } = input;
  if (!row.root_message_id) throw new SupportCoreError('Ticket has no conversation root');

  const insertRow: Record<string, unknown> = {
    channel_id: row.channel_id,
    sender_id: senderId,
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
  if (input.metadata) insertRow.metadata = input.metadata;

  const { data: message, error } = await supabaseAdmin
    .from('messages')
    .insert(insertRow)
    .select('*, sender:users!sender_id(id, display_name, avatar_url, email)')
    .single();
  if (error || !message) throw new SupportCoreError(error?.message || 'Could not send');

  // Keep the legacy thread index in sync (mirrors /messages behaviour).
  await supabaseAdmin
    .from('message_threads')
    .insert({ parent_message_id: row.root_message_id, reply_message_id: message.id });

  await supabaseAdmin
    .from('support_tickets')
    .update({ last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', row.id);

  // Real-time to everyone viewing this ticket thread.
  if (input.io) input.io.to(`support_ticket:${row.id}`).emit('support_ticket_message', { ticket_id: row.id, message });

  // Notify the "other side": the creator hears from agents, the assignee (and
  // creator) hear from each other.
  const recipients = new Set<string>();
  if (row.created_by !== senderId) recipients.add(row.created_by);
  if (row.assigned_to && row.assigned_to !== senderId) recipients.add(row.assigned_to);
  await notify(
    Array.from(recipients).map((user_id) => ({
      user_id,
      title: `New reply on SUP-${row.ticket_number}`,
      body: body.content ? body.content.slice(0, 140) : 'Sent an attachment',
    })),
    row.id,
    senderId,
    'support_ticket_reply',
  );

  // Bridge-created ticket + an agent (not the requester) replied → SaaS notify.
  notifySaasIfExternalTicket({
    ticketId: row.id,
    senderId,
    preview: body.content ? body.content.slice(0, 140) : 'Sent an attachment',
  });

  return message;
}

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
    const message = await postSupportTicketReplyCore({
      row,
      senderId: req.userId!,
      body,
      io: req.app.get('io'),
    });
    res.status(201).json({ success: true, data: message });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Reply ticket error:', err);
    res.status(500).json({ success: false, error: exposedError(err) });
  }
});

// ---- Status: close / reopen (creator or agent) ---------------------------
/** Close / reopen a ticket and broadcast the change. Throws on failure. */
export async function setSupportTicketStatusCore(
  row: any,
  status: 'open' | 'closed',
  actorId: string,
  io?: any,
): Promise<any> {
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    closed_at: status === 'closed' ? new Date().toISOString() : null,
    closed_by: status === 'closed' ? actorId : null,
  };
  const { data: ticket, error } = await supabaseAdmin
    .from('support_tickets')
    .update(patch)
    .eq('id', row.id)
    .select(TICKET_SELECT)
    .single();
  if (error) throw new Error(error.message);
  if (io) io.to(`support_ticket:${row.id}`).emit('support_ticket_updated', { ticket_id: row.id, status });
  return ticket;
}

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
  try {
    const ticket = await setSupportTicketStatusCore(row, status, req.userId!, req.app.get('io'));
    res.json({ success: true, data: ticket });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
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

    // Broadcast so every device (web badge, mobile inbox) catches up instantly.
    const io = req.app.get('io');
    if (io) io.to(`chat_user:${req.userId!}`).emit('notifications_read', { kind: 'all' });

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
