import { pushTimeTotals } from '../services/bridge/timeTotals';
import { hubBridgeEnabled } from '../utils/hubBridgeClient';
import { todayIST } from '../utils/ist';

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Push yesterday's (and, to catch late edits, the day before's) totals. */
export async function runHubTimeTotals(): Promise<void> {
  if (!hubBridgeEnabled()) {
    console.log('[Hub Time Totals] bridge disabled — skipping');
    return;
  }
  const today = todayIST();
  for (const date of [shiftDate(today, -2), shiftDate(today, -1)]) {
    try {
      const r = await pushTimeTotals(date);
      console.log(`[Hub Time Totals] ${date}: ${r.skipped ? 'nothing to send' : `${r.entries} entr${r.entries === 1 ? 'y' : 'ies'} sent`}`);
    } catch (err: any) {
      console.error(`[Hub Time Totals] ${date} failed:`, err?.message || err);
    }
  }
}

/** Daily at 00:20 IST (18:50 UTC). */
export function startHubTimeTotalsCron(): void {
  function scheduleNext() {
    const now = new Date();
    const target = new Date(now);
    target.setUTCHours(18, 50, 0, 0);
    if (now >= target) target.setUTCDate(target.getUTCDate() + 1);
    setTimeout(async () => {
      await runHubTimeTotals();
      scheduleNext();
    }, target.getTime() - now.getTime());
  }
  scheduleNext();
  console.log('[Hub Time Totals] cron initialized');
}
