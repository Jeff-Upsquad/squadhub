// ============================================================
// folderCommittedHours
//
// Period-aware committed-hours for a Design/Video space. The space's linked
// card can change plan mid-engagement (upgrade/downgrade), so a single
// plan_snapshot no longer describes the whole timeline. Instead we build a
// timeline from the card's assignment terms — each carries its own frozen plan
// snapshot (migration 152) — and resolve the daily target per day: old plan
// before the change date, new plan after. The monthly target is the sum of each
// WORKING day's target, so a mid-month change reads as a blended figure.
//
// Pure math lives in folderCommittedHoursMath.ts (unit-tested); this module
// only builds the timeline from the DB and composes the result.
// ============================================================
import { supabaseAdmin } from '../supabase';
import {
  type FolderPlanTimeline,
  type FolderCommittedHours,
  parseWorkingDays,
  snapDaily,
  snapWeekly,
  istTodayISO,
  computeCommittedFromTimeline,
} from './folderCommittedHoursMath';

export * from './folderCommittedHoursMath';

/** Build the plan timeline for the card linked to this folder from its terms. */
export async function getFolderPlanTimeline(folderId: string): Promise<FolderPlanTimeline> {
  // linked_folder_id has no unique constraint, so a folder can accumulate more
  // than one card over its life (e.g. a cancelled subscription followed by its
  // replacement). maybeSingle() would ERROR on that and read as "no card" —
  // instead prefer the live card, else the most recently linked.
  const { data: cards } = await supabaseAdmin
    .from('subscription_cards')
    .select('id, plan_snapshot, working_days, billing_start_date, linked_at, state, paused_at, supersedes_card_id')
    .eq('linked_folder_id', folderId)
    .order('linked_at', { ascending: false, nullsFirst: false });
  const list = (cards || []) as any[];
  const card = list.find((c) => c.state !== 'closed') ?? list[0] ?? null;
  if (!card) return { hasCard: false, segments: [], workingDays: parseWorkingDays(null) };

  const workingDays = parseWorkingDays((card as any).working_days);
  const cardSnap = (card as any).plan_snapshot;

  // Walk the supersedes chain back from the linked card: an upgrade/downgrade
  // soft-cancels the old card and links the new one to this folder, so the old
  // card's terms (its share of the timeline) live under a DIFFERENT card_id. Pull
  // terms for the whole lineage so Reports stay continuous across the change.
  const chainIds: string[] = [(card as any).id];
  let cursor = (card as any).supersedes_card_id as string | null;
  for (let hops = 0; cursor && hops < 25; hops++) {
    if (chainIds.includes(cursor)) break;
    chainIds.push(cursor);
    const { data: prev } = await supabaseAdmin
      .from('subscription_cards')
      .select('supersedes_card_id')
      .eq('id', cursor)
      .maybeSingle();
    cursor = (prev as any)?.supersedes_card_id ?? null;
  }

  const { data: terms } = await supabaseAdmin
    .from('subscription_assignment_terms')
    .select('work_start_date, work_end_date, assigned_date, unassigned_date, plan_snapshot')
    .in('card_id', chainIds)
    .order('assigned_date', { ascending: true });

  const segments: FolderPlanTimeline['segments'] = [];
  for (const t of (terms || []) as any[]) {
    const start = t.work_start_date ?? (t.assigned_date ? String(t.assigned_date).slice(0, 10) : null);
    if (!start) continue;
    const end = t.work_end_date ?? (t.unassigned_date ? String(t.unassigned_date).slice(0, 10) : null);
    const snap = t.plan_snapshot ?? cardSnap;
    segments.push({ start, end, daily: snapDaily(snap), weekly: snapWeekly(snap) });
  }

  // Fallback: card linked but no terms recorded (pre-ledger engagements) —
  // one segment from the billing start / link date using the card's live
  // snapshot. Term-less cards have nothing for pause/cancel to end, so cap
  // the segment at the pause date (or drop it when the card is closed) —
  // otherwise a paused/cancelled legacy card keeps reporting full committed
  // hours forever.
  if (segments.length === 0 && cardSnap && (card as any).state !== 'closed') {
    const linkedAt = (card as any).linked_at;
    const start =
      (card as any).billing_start_date ??
      (typeof linkedAt === 'string' ? linkedAt.slice(0, 10) : istTodayISO());
    const pausedAt = (card as any).paused_at as string | null;
    // Pause-day is unbilled (terms end the day before) — mirror that here.
    let end: string | null = null;
    if (pausedAt) {
      const d = new Date(String(pausedAt).slice(0, 10) + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - 1);
      end = d.toISOString().slice(0, 10);
    }
    segments.push({ start, end, daily: snapDaily(cardSnap), weekly: snapWeekly(cardSnap) });
  }

  return { hasCard: true, segments, workingDays };
}

/** Resolve the period-aware committed-hours figures for a folder, as of today
 *  (IST). Used by the link-status endpoint and the public share view. */
export async function resolveFolderCommittedHours(folderId: string): Promise<FolderCommittedHours> {
  const tl = await getFolderPlanTimeline(folderId);
  return computeCommittedFromTimeline(tl, istTodayISO());
}
