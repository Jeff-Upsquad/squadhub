// ============================================================
// Bridge — business endpoints (called by Squad Hub SaaS).
//
//   GET /bridge/v1/business/:hubClientId/cards
//   GET /bridge/v1/business/:hubClientId/payments?months=6
//
// Reuses the Hub's own client↔card matcher (enrichClient, the Clients module)
// and job-card listing (listJobCardsForClientScope, the client-facing
// /job-cards/mine) and the billing ledger calculator (computeGrossProfit,
// restricted to the business's cards and stripped of internal cost/margin).
// ============================================================
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { enrichClient } from '../clients-admin';
import { listJobCardsForClientScope } from '../job-cards';
import { computeGrossProfit } from '../../utils/grossProfitPeriod';

const router = Router();

const uuid = z.string().uuid();

async function loadClient(req: Request, res: Response): Promise<any | null> {
  const parsed = uuid.safeParse(req.params.hubClientId);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'hubClientId must be a uuid' });
    return null;
  }
  const { data: client, error } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', parsed.data)
    .maybeSingle();
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return null;
  }
  if (!client) {
    res.status(404).json({ success: false, error: 'Client not found' });
    return null;
  }
  return client;
}

/** Every subscription-card id the Clients module links to this client. */
function linkedCardIds(enriched: any): string[] {
  const ids = new Set<string>();
  for (const cs of enriched?.subscriptions || []) if (cs?.card?.id) ids.add(cs.card.id);
  for (const c of enriched?.linkedCards || []) if (c?.id) ids.add(c.id);
  return [...ids];
}

/** Active assignee per card from the assignment-terms ledger. */
async function assigneeSummaries(cardIds: string[]): Promise<Map<string, any[]>> {
  const out = new Map<string, any[]>();
  if (!cardIds.length) return out;
  const { data } = await supabaseAdmin
    .from('subscription_assignment_terms')
    .select('card_id, recipient_type, recipient_id, recipient_name, work_start_date, assigned_date, status')
    .in('card_id', cardIds)
    .eq('status', 'active');
  for (const t of (data || []) as any[]) {
    const list = out.get(t.card_id) || [];
    list.push({
      recipient_type: t.recipient_type,
      // Partner recipients are Hub user ids; talent recipients are SquadHire ids.
      hub_partner_user_id: t.recipient_type === 'partner' ? t.recipient_id : null,
      squadhire_talent_id: t.recipient_type === 'talent' ? t.recipient_id : null,
      name: t.recipient_name,
      since: (t.work_start_date || t.assigned_date || '').slice(0, 10) || null,
    });
    out.set(t.card_id, list);
  }
  return out;
}

function lifecycleStatus(card: any): string {
  if (card.deleted_at) return 'deleted';
  if (card.archived_at) return 'archived';
  if (card.cancel_type === 'soft') return 'superseded';
  if (card.cancelled_at) return 'cancelled';
  if (card.state === 'assigned' && card.paused_at) return 'paused';
  if (card.state === 'assigned') return 'active';
  if (card.state === 'closed') return 'closed';
  if (card.state === 'published') return 'sourcing';
  return card.state || 'draft';
}

router.get('/business/:hubClientId/cards', async (req: Request, res: Response) => {
  try {
    const client = await loadClient(req, res);
    if (!client) return;

    const enriched = await enrichClient(client, { withCardLifecycle: true });
    const cardIds = linkedCardIds(enriched);

    const [{ data: cardRows, error: cardErr }, assignees, { data: wsRows }, jobCards] = await Promise.all([
      cardIds.length
        ? supabaseAdmin
            .from('subscription_cards')
            .select(
              'id, card_code, card_type, service_type, plan_name, brand_name, state, published_at, assigned_at, paused_at, cancelled_at, cancel_type, closed_at, archived_at, deleted_at, supersedes_card_id, plan_snapshot',
            )
            .in('id', cardIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      assigneeSummaries(cardIds),
      cardIds.length
        ? supabaseAdmin.from('saas_card_workspaces').select('hub_card_id, shared_workspace_id, status').in('hub_card_id', cardIds)
        : Promise.resolve({ data: [] as any[] }),
      listJobCardsForClientScope([client.id], client.submission_id ? [client.submission_id] : []),
    ]);
    if (cardErr) {
      res.status(500).json({ success: false, error: cardErr.message });
      return;
    }

    const wsByCard = new Map<string, any>(((wsRows || []) as any[]).map((w) => [w.hub_card_id, w]));
    const needsBroadcast = new Map<string, boolean>();
    for (const cs of enriched.subscriptions || []) if (cs?.card?.id) needsBroadcast.set(cs.card.id, !!cs.card.needs_broadcast);

    const subscriptionCards = ((cardRows || []) as any[])
      .filter((c) => !c.deleted_at)
      .map((c) => ({
        id: c.id,
        card_code: c.card_code,
        card_type: c.card_type ?? 'subscription',
        service_type: c.service_type,
        plan_name: c.plan_name,
        plan_tier: c.plan_snapshot?.plan?.tier ?? null,
        weekly_hours: c.plan_snapshot?.plan?.weekly_hours ?? null,
        brand_name: c.brand_name,
        state: c.state,
        status: lifecycleStatus(c),
        needs_broadcast: needsBroadcast.get(c.id) ?? false,
        published_at: c.published_at,
        assigned_at: c.assigned_at,
        paused_at: c.paused_at,
        cancelled_at: c.cancelled_at,
        closed_at: c.closed_at,
        archived_at: c.archived_at,
        supersedes_card_id: c.supersedes_card_id,
        assignees: assignees.get(c.id) || [],
        saas_shared_workspace_id: wsByCard.get(c.id)?.shared_workspace_id ?? null,
      }));

    const jobs = (jobCards || []).map((j: any) => ({
      id: j.id,
      title: j.job_profile?.title ?? j.title ?? null,
      stage: j.stage,
      state: j.state ?? null,
      created_at: j.created_at,
      job_profile: j.job_profile,
      business_profile: j.business_profile,
      brand_profile: j.brand_profile,
    }));

    res.json({
      success: true,
      data: {
        hub_client_id: client.id,
        business_name: client.business_name,
        subscription_cards: subscriptionCards,
        job_cards: jobs,
      },
    });
  } catch (err: any) {
    console.error('[bridge] business cards error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

function monthKeysBack(count: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

router.get('/business/:hubClientId/payments', async (req: Request, res: Response) => {
  try {
    const client = await loadClient(req, res);
    if (!client) return;

    const monthsRaw = Number(req.query.months);
    const months = Number.isFinite(monthsRaw) ? Math.min(Math.max(Math.trunc(monthsRaw), 1), 12) : 6;

    // Include archived subscriptions: billing history outlives the card.
    const enriched = await enrichClient(client, { includeArchived: true });
    const cardIds = linkedCardIds(enriched);

    const periods = await Promise.all(
      monthKeysBack(months).map(async (anchor) => {
        const gp = await computeGrossProfit({ granularity: 'month', anchor, cardIds });
        const lines = gp.clients.flatMap((c) =>
          c.lines.map((l) => ({
            card_id: l.card_id,
            subscription_name: l.subscription_name,
            role: l.role,
            plan: l.plan,
            tier: l.tier,
            talent: l.talent,
            status: l.status,
            work_start: l.work_start,
            work_end: l.work_end,
            active_days: l.active_days,
            currency: c.currency,
            // Client-facing only: what the business is billed. Partner cost and
            // margin never leave the Hub.
            amount: l.revenue,
            base_amount: l.base_revenue,
            additional_amount: l.additional_revenue,
            additional_hours: l.additional_hours,
            estimated: !l.finalized,
          })),
        );
        const totals = new Map<string, number>();
        for (const l of lines) totals.set(l.currency, (totals.get(l.currency) || 0) + l.amount);
        return {
          month: gp.period.anchor,
          label: gp.period.label,
          totals: [...totals.entries()].map(([currency, amount]) => ({ currency, amount })),
          lines,
        };
      }),
    );

    res.json({
      success: true,
      data: {
        hub_client_id: client.id,
        business_name: client.business_name,
        // Billing per month from the assignment-terms ledger (the same figures
        // as the admin Gross Profit revenue column), newest last.
        payments: periods,
        // Squad Hub stores no invoices — they are issued from SquadBooks.
        invoices: null,
        invoices_source: 'squadbooks',
      },
    });
  } catch (err: any) {
    console.error('[bridge] business payments error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
