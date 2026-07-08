import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { resolveSalesPeriod, SalesPeriod, SalesPeriodType } from '../utils/salesPeriod';

// ============================================================
// Admin Sales Dashboard
//
// Metrics come from the Squad CRM tables in this same database
// (crm_leads / crm_call_logs), aggregated by the sales_dash_member_stats /
// sales_dash_breakdown SQL functions (migration 163) over half-open UTC
// ranges derived from IST periods (utils/salesPeriod). The sales team
// roster (sales_team_members) decides who is on the leaderboard; activity
// by anyone else is reconciled into an "others" bucket so period totals
// always add up. Targets (sales_targets) are per user + metric +
// weekly/monthly, effective from a period start — the latest
// effective_from <= the viewed period's start wins.
// ============================================================

const router = Router();

router.use(requireAuth, requireAdmin);

const METRICS = ['calls_made', 'leads_converted', 'deals_converted', 'deals_closed', 'revenue'] as const;
type Metric = (typeof METRICS)[number];

// Where "Open in CRM" links point. Prod default is the live CRM; override
// with CRM_WEB_URL for local/dev stacks.
const CRM_WEB_URL = (process.env.CRM_WEB_URL || 'https://crm.squadhub.in').replace(/\/+$/, '');

const PERIOD_TYPES: SalesPeriodType[] = ['week', 'month', 'custom'];
const DIMENSIONS = ['product', 'squad', 'category', 'source'] as const;

type Stats = {
  leads_created: number;
  calls_total: number;
  calls_answered: number;
  calls_no_answer: number;
  leads_to_deals: number;
  deals_converted: number;
  deals_closed: number;
  revenue_closed: number;
};

// Which rpc stat backs each target metric.
const METRIC_ACTUAL: Record<Metric, keyof Stats> = {
  calls_made: 'calls_total',
  leads_converted: 'leads_to_deals',
  deals_converted: 'deals_converted',
  deals_closed: 'deals_closed',
  revenue: 'revenue_closed',
};

function zeroStats(): Stats {
  return {
    leads_created: 0,
    calls_total: 0,
    calls_answered: 0,
    calls_no_answer: 0,
    leads_to_deals: 0,
    deals_converted: 0,
    deals_closed: 0,
    revenue_closed: 0,
  };
}

function normalizeStats(row: any): Stats {
  return {
    leads_created: Number(row?.leads_created) || 0,
    calls_total: Number(row?.calls_total) || 0,
    calls_answered: Number(row?.calls_answered) || 0,
    calls_no_answer: Number(row?.calls_no_answer) || 0,
    leads_to_deals: Number(row?.leads_to_deals) || 0,
    deals_converted: Number(row?.deals_converted) || 0,
    deals_closed: Number(row?.deals_closed) || 0,
    revenue_closed: Number(row?.revenue_closed) || 0,
  };
}

function addStats(into: Stats, s: Stats): void {
  (Object.keys(into) as (keyof Stats)[]).forEach((k) => {
    into[k] += s[k];
  });
}

/** Resolve the requested period or respond 400. Returns null when it responded. */
function parsePeriod(req: Request, res: Response): SalesPeriod | null {
  const periodType = PERIOD_TYPES.includes(req.query.period_type as SalesPeriodType)
    ? (req.query.period_type as SalesPeriodType)
    : 'week';
  const anchor = typeof req.query.anchor === 'string' ? req.query.anchor : undefined;
  const start = typeof req.query.start === 'string' ? req.query.start : undefined;
  const end = typeof req.query.end === 'string' ? req.query.end : undefined;
  try {
    return resolveSalesPeriod(periodType, anchor, start, end);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || 'Invalid period' });
    return null;
  }
}

/**
 * Effective targets per user for the period: for each user + metric, the
 * sales_targets row with the latest effective_from <= the period's start.
 * Custom periods have no target notion → null.
 */
async function loadEffectiveTargets(
  userIds: string[],
  period: SalesPeriod,
): Promise<Map<string, Partial<Record<Metric, number>>> | null> {
  if (period.period_type === 'custom') return null;
  const map = new Map<string, Partial<Record<Metric, number>>>();
  if (!userIds.length) return map;

  const dbPeriodType = period.period_type === 'week' ? 'weekly' : 'monthly';
  const { data, error } = await supabaseAdmin
    .from('sales_targets')
    .select('user_id, metric, target_value, effective_from')
    .in('user_id', userIds)
    .eq('period_type', dbPeriodType)
    .lte('effective_from', period.start_ist)
    .order('effective_from', { ascending: false });
  if (error) throw new Error(error.message);

  for (const row of data || []) {
    const per = map.get(row.user_id) || {};
    if (per[row.metric as Metric] === undefined) {
      per[row.metric as Metric] = Number(row.target_value) || 0;
      map.set(row.user_id, per);
    }
  }
  return map;
}

/** {metric: {target, actual, pct}} for the metrics that have a target, else null. */
function buildTargetProgress(
  perUser: Partial<Record<Metric, number>> | undefined,
  stats: Stats,
): Partial<Record<Metric, { target: number; actual: number; pct: number }>> | null {
  if (!perUser || Object.keys(perUser).length === 0) return null;
  const out: Partial<Record<Metric, { target: number; actual: number; pct: number }>> = {};
  for (const metric of METRICS) {
    const target = perUser[metric];
    if (target === undefined) continue;
    const actual = stats[METRIC_ACTUAL[metric]];
    out[metric] = {
      target,
      actual,
      pct: target > 0 ? Math.round((actual / target) * 1000) / 10 : 0,
    };
  }
  return out;
}

async function loadTeam(): Promise<{ user_id: string; created_at: string }[]> {
  const { data, error } = await supabaseAdmin
    .from('sales_team_members')
    .select('user_id, created_at')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as { user_id: string; created_at: string }[];
}

async function loadUsersMap(userIds: string[]): Promise<Record<string, any>> {
  const usersMap: Record<string, any> = {};
  if (!userIds.length) return usersMap;
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, display_name, email, avatar_url')
    .in('id', userIds);
  (data || []).forEach((u: any) => { usersMap[u.id] = u; });
  return usersMap;
}

// ------------------------------------------------------------
// GET /admin/sales-dashboard/summary?period_type=week|month|custom&anchor=&start=&end=
// Period totals + funnel + per-member leaderboard (with target progress)
// + an "others" bucket for activity by non-team users so totals reconcile.
// ------------------------------------------------------------
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const period = parsePeriod(req, res);
    if (!period) return;

    const { data: rpcRows, error: rpcError } = await supabaseAdmin.rpc('sales_dash_member_stats', {
      p_start: period.start_utc,
      p_end: period.end_utc,
    });
    if (rpcError) {
      res.status(500).json({ success: false, error: rpcError.message });
      return;
    }

    const team = await loadTeam();
    const teamIds = team.map((m) => m.user_id);
    const teamSet = new Set(teamIds);
    const usersMap = await loadUsersMap(teamIds);
    const targetsMap = await loadEffectiveTargets(teamIds, period);

    const totals = zeroStats();
    const others = zeroStats();
    const statsByUid = new Map<string, Stats>();
    for (const row of (rpcRows || []) as any[]) {
      const stats = normalizeStats(row);
      addStats(totals, stats);
      const uid = (row.user_id as string | null) || null;
      if (uid && teamSet.has(uid)) statsByUid.set(uid, stats);
      else addStats(others, stats);
    }

    const funnel = {
      leads: totals.leads_created,
      deals: totals.leads_to_deals,
      converted: totals.deals_converted,
      closed: totals.deals_closed,
    };

    const members = team.map((m) => {
      const stats = statsByUid.get(m.user_id) || zeroStats();
      return {
        user: usersMap[m.user_id] || { id: m.user_id, display_name: null, email: null, avatar_url: null },
        stats,
        targets: targetsMap === null ? null : buildTargetProgress(targetsMap.get(m.user_id), stats),
      };
    });

    res.json({ success: true, data: { period, totals, funnel, members, others } });
  } catch (err: any) {
    console.error('Sales dashboard summary error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ------------------------------------------------------------
// GET /admin/sales-dashboard/breakdown?dimension=product|squad|category|source&period params
// ------------------------------------------------------------
router.get('/breakdown', async (req: Request, res: Response) => {
  try {
    const dimension = req.query.dimension as (typeof DIMENSIONS)[number];
    if (!DIMENSIONS.includes(dimension)) {
      res.status(400).json({ success: false, error: 'dimension must be one of product, squad, category, source' });
      return;
    }
    const period = parsePeriod(req, res);
    if (!period) return;

    const { data, error } = await supabaseAdmin.rpc('sales_dash_breakdown', {
      p_start: period.start_utc,
      p_end: period.end_utc,
      p_dimension: dimension,
    });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const rows = ((data || []) as any[]).map((r) => ({
      group_key: r.group_key as string,
      leads_created: Number(r.leads_created) || 0,
      leads_to_deals: Number(r.leads_to_deals) || 0,
      deals_converted: Number(r.deals_converted) || 0,
      deals_closed: Number(r.deals_closed) || 0,
      revenue_closed: Number(r.revenue_closed) || 0,
    }));

    res.json({ success: true, data: { period, dimension, rows } });
  } catch (err: any) {
    console.error('Sales dashboard breakdown error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ------------------------------------------------------------
// GET /admin/sales-dashboard/members/:userId?period params — drill-down:
// personal stats + target progress + recent calls and deal movements.
// ------------------------------------------------------------
router.get('/members/:userId', async (req: Request, res: Response) => {
  try {
    const period = parsePeriod(req, res);
    if (!period) return;
    const userId = String(req.params.userId);

    const { data: member } = await supabaseAdmin
      .from('sales_team_members')
      .select('user_id, created_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (!member) {
      res.status(404).json({ success: false, error: 'Not on the sales team' });
      return;
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, avatar_url')
      .eq('id', userId)
      .maybeSingle();

    const { data: rpcRows, error: rpcError } = await supabaseAdmin.rpc('sales_dash_member_stats', {
      p_start: period.start_utc,
      p_end: period.end_utc,
    });
    if (rpcError) {
      res.status(500).json({ success: false, error: rpcError.message });
      return;
    }
    const row = ((rpcRows || []) as any[]).find((r) => r.user_id === userId);
    const stats = row ? normalizeStats(row) : zeroStats();

    const targetsMap = await loadEffectiveTargets([userId], period);
    const targets = targetsMap === null ? null : buildTargetProgress(targetsMap.get(userId), stats);

    // Recent calls in the period, newest first, with lead names hydrated.
    const { data: calls, error: callsError } = await supabaseAdmin
      .from('crm_call_logs')
      .select('id, lead_id, outcome, note, called_at')
      .eq('caller_id', userId)
      .gte('called_at', period.start_utc)
      .lt('called_at', period.end_utc)
      .order('called_at', { ascending: false })
      .limit(25);
    if (callsError) {
      res.status(500).json({ success: false, error: callsError.message });
      return;
    }
    const leadIds = [...new Set((calls || []).map((c: any) => c.lead_id).filter(Boolean))];
    const leadNames: Record<string, string | null> = {};
    if (leadIds.length) {
      const { data: leads } = await supabaseAdmin
        .from('crm_leads')
        .select('id, name')
        .in('id', leadIds);
      (leads || []).forEach((l: any) => { leadNames[l.id] = l.name ?? null; });
    }
    const recentCalls = (calls || []).map((c: any) => ({
      ...c,
      lead_name: (c.lead_id && leadNames[c.lead_id]) || null,
    }));

    // Recent deal movements the member is stamped on within the period.
    const { data: deals, error: dealsError } = await supabaseAdmin
      .from('crm_leads')
      .select('id, name, deal_value, became_deal_at, became_deal_by, converted_at, converted_by, closed_at, closed_by')
      .or(
        [
          `and(became_deal_by.eq.${userId},became_deal_at.gte.${period.start_utc},became_deal_at.lt.${period.end_utc})`,
          `and(converted_by.eq.${userId},converted_at.gte.${period.start_utc},converted_at.lt.${period.end_utc})`,
          `and(closed_by.eq.${userId},closed_at.gte.${period.start_utc},closed_at.lt.${period.end_utc})`,
        ].join(','),
      )
      .limit(25);
    if (dealsError) {
      res.status(500).json({ success: false, error: dealsError.message });
      return;
    }
    const latestStamp = (d: any) =>
      Math.max(
        d.closed_at ? Date.parse(d.closed_at) : 0,
        d.converted_at ? Date.parse(d.converted_at) : 0,
        d.became_deal_at ? Date.parse(d.became_deal_at) : 0,
      );
    const recentDeals = ((deals || []) as any[])
      .map((d) => ({
        id: d.id,
        name: d.name ?? null,
        deal_value: d.deal_value != null ? Number(d.deal_value) : null,
        became_deal_at: d.became_deal_at ?? null,
        converted_at: d.converted_at ?? null,
        closed_at: d.closed_at ?? null,
      }))
      .sort((a, b) => latestStamp(b) - latestStamp(a));

    res.json({
      success: true,
      data: {
        period,
        user: user || { id: userId, display_name: null, email: null, avatar_url: null },
        stats,
        targets,
        recent_calls: recentCalls,
        recent_deals: recentDeals,
        crm_base_url: CRM_WEB_URL,
      },
    });
  } catch (err: any) {
    console.error('Sales dashboard member error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ------------------------------------------------------------
// GET /admin/sales-dashboard/records?metric=&period…&user_id= — the actual
// leads / deals / calls behind a metric number, newest first, each with
// enough context to render a list row + an "Open in CRM" link.
// ------------------------------------------------------------
const RECORD_METRICS = [
  'leads_created',
  'calls',
  'leads_to_deals',
  'deals_converted',
  'deals_closed',
] as const;
type RecordMetric = (typeof RECORD_METRICS)[number];

// timestamp column that defines the event + user column that attributes it
const RECORD_LEAD_COLS: Record<Exclude<RecordMetric, 'calls'>, { ts: string; user: string }> = {
  leads_created: { ts: 'created_at', user: 'assignee_id' },
  leads_to_deals: { ts: 'became_deal_at', user: 'became_deal_by' },
  deals_converted: { ts: 'converted_at', user: 'converted_by' },
  deals_closed: { ts: 'closed_at', user: 'closed_by' },
};

router.get('/records', async (req: Request, res: Response) => {
  try {
    const period = parsePeriod(req, res);
    if (!period) return;
    const metric = String(req.query.metric || '') as RecordMetric;
    if (!RECORD_METRICS.includes(metric)) {
      res.status(400).json({ success: false, error: 'Invalid metric' });
      return;
    }
    const userId = typeof req.query.user_id === 'string' && req.query.user_id ? req.query.user_id : null;

    if (metric === 'calls') {
      let q = supabaseAdmin
        .from('crm_call_logs')
        .select('id, lead_id, caller_id, outcome, note, called_at', { count: 'exact' })
        .gte('called_at', period.start_utc)
        .lt('called_at', period.end_utc)
        .order('called_at', { ascending: false })
        .limit(100);
      if (userId) q = q.eq('caller_id', userId);
      const { data: calls, error, count } = await q;
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }

      const leadIds = [...new Set((calls || []).map((c: any) => c.lead_id).filter(Boolean))];
      const leadMap: Record<string, { name: string | null; phone_e164: string | null }> = {};
      if (leadIds.length) {
        const { data: leads } = await supabaseAdmin
          .from('crm_leads')
          .select('id, name, phone_e164')
          .in('id', leadIds);
        (leads || []).forEach((l: any) => {
          leadMap[l.id] = { name: l.name ?? null, phone_e164: l.phone_e164 ?? null };
        });
      }
      const usersMap = await loadUsersMap([
        ...new Set((calls || []).map((c: any) => c.caller_id).filter(Boolean)),
      ] as string[]);

      res.json({
        success: true,
        data: {
          period,
          metric,
          crm_base_url: CRM_WEB_URL,
          total: count ?? (calls || []).length,
          records: (calls || []).map((c: any) => ({
            kind: 'call',
            id: c.id,
            lead_id: c.lead_id,
            name: (c.lead_id && leadMap[c.lead_id]?.name) || null,
            phone: (c.lead_id && leadMap[c.lead_id]?.phone_e164) || null,
            outcome: c.outcome,
            note: c.note ?? null,
            event_at: c.called_at,
            user_name:
              usersMap[c.caller_id]?.display_name || usersMap[c.caller_id]?.email || null,
          })),
        },
      });
      return;
    }

    const cols = RECORD_LEAD_COLS[metric];
    let q = supabaseAdmin
      .from('crm_leads')
      .select(
        `id, name, phone_e164, deal_value, product, source, ${cols.user}, created_at, became_deal_at, converted_at, closed_at`,
        { count: 'exact' },
      )
      .gte(cols.ts, period.start_utc)
      .lt(cols.ts, period.end_utc)
      .order(cols.ts, { ascending: false })
      .limit(100);
    if (metric === 'leads_created') q = q.is('merged_into_lead_id', null);
    if (userId) q = q.eq(cols.user, userId);
    const { data: leads, error, count } = await q;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const usersMap = await loadUsersMap([
      ...new Set((leads || []).map((l: any) => l[cols.user]).filter(Boolean)),
    ] as string[]);

    res.json({
      success: true,
      data: {
        period,
        metric,
        crm_base_url: CRM_WEB_URL,
        total: count ?? (leads || []).length,
        records: (leads || []).map((l: any) => ({
          kind: 'lead',
          id: l.id,
          lead_id: l.id,
          name: l.name ?? null,
          phone: l.phone_e164 ?? null,
          deal_value: l.deal_value != null ? Number(l.deal_value) : null,
          product: l.product ?? null,
          source: l.source ?? null,
          event_at: l[cols.ts],
          user_name:
            usersMap[l[cols.user]]?.display_name || usersMap[l[cols.user]]?.email || null,
          became_deal_at: l.became_deal_at ?? null,
          converted_at: l.converted_at ?? null,
          closed_at: l.closed_at ?? null,
        })),
      },
    });
  } catch (err: any) {
    console.error('Sales dashboard records error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ------------------------------------------------------------
// GET /admin/sales-dashboard/team — roster with hydrated users
// ------------------------------------------------------------
router.get('/team', async (_req: Request, res: Response) => {
  try {
    const { data: members, error } = await supabaseAdmin
      .from('sales_team_members')
      .select('id, user_id, added_by, created_at')
      .order('created_at', { ascending: true });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    const usersMap = await loadUsersMap((members || []).map((m: any) => m.user_id));
    const result = (members || []).map((m: any) => ({ ...m, user: usersMap[m.user_id] || null }));
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Sales team list error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// GET /admin/sales-dashboard/team/candidates?q= — internal, active users
// not already on the team (for the add-member combobox).
// ------------------------------------------------------------
router.get('/team/candidates', async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().replace(/[,()]/g, ' ').trim() : '';

    const team = await loadTeam();
    const memberIds = new Set(team.map((m) => m.user_id));

    let query = supabaseAdmin
      .from('users')
      .select('id, display_name, email, avatar_url')
      .eq('user_type', 'internal')
      .eq('status', 'active')
      .order('display_name', { ascending: true })
      .limit(20 + memberIds.size); // over-fetch so filtering members out still fills 20
    if (q) {
      const pattern = `%${q}%`;
      query = query.or(`display_name.ilike.${pattern},email.ilike.${pattern}`);
    }
    const { data: users, error } = await query;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const candidates = (users || []).filter((u: any) => !memberIds.has(u.id)).slice(0, 20);
    res.json({ success: true, data: candidates });
  } catch (err) {
    console.error('Sales team candidates error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /admin/sales-dashboard/team — add an internal user to the team
// ------------------------------------------------------------
const teamMemberSchema = z.object({ user_id: z.string().uuid() });

router.post('/team', async (req: Request, res: Response) => {
  try {
    const { user_id } = teamMemberSchema.parse(req.body);

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, avatar_url, user_type')
      .eq('id', user_id)
      .maybeSingle();
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    if ((user as any).user_type !== 'internal') {
      res.status(400).json({ success: false, error: 'Only internal team members can join the sales team' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('sales_team_members')
      .insert({ user_id, added_by: req.userId || null })
      .select()
      .single();
    if (error) {
      const status = error.code === '23505' ? 409 : 500;
      res.status(status).json({
        success: false,
        error: error.code === '23505' ? 'Already on the sales team' : error.message,
      });
      return;
    }

    const u = user as any;
    res.status(201).json({
      success: true,
      data: { ...data, user: { id: u.id, display_name: u.display_name, email: u.email, avatar_url: u.avatar_url } },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add sales team member error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// DELETE /admin/sales-dashboard/team/:userId — remove from the team
// (their sales_targets rows are kept; they simply stop rendering).
// ------------------------------------------------------------
router.delete('/team/:userId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('sales_team_members')
      .delete()
      .eq('user_id', req.params.userId);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Remove sales team member error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// GET /admin/sales-dashboard/targets?period_type=weekly|monthly —
// the latest target row per team member + metric.
// ------------------------------------------------------------
router.get('/targets', async (req: Request, res: Response) => {
  try {
    const periodType = req.query.period_type === 'monthly' ? 'monthly' : 'weekly';

    const team = await loadTeam();
    const teamIds = team.map((m) => m.user_id);
    if (!teamIds.length) {
      res.json({ success: true, data: [] });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('sales_targets')
      .select('user_id, metric, period_type, target_value, effective_from')
      .eq('period_type', periodType)
      .in('user_id', teamIds)
      .order('effective_from', { ascending: false });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Latest effective_from wins per user + metric.
    const seen = new Set<string>();
    const rows: any[] = [];
    for (const row of data || []) {
      const key = `${row.user_id}|${row.metric}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ ...row, target_value: Number(row.target_value) || 0 });
    }

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Sales targets list error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// PUT /admin/sales-dashboard/targets — upsert a member's targets, effective
// from the CURRENT period's start (past periods keep their old targets).
// ------------------------------------------------------------
const putTargetsSchema = z.object({
  user_id: z.string().uuid(),
  period_type: z.enum(['weekly', 'monthly']),
  targets: z.object({
    calls_made: z.number().min(0).optional(),
    leads_converted: z.number().min(0).optional(),
    deals_converted: z.number().min(0).optional(),
    deals_closed: z.number().min(0).optional(),
    revenue: z.number().min(0).optional(),
  }),
});

router.put('/targets', async (req: Request, res: Response) => {
  try {
    const body = putTargetsSchema.parse(req.body);

    const { data: member } = await supabaseAdmin
      .from('sales_team_members')
      .select('user_id')
      .eq('user_id', body.user_id)
      .maybeSingle();
    if (!member) {
      res.status(404).json({ success: false, error: 'Not on the sales team' });
      return;
    }

    const period = resolveSalesPeriod(body.period_type === 'weekly' ? 'week' : 'month');
    const effectiveFrom = period.start_ist;

    const rows = METRICS.filter((m) => body.targets[m] !== undefined).map((m) => ({
      user_id: body.user_id,
      metric: m,
      period_type: body.period_type,
      target_value: body.targets[m] as number,
      effective_from: effectiveFrom,
      updated_at: new Date().toISOString(),
    }));
    if (!rows.length) {
      res.status(400).json({ success: false, error: 'No targets provided' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('sales_targets')
      .upsert(rows, { onConflict: 'user_id,metric,period_type,effective_from' })
      .select('user_id, metric, period_type, target_value, effective_from');
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
    console.error('Save sales targets error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
