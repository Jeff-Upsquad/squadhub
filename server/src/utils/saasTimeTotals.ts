// ============================================================
// saasTimeTotals
//
// Daily time totals pushed by Squad Hub SaaS (app.squadhub.in) over
// POST /bridge/v1/time-totals. The SaaS owns the raw time entries; the Hub only
// keeps one idempotent row per (IST date, card, partner) with total minutes, so
// a re-push of the same day simply overwrites it.
//
// Consumed by cardHoursCompletion next to tracked task time and elapsed idle
// time, so SaaS-logged hours flow into hours completion → Partner Payments and
// Gross Profit exactly the way Hub-tracked time does.
// ============================================================
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';

export const timeTotalsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  entries: z
    .array(
      z.object({
        hub_card_id: z.string().uuid(),
        hub_partner_user_id: z.string().uuid(),
        minutes: z.number().int().min(0).max(24 * 60),
      }),
    )
    .max(5000),
});

export type TimeTotalsInput = z.infer<typeof timeTotalsSchema>;

/**
 * Collapse duplicate (card, partner) pairs in one push. Last value wins — the
 * payload is a snapshot of the day's totals, not deltas.
 */
export function dedupeTimeTotals(input: TimeTotalsInput): TimeTotalsInput['entries'] {
  const byKey = new Map<string, TimeTotalsInput['entries'][number]>();
  for (const e of input.entries) byKey.set(`${e.hub_card_id}:${e.hub_partner_user_id}`, e);
  return [...byKey.values()];
}

/**
 * Idempotent upsert of one day's totals. Unknown card ids are skipped (and
 * reported) rather than failing the whole batch.
 */
export async function upsertSaasTimeTotals(
  input: TimeTotalsInput,
): Promise<{ upserted: number; skipped_unknown_cards: string[] }> {
  const entries = dedupeTimeTotals(input);
  if (!entries.length) return { upserted: 0, skipped_unknown_cards: [] };

  const cardIds = [...new Set(entries.map((e) => e.hub_card_id))];
  const { data: cards, error: cardErr } = await supabaseAdmin
    .from('subscription_cards')
    .select('id')
    .in('id', cardIds);
  if (cardErr) throw new Error(cardErr.message);
  const known = new Set((cards || []).map((c: any) => c.id as string));
  const unknown = cardIds.filter((id) => !known.has(id));

  const nowIso = new Date().toISOString();
  const rows = entries
    .filter((e) => known.has(e.hub_card_id))
    .map((e) => ({
      date: input.date,
      hub_card_id: e.hub_card_id,
      hub_partner_user_id: e.hub_partner_user_id,
      minutes: e.minutes,
      updated_at: nowIso,
    }));
  if (rows.length) {
    const { error } = await supabaseAdmin
      .from('saas_time_totals')
      .upsert(rows, { onConflict: 'date,hub_card_id,hub_partner_user_id' });
    if (error) throw new Error(error.message);
  }
  return { upserted: rows.length, skipped_unknown_cards: unknown };
}

/**
 * Total SaaS-logged seconds for one card over an IST date range (inclusive).
 * Best-effort: a missing table (migration not yet applied) or query error reads
 * as 0 so hours completion keeps working exactly as before.
 */
export async function sumSaasCardSeconds(cardId: string, from: string, to: string): Promise<number> {
  try {
    const { data, error } = await supabaseAdmin
      .from('saas_time_totals')
      .select('minutes')
      .eq('hub_card_id', cardId)
      .gte('date', from)
      .lte('date', to);
    if (error) return 0;
    return (data || []).reduce((s: number, r: any) => s + Number(r.minutes || 0), 0) * 60;
  } catch {
    return 0;
  }
}
