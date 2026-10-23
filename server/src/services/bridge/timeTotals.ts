/**
 * Daily push of SaaS time totals to the Hub (POST /bridge/v1/time-totals).
 * Each talent link (shared_workspace_links participant_role='talent' with a
 * hub_card_id) maps (shared workspace, talent account owner) → (hub card, hub
 * partner user). Minutes = that user's task_time_entries in the shared
 * workspace whose start falls on the IST date. The Hub upserts per
 * (date, card, partner), so re-pushing a date is safe.
 */
import { supabaseAdmin } from '../../supabase';
import { IST_OFFSET_MS } from '../../utils/ist';
import { hub } from '../../utils/hubBridgeClient';

export interface TimeTotalEntry {
  hub_card_id: string;
  hub_partner_user_id: string;
  minutes: number;
}

/** [start, end) UTC instants of an IST calendar date. */
export function istDayRange(date: string): { from: string; to: string } {
  const start = new Date(`${date}T00:00:00Z`).getTime() - IST_OFFSET_MS;
  return { from: new Date(start).toISOString(), to: new Date(start + 864e5).toISOString() };
}

export async function computeTimeTotals(date: string): Promise<TimeTotalEntry[]> {
  const { data: links } = await supabaseAdmin
    .from('shared_workspace_links')
    .select('shared_workspace_id, participant_workspace_id, hub_card_id')
    .eq('participant_role', 'talent')
    .not('hub_card_id', 'is', null);
  const rows = (links || []) as any[];
  if (!rows.length) return [];
  const { data: accounts } = await supabaseAdmin
    .from('workspaces')
    .select('id, owner_user_id, hub_partner_user_id')
    .in('id', [...new Set(rows.map((l) => l.participant_workspace_id))]);
  const acctById = new Map(((accounts || []) as any[]).map((a) => [a.id, a]));
  const { from, to } = istDayRange(date);

  const byKey = new Map<string, TimeTotalEntry>();
  for (const l of rows) {
    const acct = acctById.get(l.participant_workspace_id);
    if (!acct?.owner_user_id || !acct.hub_partner_user_id) continue;
    const { data: entries } = await supabaseAdmin
      .from('task_time_entries')
      .select('duration_seconds')
      .eq('workspace_id', l.shared_workspace_id)
      .eq('user_id', acct.owner_user_id)
      .gte('started_at', from)
      .lt('started_at', to);
    const seconds = ((entries || []) as any[]).reduce((s, e) => s + (Number(e.duration_seconds) || 0), 0);
    const key = `${l.hub_card_id}:${acct.hub_partner_user_id}`;
    const prev = byKey.get(key)?.minutes ?? 0;
    byKey.set(key, {
      hub_card_id: l.hub_card_id,
      hub_partner_user_id: acct.hub_partner_user_id,
      minutes: Math.min(prev + Math.round(seconds / 60), 24 * 60),
    });
  }
  return [...byKey.values()];
}

export async function pushTimeTotals(date: string): Promise<{ date: string; entries: number; skipped?: boolean }> {
  const entries = await computeTimeTotals(date);
  if (!entries.length) return { date, entries: 0, skipped: true };
  await hub.timeTotals({ date, entries });
  return { date, entries: entries.length };
}
