/**
 * Hub-owned data shown inside the SaaS web app, fetched live from Squad Hub
 * over the signed bridge (utils/hubBridgeClient.ts). Nothing here is stored
 * on the SaaS side except the support-ticket → account reference.
 *
 *   /subscription-cards/mine, /subscription-cards/payments   business account
 *   /job-cards/mine                                          business account
 *   /partner/assignments, /partner/opportunities,
 *   /partner/discover/opportunities                          talent account
 *   /partner-payments/me|month|history                       talent account (mini app)
 *   /support/*                                               any account
 *
 * Hub unreachable / bridge off → 503 { code: 'hub_unavailable' } and the web
 * shows "temporarily unavailable" for that panel only.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';
import { hub, HubUnavailableError, sendHubError } from '../utils/hubBridgeClient';
import { workspaceHasMiniApp } from '../utils/miniAppAccess';

type Kind = 'business' | 'talent';

interface CallerAccount {
  id: string;
  kind: string;
  name: string;
  hub_client_id: string | null;
  hub_partner_user_id: string | null;
}

/**
 * The caller's account of `kind`: the active workspace when it is one,
 * otherwise the first such account they belong to (a business owner browsing
 * a shared workspace still sees their cards).
 */
async function callerAccount(req: Request, kind: Kind): Promise<CallerAccount | null> {
  const cols = 'id, kind, name, status, hub_client_id, hub_partner_user_id';
  if (req.workspaceId) {
    const { data } = await supabaseAdmin.from('workspaces').select(cols).eq('id', req.workspaceId).maybeSingle();
    if (data && data.kind === kind) return data as any;
  }
  const { data: rows } = await supabaseAdmin
    .from('workspace_members')
    .select('workspace_id, role, workspaces!inner(id, kind, name, status, hub_client_id, hub_partner_user_id)')
    .eq('user_id', req.userId!); // tenant-scope: caller's own memberships
  const mine = ((rows || []) as any[])
    .map((r) => ({ role: r.role, ws: r.workspaces }))
    .filter((r) => r.ws && r.ws.kind === kind && r.ws.status !== 'suspended')
    .sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0));
  return (mine[0]?.ws as CallerAccount) ?? null;
}

function notLinked(res: Response, what: string): void {
  res.status(404).json({ success: false, code: 'not_linked', error: `${what} isn't linked to Squad Hub yet.` });
}

// ================================================================ business
export const subscriptionCardsRouter = Router();
subscriptionCardsRouter.use(requireAuth);

subscriptionCardsRouter.get('/mine', async (req, res) => {
  try {
    const acct = await callerAccount(req, 'business');
    if (!acct?.hub_client_id) {
      res.json({ success: true, data: { linked: false, subscription_cards: [], job_cards: [] } });
      return;
    }
    const data: any = await hub.businessCards(acct.hub_client_id);
    res.json({ success: true, data: { linked: true, ...data } });
  } catch (err) {
    sendHubError(res, err);
  }
});

subscriptionCardsRouter.get('/payments', async (req, res) => {
  try {
    const acct = await callerAccount(req, 'business');
    if (!acct?.hub_client_id) {
      res.json({ success: true, data: { linked: false, payments: [], invoices: null } });
      return;
    }
    const months = Number(req.query.months);
    const data: any = await hub.businessPayments(acct.hub_client_id, Number.isFinite(months) ? months : undefined);
    // Invoices live in SquadBooks; the Hub sends invoices: null.
    res.json({ success: true, data: { linked: true, ...data, invoices: data?.invoices ?? null } });
  } catch (err) {
    sendHubError(res, err);
  }
});

export const jobCardsRouter = Router();
jobCardsRouter.use(requireAuth);

jobCardsRouter.get('/mine', async (req, res) => {
  try {
    const acct = await callerAccount(req, 'business');
    if (!acct?.hub_client_id) {
      res.json({ success: true, data: [] });
      return;
    }
    const data: any = await hub.businessCards(acct.hub_client_id);
    res.json({ success: true, data: data?.job_cards ?? [] });
  } catch (err) {
    sendHubError(res, err);
  }
});

// ================================================================ talent
export const partnerRouter = Router();
partnerRouter.use(requireAuth);

async function talentId(req: Request, res: Response): Promise<string | null> {
  const acct = await callerAccount(req, 'talent');
  if (!acct?.hub_partner_user_id) {
    notLinked(res, 'Your talent account');
    return null;
  }
  return acct.hub_partner_user_id;
}

partnerRouter.get('/assignments', async (req, res) => {
  try {
    const id = await talentId(req, res);
    if (!id) return;
    const data = await hub.talentAssignments(id, req.query.include_ended === '1');
    res.json({ success: true, data });
  } catch (err) {
    sendHubError(res, err);
  }
});

async function opportunities(req: Request, res: Response): Promise<any[] | null> {
  const id = await talentId(req, res);
  if (!id) return null;
  const data = await hub.talentOpportunities(id);
  return Array.isArray(data) ? data : [];
}

partnerRouter.get('/discover/opportunities', async (req, res) => {
  try {
    const data = await opportunities(req, res);
    if (data) res.json({ success: true, data });
  } catch (err) {
    sendHubError(res, err);
  }
});

partnerRouter.get('/opportunities', async (req, res) => {
  try {
    const data = await opportunities(req, res);
    if (!data) return;
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    res.json({ success: true, data: status ? data.filter((o) => (o?.status ?? 'pending') === status) : data });
  } catch (err) {
    sendHubError(res, err);
  }
});

// The bridge (v1) has no endpoint to respond to an opportunity — responses
// still happen in SquadHire.
const RESPOND_ELSEWHERE = {
  success: false,
  code: 'respond_in_squadhire',
  error: 'Responding to opportunities isn’t available here yet — please respond from the SquadHire app.',
};
partnerRouter.post('/opportunities/:id/:action', (_req, res) => {
  res.status(409).json(RESPOND_ELSEWHERE);
});
partnerRouter.all('/discover/opportunities/:id/*', (_req, res) => {
  res.status(409).json(RESPOND_ELSEWHERE);
});
partnerRouter.patch('/discover/opportunities/:id/respond', (_req, res) => {
  res.status(409).json(RESPOND_ELSEWHERE);
});

// ================================================================ partner payments
export const partnerPaymentsRouter = Router();
partnerPaymentsRouter.use(requireAuth);
partnerPaymentsRouter.use(async (req, res, next) => {
  // The mini app must be on for the caller's talent account (on by default).
  const acct = await callerAccount(req, 'talent');
  if (acct && !(await workspaceHasMiniApp(acct.id, 'partner-payments'))) {
    res.status(403).json({ success: false, error: 'Access denied: requires the Partner Payments app' });
    return;
  }
  next();
});

partnerPaymentsRouter.get('/me', async (req, res) => {
  try {
    const id = await talentId(req, res);
    if (!id) return;
    res.json({ success: true, data: { mode: 'self', recipient_id: id, recipient_name: req.userName ?? null } });
  } catch (err) {
    sendHubError(res, err);
  }
});

partnerPaymentsRouter.get('/month', async (req, res) => {
  try {
    const id = await talentId(req, res);
    if (!id) return;
    const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : undefined;
    // recipient_id from the client is ignored: a talent only ever sees their own payouts.
    res.json({ success: true, data: await hub.talentPayouts(id, month) });
  } catch (err) {
    sendHubError(res, err);
  }
});

partnerPaymentsRouter.get('/history', async (req, res) => {
  try {
    const id = await talentId(req, res);
    if (!id) return;
    const months = Number(req.query.months);
    res.json({ success: true, data: await hub.talentPayoutHistory(id, Number.isFinite(months) ? months : 12) });
  } catch (err) {
    sendHubError(res, err);
  }
});

// ================================================================ support
export const supportRouter = Router();
supportRouter.use(requireAuth);

/** Hub bridge ticket → the SupportTicket shape the web renders. */
function ticketShape(t: any) {
  return {
    id: t.ticket_id,
    ticket_number: t.ticket_number,
    ticket_code: t.ticket_code ?? `SUP-${t.ticket_number}`,
    category: t.category,
    subject: t.subject,
    status: t.status,
    priority: t.priority ?? 'normal',
    assignee: t.assignee_name ? { id: 'agent', display_name: t.assignee_name } : null,
    created_at: t.created_at,
    last_activity_at: t.last_activity_at ?? t.created_at,
    closed_at: t.closed_at ?? null,
  };
}

/**
 * The web keys its Support rail/view on a channel id; tickets live on the Hub,
 * so the SaaS answers with a fixed sentinel "channel". The overview never
 * fails on a Hub outage — it reports `unavailable` so the rail stays and the
 * view can say "temporarily unavailable".
 */
export const SUPPORT_CHANNEL_SENTINEL = '00000000-0000-4000-8000-000000005000';

supportRouter.get('/overview', async (req, res) => {
  try {
    const { count } = await supabaseAdmin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.userId!)
      .eq('type', 'support_reply')
      .eq('is_read', false); // tenant-scope: caller's own notifications across their accounts
    let tickets: ReturnType<typeof ticketShape>[] = [];
    let unavailable: string | null = null;
    try {
      const list = await hub.listTickets(req.userId!);
      tickets = (Array.isArray(list) ? list : []).map(ticketShape);
    } catch (err) {
      if (!(err instanceof HubUnavailableError)) throw err;
      unavailable = err.message;
    }
    res.json({
      success: true,
      data: {
        channel: { id: SUPPORT_CHANNEL_SENTINEL, name: 'Support', channel_kind: 'support' },
        is_agent: false,
        unread: count ?? 0,
        unavailable,
        tickets: { open: tickets.filter((t) => t.status !== 'closed'), closed: tickets.filter((t) => t.status === 'closed') },
      },
    });
  } catch (err) {
    sendHubError(res, err);
  }
});

const createSchema = z.object({
  category: z.enum(['technical', 'accounts', 'financial', 'general']),
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(8000),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

supportRouter.post('/tickets', async (req, res) => {
  try {
    const body = createSchema.parse(req.body);
    const accountId = req.workspaceId;
    if (!accountId) {
      res.status(400).json({ success: false, error: 'X-Workspace-Id header is required' });
      return;
    }
    const { data: me } = await supabaseAdmin
      .from('users')
      .select('id, email, display_name, hub_user_id')
      .eq('id', req.userId!)
      .single();
    const created = await hub.createTicket({
      saas_account_id: accountId,
      saas_user: { id: req.userId!, email: (me as any)?.email || req.userEmail || '', name: (me as any)?.display_name || 'Squad Hub user' },
      hub_user_id: (me as any)?.hub_user_id ?? null,
      category: body.category,
      subject: body.subject,
      body: body.description,
      priority: body.priority,
    });
    await supabaseAdmin.from('bridge_support_tickets').insert({
      ticket_id: created.ticket_id,
      ticket_number: created.ticket_number,
      user_id: req.userId!,
      workspace_id: accountId,
      subject: body.subject,
    });
    res.status(201).json({
      success: true,
      data: ticketShape({ ...created, category: body.category, subject: body.subject, status: 'open', priority: body.priority ?? 'normal', created_at: new Date().toISOString() }),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0]?.message || 'Invalid ticket' });
      return;
    }
    sendHubError(res, err);
  }
});

supportRouter.get('/tickets', async (req, res) => {
  try {
    const list = await hub.listTickets(req.userId!);
    res.json({ success: true, data: (Array.isArray(list) ? list : []).map(ticketShape) });
  } catch (err) {
    sendHubError(res, err);
  }
});

supportRouter.get('/tickets/:id/messages', async (req, res) => {
  try {
    const data: any = await hub.ticketThread(String(req.params.id), req.userId!);
    res.json({ success: true, data: { ticket: data?.ticket ? ticketShape(data.ticket) : null, messages: data?.messages ?? [] } });
  } catch (err) {
    sendHubError(res, err);
  }
});

supportRouter.post('/tickets/:id/messages', async (req, res) => {
  try {
    const content = typeof req.body?.content === 'string' ? req.body.content.trim().slice(0, 8000) : '';
    if (!content) {
      res.status(400).json({ success: false, error: 'Message content is required' });
      return;
    }
    const data = await hub.replyTicket(String(req.params.id), { saas_user_id: req.userId!, content });
    res.status(201).json({ success: true, data });
  } catch (err) {
    sendHubError(res, err);
  }
});

for (const action of ['close', 'reopen'] as const) {
  supportRouter.post(`/tickets/:id/${action}`, async (req, res) => {
    try {
      const data = await hub.setTicketStatus(String(req.params.id), action, req.userId!);
      res.json({ success: true, data: ticketShape(data) });
    } catch (err) {
      sendHubError(res, err);
    }
  });
}

supportRouter.post('/tickets/:id/read', async (req, res) => {
  try {
    await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', req.userId!)
      .eq('type', 'support_reply')
      .eq('reference_id', String(req.params.id)); // tenant-scope: caller's own notifications
    res.json({ success: true });
  } catch (err) {
    sendHubError(res, err);
  }
});
