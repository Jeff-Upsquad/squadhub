import type { QueryClient } from '@tanstack/react-query';
import api from '../services/api';

interface FutureRow {
  plan_date: string;
  start_minute: number;
}

// Real day-plan overrides for a task on dates after `afterDate`, read from the
// React Query cache. Virtual rows (wb:/rec: prefixes, optimistic temps) are
// excluded — only persisted overrides need rewriting.
export function collectFutureDayPlans(
  qc: QueryClient,
  taskId: string,
  afterDate: string,
): FutureRow[] {
  const out: FutureRow[] = [];
  for (const [, data] of qc.getQueriesData({ queryKey: ['day-plans'] }) as Array<[unknown, unknown]>) {
    if (!Array.isArray(data)) continue;
    for (const p of data as Array<any>) {
      if (!p || p.task_id !== taskId) continue;
      if (typeof p.plan_date !== 'string' || p.plan_date <= afterDate) continue;
      if (p.virtual === true) continue;
      if (typeof p.id === 'string' && (p.id.startsWith('wb:') || p.id.startsWith('rec:') || p.id.startsWith('optimistic'))) continue;
      out.push({ plan_date: p.plan_date, start_minute: p.start_minute });
    }
  }
  return out;
}

// Rewrite the duration of each future override, keeping its own start time.
export async function propagateDurationToFutureDayPlans(
  rows: FutureRow[],
  taskId: string,
  duration: number,
): Promise<void> {
  await Promise.all(
    rows.map((r) =>
      api.post('/pm/day-plans', {
        task_id: taskId,
        plan_date: r.plan_date,
        start_minute: r.start_minute,
        duration_minutes: duration,
      }),
    ),
  );
}
