// ============================================================
// Bridge — support tickets from Squad Hub SaaS.
//
//   POST /bridge/v1/support/tickets                    create → {ticket_id, ticket_number}
//   GET  /bridge/v1/support/tickets?saas_user_id=      a SaaS user's tickets
//   GET  /bridge/v1/support/tickets/:id/messages       ticket thread
//   POST /bridge/v1/support/tickets/:id/messages       reply from the SaaS user
//   POST /bridge/v1/support/tickets/:id/close | /reopen
//
// Tickets land in the existing help desk (Support channel thread, numbered
// SUP-n, category routing + agent notifications) through the SAME cores the
// /support routes use. Only bridge-created tickets (external_requester_id set)
// are reachable here — internal tickets are invisible to the SaaS.
// ============================================================
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import {
  CATEGORIES,
  createSupportTicketCore,
  getTicketRow,
  postSupportTicketReplyCore,
  setSupportTicketStatusCore,
} from '../support';
import {
  SAAS_REQUESTER_USER_ID,
  ensureExternalRequester,
  requesterMessageMetadata,
  resolveRequesterActor,
  resolveSupportWorkspaceId,
} from '../../utils/saasSupport';

const router = Router();

const attachmentSchema = z.object({
  url: z.string().url(),
  name: z.string().max(300).optional(),
  size: z.number().int().nonnegative().optional(),
  mime: z.string().max(200).optional(),
});

const createSchema = z.object({
  saas_account_id: z.string().min(1).max(200),
  saas_user: z.object({
    id: z.string().min(1).max(200),
    email: z.string().email(),
    name: z.string().trim().min(1).max(200),
  }),
  hub_user_id: z.string().uuid().nullable().optional(),
  category: z.enum(CATEGORIES),
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(8000),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  attachments: z.array(attachmentSchema).max(10).optional(),
});

const replySchema = z.object({
  saas_user_id: z.string().min(1).max(200),
  content: z.string().trim().max(8000).optional(),
  attachments: z.array(attachmentSchema).max(10).optional(),
});

const actorSchema = z.object({ saas_user_id: z.string().min(1).max(200) });

function attachmentType(mime?: string): 'image' | 'audio' | 'video' | 'file' {
  if (!mime) return 'file';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

function zodError(res: Response, err: z.ZodError) {
  res.status(400).json({ success: false, error: err.errors[0]?.message || 'Invalid body' });
}

/** Load a bridge ticket + its requester, enforcing the SaaS user owns it. */
async function loadExternalTicket(
  ticketId: string,
  saasUserId: string | null,
  res: Response,
): Promise<{ row: any; requester: any } | null> {
  if (!z.string().uuid().safeParse(ticketId).success) {
    res.status(404).json({ success: false, error: 'Ticket not found' });
    return null;
  }
  const row = await getTicketRow(ticketId);
  if (!row || !row.external_requester_id) {
    res.status(404).json({ success: false, error: 'Ticket not found' });
    return null;
  }
  const { data: requester } = await supabaseAdmin
    .from('support_external_requesters')
    .select('*')
    .eq('id', row.external_requester_id)
    .maybeSingle();
  if (!requester) {
    res.status(404).json({ success: false, error: 'Ticket not found' });
    return null;
  }
  if (saasUserId && requester.saas_user_id !== saasUserId) {
    res.status(403).json({ success: false, error: 'Ticket belongs to another user' });
    return null;
  }
  return { row, requester };
}

function shapeTicket(t: any) {
  return {
    ticket_id: t.id,
    ticket_number: t.ticket_number,
    ticket_code: `SUP-${t.ticket_number}`,
    category: t.category,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    assignee_name: t.assignee?.display_name ?? null,
    created_at: t.created_at,
    last_activity_at: t.last_activity_at,
    closed_at: t.closed_at,
  };
}

// ---- Create ---------------------------------------------------------------
router.post('/support/tickets', async (req: Request, res: Response) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed.error);
    const body = parsed.data;

    const requester = await ensureExternalRequester({
      saas_user_id: body.saas_user.id,
      saas_account_id: body.saas_account_id,
      email: body.saas_user.email,
      name: body.saas_user.name,
      hub_user_id: body.hub_user_id ?? null,
    });
    const actorId = await resolveRequesterActor(requester);
    const workspaceId = await resolveSupportWorkspaceId(actorId === SAAS_REQUESTER_USER_ID ? null : actorId);

    // The desk shows the creator's Hub name; for the proxy that's the generic
    // "Squad Hub app user", so lead the description with who really wrote it.
    const description =
      actorId === SAAS_REQUESTER_USER_ID
        ? `From ${body.saas_user.name} (${body.saas_user.email}) via the Squad Hub app\n\n${body.body}`
        : body.body;
    const metadata = requesterMessageMetadata(requester);

    const ticket = await createSupportTicketCore({
      workspaceId,
      creatorId: actorId,
      category: body.category,
      subject: body.subject,
      description,
      priority: body.priority,
      externalRequesterId: requester.id,
      rootMetadata: metadata,
    });

    // Attachments ride in the thread as file messages from the requester.
    const io = req.app.get('io');
    const row = await getTicketRow(ticket.id);
    for (const a of body.attachments || []) {
      await postSupportTicketReplyCore({
        row,
        senderId: actorId,
        body: {
          type: attachmentType(a.mime),
          file_url: a.url,
          file_name: a.name,
          file_size: a.size,
          file_mime: a.mime,
        },
        metadata,
        io,
      }).catch((err) => console.error('[bridge] ticket attachment failed:', err?.message));
    }

    res.status(201).json({
      success: true,
      data: { ticket_id: ticket.id, ticket_number: ticket.ticket_number, ticket_code: `SUP-${ticket.ticket_number}` },
    });
  } catch (err: any) {
    console.error('[bridge] create ticket error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ---- List a user's tickets ------------------------------------------------
router.get('/support/tickets', async (req: Request, res: Response) => {
  try {
    const saasUserId = typeof req.query.saas_user_id === 'string' ? req.query.saas_user_id : '';
    if (!saasUserId) {
      res.status(400).json({ success: false, error: 'saas_user_id query param required' });
      return;
    }
    const { data: requester } = await supabaseAdmin
      .from('support_external_requesters')
      .select('id')
      .eq('saas_user_id', saasUserId)
      .maybeSingle();
    if (!requester) {
      res.json({ success: true, data: [] });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('support_tickets')
      .select('*, assignee:users!support_tickets_assigned_to_fkey(id, display_name)')
      .eq('external_requester_id', requester.id)
      .order('last_activity_at', { ascending: false });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: (data || []).map(shapeTicket) });
  } catch (err: any) {
    console.error('[bridge] list tickets error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ---- Thread ---------------------------------------------------------------
router.get('/support/tickets/:id/messages', async (req: Request, res: Response) => {
  try {
    const saasUserId = typeof req.query.saas_user_id === 'string' ? req.query.saas_user_id : null;
    const loaded = await loadExternalTicket(String(req.params.id), saasUserId, res);
    if (!loaded) return;
    const { row, requester } = loaded;
    if (!row.root_message_id) {
      res.json({ success: true, data: { ticket: shapeTicket(row), messages: [] } });
      return;
    }
    const sel =
      'id, sender_id, content, type, file_url, file_name, file_size, file_mime, duration_ms, created_at, metadata, sender:users!sender_id(id, display_name, avatar_url)';
    const [{ data: root }, { data: replies }] = await Promise.all([
      supabaseAdmin.from('messages').select(sel).eq('id', row.root_message_id).maybeSingle(),
      supabaseAdmin
        .from('messages')
        .select(sel)
        .eq('parent_message_id', row.root_message_id)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true }),
    ]);
    const messages = [root, ...(replies || [])].filter(Boolean).map((m: any) => {
      const fromRequester =
        m.sender_id === SAAS_REQUESTER_USER_ID ||
        (!!requester.hub_user_id && m.sender_id === requester.hub_user_id) ||
        !!m.metadata?.saas_requester;
      return {
        id: m.id,
        content: m.content,
        type: m.type,
        file_url: m.file_url,
        file_name: m.file_name ?? null,
        file_size: m.file_size ?? null,
        file_mime: m.file_mime ?? null,
        duration_ms: m.duration_ms ?? null,
        created_at: m.created_at,
        author: fromRequester
          ? { kind: 'requester', name: requester.name ?? null, avatar_url: null }
          : { kind: 'agent', name: m.sender?.display_name ?? 'Support', avatar_url: m.sender?.avatar_url ?? null },
      };
    });
    const { data: full } = await supabaseAdmin
      .from('support_tickets')
      .select('*, assignee:users!support_tickets_assigned_to_fkey(id, display_name)')
      .eq('id', row.id)
      .maybeSingle();
    res.json({ success: true, data: { ticket: shapeTicket(full || row), messages } });
  } catch (err: any) {
    console.error('[bridge] ticket messages error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ---- Reply from the SaaS user ---------------------------------------------
router.post('/support/tickets/:id/messages', async (req: Request, res: Response) => {
  try {
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed.error);
    const body = parsed.data;
    if (!body.content && !(body.attachments && body.attachments.length)) {
      res.status(400).json({ success: false, error: 'Message content or an attachment is required' });
      return;
    }
    const loaded = await loadExternalTicket(String(req.params.id), body.saas_user_id, res);
    if (!loaded) return;
    const { row, requester } = loaded;
    if (!row.root_message_id) {
      res.status(409).json({ success: false, error: 'Ticket has no conversation root' });
      return;
    }

    const actorId = await resolveRequesterActor(requester);
    const metadata = requesterMessageMetadata(requester);
    const io = req.app.get('io');
    const created: any[] = [];
    if (body.content) {
      created.push(
        await postSupportTicketReplyCore({ row, senderId: actorId, body: { type: 'text', content: body.content }, metadata, io }),
      );
    }
    for (const a of body.attachments || []) {
      created.push(
        await postSupportTicketReplyCore({
          row,
          senderId: actorId,
          body: { type: attachmentType(a.mime), file_url: a.url, file_name: a.name, file_size: a.size, file_mime: a.mime },
          metadata,
          io,
        }),
      );
    }
    res.status(201).json({
      success: true,
      data: created.map((m) => ({ id: m.id, type: m.type, content: m.content, file_url: m.file_url, created_at: m.created_at })),
    });
  } catch (err: any) {
    console.error('[bridge] ticket reply error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ---- Close / reopen -------------------------------------------------------
async function setStatus(req: Request, res: Response, status: 'open' | 'closed') {
  try {
    const parsed = actorSchema.safeParse(req.body ?? {});
    if (!parsed.success) return zodError(res, parsed.error);
    const loaded = await loadExternalTicket(String(req.params.id), parsed.data.saas_user_id, res);
    if (!loaded) return;
    const actorId = await resolveRequesterActor(loaded.requester);
    const ticket = await setSupportTicketStatusCore(loaded.row, status, actorId, req.app.get('io'));
    res.json({ success: true, data: shapeTicket(ticket) });
  } catch (err: any) {
    console.error(`[bridge] ticket ${status} error:`, err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
}

router.post('/support/tickets/:id/close', (req, res) => setStatus(req, res, 'closed'));
router.post('/support/tickets/:id/reopen', (req, res) => setStatus(req, res, 'open'));

export default router;
