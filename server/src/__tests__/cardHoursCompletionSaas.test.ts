import { beforeEach, describe, expect, it, vi } from 'vitest';

// Card hours completion folds in SaaS-pushed daily totals (saas_time_totals).
// Without rows — or before the migration exists — the figures must be exactly
// what they were (tracked + elapsed only).

const st = vi.hoisted(() => ({
  saas: { data: [] as any[] | null, error: null as any },
  saasQueries: 0,
}));

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'saas_time_totals') st.saasQueries += 1;
      const q: any = {
        select: () => q,
        eq: () => q,
        gte: () => q,
        lte: () => q,
        upsert: async () => ({ error: null }),
        then: (resolve: any, reject: any) =>
          Promise.resolve(table === 'saas_time_totals' ? st.saas : { data: [], error: null }).then(resolve, reject),
      };
      return q;
    },
  },
}));

vi.mock('../utils/folderCommittedHours', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getFolderPlanTimeline: async () => ({ hasCard: true }),
    committedHoursForRange: () => 80,
  };
});

vi.mock('../services/folderShareMetrics', () => ({
  aggregateFolderTimeSummary: async () => [{ total_work_seconds: 60 * 3600 }, { total_work_seconds: 10 * 3600 }],
  aggregateFolderElapsedSummary: async () => [{ elapsed_seconds: 2 * 3600 }],
}));

import { computeCardHoursCompletion } from '../utils/cardHoursCompletion';

const billing: any = {
  partner_price: 40000,
  subscription_price: 80000,
  currency: 'INR',
  daily_hours: 4,
  weekly_hours: 20,
  monthly_hours: 80,
  missing_partner_price: false,
  plan_snapshot: null,
};

async function run(folder: string | null = 'folder-1') {
  return computeCardHoursCompletion('card-1', folder, 2026, 10, billing, { persist: false });
}

beforeEach(() => {
  st.saas = { data: [], error: null };
  st.saasQueries = 0;
});

describe('computeCardHoursCompletion + SaaS time totals', () => {
  it('no SaaS rows → tracked + elapsed only (unchanged)', async () => {
    const r = await run();
    expect(r.actual_hours).toBe(72);
    expect(r.additional_hours).toBe(-8);
    expect(r.additional_partner_payment).toBe(-4000);
    expect(r.additional_revenue).toBe(-8000);
  });

  it('saas_time_totals missing (migration not applied) → reads as 0, same figures', async () => {
    st.saas = { data: null, error: { message: 'relation "public.saas_time_totals" does not exist' } };
    const r = await run();
    expect(r.actual_hours).toBe(72);
    expect(r.additional_partner_payment).toBe(-4000);
  });

  it('SaaS rows add their minutes to actual hours', async () => {
    st.saas = { data: [{ minutes: 240 }, { minutes: 180 }], error: null };
    const r = await run();
    expect(r.actual_hours).toBe(79);
    expect(r.additional_hours).toBe(-1);
    expect(r.additional_partner_payment).toBe(-500);
  });

  it('no linked space → zeros and no SaaS lookup', async () => {
    st.saas = { data: [{ minutes: 600 }], error: null };
    const r = await run(null);
    expect(r.actual_hours).toBe(0);
    expect(r.additional_partner_payment).toBe(0);
    expect(st.saasQueries).toBe(0);
  });
});
