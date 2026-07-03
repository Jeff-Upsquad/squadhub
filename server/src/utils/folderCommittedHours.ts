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
  const { data: card } = await supabaseAdmin
    .from('subscription_cards')
    .select('id, plan_snapshot, working_days, billing_start_date, linked_at')
    .eq('linked_folder_id', folderId)
    .maybeSingle();
  if (!card) return { hasCard: false, segments: [], workingDays: parseWorkingDays(null) };

  const workingDays = parseWorkingDays((card as any).working_days);
  const cardSnap = (card as any).plan_snapshot;

  const { data: terms } = await supabaseAdmin
    .from('subscription_assignment_terms')
    .select('work_start_date, work_end_date, assigned_date, unassigned_date, plan_snapshot')
    .eq('card_id', (card as any).id)
    .order('assigned_date', { ascending: true });

  const segments: FolderPlanTimeline['segments'] = [];
  for (const t of (terms || []) as any[]) {
    const start = t.work_start_date ?? (t.assigned_date ? String(t.assigned_date).slice(0, 10) : null);
    if (!start) continue;
    const end = t.work_end_date ?? (t.unassigned_date ? String(t.unassigned_date).slice(0, 10) : null);
    const snap = t.plan_snapshot ?? cardSnap;
    segments.push({ start, end, daily: snapDaily(snap), weekly: snapWeekly(snap) });
  }

  // Fallback: card linked but no terms recorded — one open segment from the
  // billing start / link date using the card's live snapshot.
  if (segments.length === 0 && cardSnap) {
    const linkedAt = (card as any).linked_at;
    const start =
      (card as any).billing_start_date ??
      (typeof linkedAt === 'string' ? linkedAt.slice(0, 10) : istTodayISO());
    segments.push({ start, end: null, daily: snapDaily(cardSnap), weekly: snapWeekly(cardSnap) });
  }

  return { hasCard: true, segments, workingDays };
}

/** Resolve the period-aware committed-hours figures for a folder, as of today
 *  (IST). Used by the link-status endpoint and the public share view. */
export async function resolveFolderCommittedHours(folderId: string): Promise<FolderCommittedHours> {
  const tl = await getFolderPlanTimeline(folderId);
  return computeCommittedFromTimeline(tl, istTodayISO());
}
