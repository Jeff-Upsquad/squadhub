import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

// Regression guard for the partner-facing Partner Payments numbers. The mini
// app's /month and /history math moved into services/partnerPayments.ts so the
// Squad Hub SaaS bridge serves the SAME figures; the inline snapshots below were
// generated against the pre-refactor route code and must not drift.

const fx = vi.hoisted(() => ({
  isAdmin: false,
  terms: [] as any[],
  cards: [] as any[],
}));

vi.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = 'p1';
    req.userEmail = 'p1@example.com';
    req.userType = 'partner';
    next();
  },
}));

vi.mock('../middleware/miniApp', () => ({
  requireAnyMiniAppOrAdmin: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        order: () => q,
        single: async () => ({ data: { is_admin: fx.isAdmin }, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: any, reject: any) => {
          const data =
            table === 'subscription_assignment_terms' ? fx.terms
            : table === 'subscription_cards' ? fx.cards
            : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  },
}));

vi.mock('../utils/cardBilling', async (importOriginal) => {
  const actual: any = await importOriginal();
  const base = {
    currency: 'INR',
    daily_hours: 4,
    monthly_hours: 80,
    missing_partner_price: false,
    subscription_price: 50000,
    role_name: 'Designer',
  };
  return {
    ...actual,
    loadCardBilling: async (ids: string[]) => {
      const m = new Map<string, any>();
      if (ids.includes('c1')) m.set('c1', { ...base, partner_price: 30000, weekly_hours: 20, plan_snapshot: { plan: { plan: 'Pro', tier: 'Pro', weekly_hours: 20 } } });
      if (ids.includes('c2')) m.set('c2', { ...base, partner_price: 18000, weekly_hours: 10, plan_snapshot: { plan: { plan: 'Lite', tier: 'Junior', weekly_hours: 10 } } });
      return m;
    },
  };
});

vi.mock('../utils/cardHoursCompletion', () => ({
  loadCardHoursCompletions: async (cards: { cardId: string }[], _year: number, month: number) => {
    const m = new Map<string, any>();
    for (const c of cards) {
      if (c.cardId === 'c1') m.set('c1', { additional_hours: month === 9 ? -2 : 1.5, additional_partner_payment: month === 9 ? -750 : 0 });
      if (c.cardId === 'c2') m.set('c2', { additional_hours: 0, additional_partner_payment: 0 });
    }
    return m;
  },
}));

vi.mock('../services/partnerPaymentStatus', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    listPaymentStatusesForRecipient: async () =>
      new Map<string, any>([
        ['2026-09', { status: 'paid', updated_at: '2026-10-03T10:00:00.000Z' }],
        ['2026-08', { status: 'on_hold', hold_reason: 'internal only', updated_at: '2026-09-02T10:00:00.000Z' }],
      ]),
  };
});

vi.mock('../utils/squadhireTalent', () => ({ fetchTalentAvailability: async () => null }));

import router from '../routes/partner-payments-miniapp';

let server: Server;
let base = '';

async function get(path: string) {
  const r = await fetch(base + path);
  return { status: r.status, body: (await r.json()) as any };
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T06:00:00.000Z'));
  const app = express();
  app.use(express.json());
  app.use('/partner-payments', router);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  vi.useRealTimers();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  fx.isAdmin = false;
  fx.terms = [
    // Current engagement on c1 (no frozen price → card's live billing).
    { id: 't1', card_id: 'c1', recipient_type: 'talent', recipient_id: 'p1', recipient_name: 'P One', business_name: 'Acme', subscription_name: 'Design Pro', assigned_date: '2026-09-15T05:00:00.000Z', unassigned_date: null, work_start_date: '2026-09-15', work_end_date: null, status: 'active', plan_snapshot: null, partner_price: null, subscription_price: null, currency: null },
    // Ended engagement on c2 with a frozen term price (migration 152).
    { id: 't2', card_id: 'c2', recipient_type: 'talent', recipient_id: 'p1', recipient_name: 'P One', business_name: 'Beta', subscription_name: 'Design Lite', assigned_date: '2026-08-01T05:00:00.000Z', unassigned_date: '2026-10-10T05:00:00.000Z', work_start_date: '2026-08-01', work_end_date: '2026-10-10', status: 'ended', plan_snapshot: { plan: { plan: 'Lite', tier: 'Junior', weekly_hours: 12 } }, partner_price: 20000, subscription_price: 40000, currency: 'INR' },
    // Older slice on the same card c1 (pre plan change).
    { id: 't3', card_id: 'c1', recipient_type: 'talent', recipient_id: 'p1', recipient_name: 'P One', business_name: 'Acme', subscription_name: 'Design', assigned_date: '2026-07-01T05:00:00.000Z', unassigned_date: '2026-09-14T05:00:00.000Z', work_start_date: '2026-07-01', work_end_date: '2026-09-14', status: 'ended', plan_snapshot: null, partner_price: 25000, subscription_price: null, currency: null },
  ];
  fx.cards = [
    { id: 'c1', state: 'assigned', paused_at: null, cancelled_at: null },
    { id: 'c2', state: 'cancelled', paused_at: null, cancelled_at: '2026-10-10T05:00:00.000Z' },
  ];
});

describe('partner-payments mini app (partner-facing numbers)', () => {
  it('/month for a split month (September)', async () => {
    const r = await get('/partner-payments/month?month=2026-09');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchInlineSnapshot(`
      {
        "clients": [
          {
            "additional_hours": -2,
            "additional_payment": -750,
            "business_name": "Acme",
            "card_cancelled_at": null,
            "card_paused_at": null,
            "card_state": "assigned",
            "committed_weekly_hours": 20,
            "currency": "INR",
            "end_date": null,
            "month_active_days": 16,
            "month_payment": 16000,
            "plan_label": "Pro",
            "plan_tier": "Pro",
            "start_date": "2026-09-15",
            "status": "active",
            "subscription_name": "Design Pro",
            "term_id": "t1",
          },
          {
            "additional_hours": 0,
            "additional_payment": 0,
            "business_name": "Beta",
            "card_cancelled_at": "2026-10-10T05:00:00.000Z",
            "card_paused_at": null,
            "card_state": "cancelled",
            "committed_weekly_hours": 12,
            "currency": "INR",
            "end_date": "2026-10-10",
            "month_active_days": 30,
            "month_payment": 20000,
            "plan_label": "Lite",
            "plan_tier": "Junior",
            "start_date": "2026-08-01",
            "status": "ended",
            "subscription_name": "Design Lite",
            "term_id": "t2",
          },
          {
            "additional_hours": -2,
            "additional_payment": -750,
            "business_name": "Acme",
            "card_cancelled_at": null,
            "card_paused_at": null,
            "card_state": "assigned",
            "committed_weekly_hours": 20,
            "currency": "INR",
            "end_date": "2026-09-14",
            "month_active_days": 14,
            "month_payment": 11667,
            "plan_label": "Pro",
            "plan_tier": "Pro",
            "start_date": "2026-07-01",
            "status": "ended",
            "subscription_name": "Design",
            "term_id": "t3",
          },
        ],
        "month": "2026-09",
        "totals": {
          "additional_hours": -2,
          "committed_weekly_hours": 32,
          "month_payments": [
            {
              "amount": 46917,
              "currency": "INR",
            },
          ],
        },
      }
    `);
  });

  it('/month defaults to the current month', async () => {
    const r = await get('/partner-payments/month');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchInlineSnapshot(`
      {
        "clients": [
          {
            "additional_hours": 1.5,
            "additional_payment": 0,
            "business_name": "Acme",
            "card_cancelled_at": null,
            "card_paused_at": null,
            "card_state": "assigned",
            "committed_weekly_hours": 20,
            "currency": "INR",
            "end_date": null,
            "month_active_days": 20,
            "month_payment": 19355,
            "plan_label": "Pro",
            "plan_tier": "Pro",
            "start_date": "2026-09-15",
            "status": "active",
            "subscription_name": "Design Pro",
            "term_id": "t1",
          },
          {
            "additional_hours": 0,
            "additional_payment": 0,
            "business_name": "Beta",
            "card_cancelled_at": "2026-10-10T05:00:00.000Z",
            "card_paused_at": null,
            "card_state": "cancelled",
            "committed_weekly_hours": 12,
            "currency": "INR",
            "end_date": "2026-10-10",
            "month_active_days": 10,
            "month_payment": 6452,
            "plan_label": "Lite",
            "plan_tier": "Junior",
            "start_date": "2026-08-01",
            "status": "ended",
            "subscription_name": "Design Lite",
            "term_id": "t2",
          },
        ],
        "month": "2026-10",
        "totals": {
          "additional_hours": 1.5,
          "committed_weekly_hours": 32,
          "month_payments": [
            {
              "amount": 25807,
              "currency": "INR",
            },
          ],
        },
      }
    `);
  });

  it('/history (4 months) carries partner-facing statuses only', async () => {
    const r = await get('/partner-payments/history?months=4');
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain('internal only');
    expect(r.body.data).toMatchInlineSnapshot(`
      {
        "current_month": "2026-10",
        "payouts": [
          {
            "commission_status": "pending",
            "committed_weekly_hours": 20,
            "expected_post_date": "2026-08-01",
            "lines": [
              {
                "amount": 25000,
                "client": "Acme",
                "currency": "INR",
              },
            ],
            "month": "2026-07",
            "payments": [
              {
                "amount": 25000,
                "currency": "INR",
              },
            ],
            "post_date": null,
          },
          {
            "commission_status": "pending",
            "committed_weekly_hours": 32,
            "expected_post_date": "2026-09-01",
            "lines": [
              {
                "amount": 20000,
                "client": "Beta",
                "currency": "INR",
              },
              {
                "amount": 25000,
                "client": "Acme",
                "currency": "INR",
              },
            ],
            "month": "2026-08",
            "payments": [
              {
                "amount": 45000,
                "currency": "INR",
              },
            ],
            "post_date": null,
          },
          {
            "commission_status": "paid",
            "committed_weekly_hours": 32,
            "expected_post_date": "2026-10-01",
            "lines": [
              {
                "amount": 15250,
                "client": "Acme",
                "currency": "INR",
                "note": "prorated · 16 active days · -2 add’l hrs",
              },
              {
                "amount": 20000,
                "client": "Beta",
                "currency": "INR",
              },
              {
                "amount": 11667,
                "client": "Acme",
                "currency": "INR",
                "note": "prorated · 14 active days",
              },
            ],
            "month": "2026-09",
            "payments": [
              {
                "amount": 46917,
                "currency": "INR",
              },
            ],
            "post_date": "2026-10-03T10:00:00.000Z",
          },
          {
            "commission_status": "pending",
            "committed_weekly_hours": 32,
            "expected_post_date": "2026-11-01",
            "lines": [
              {
                "amount": 19355,
                "client": "Acme",
                "currency": "INR",
                "note": "prorated · 20 active days",
              },
              {
                "amount": 6452,
                "client": "Beta",
                "currency": "INR",
                "note": "prorated · 10 active days",
              },
            ],
            "month": "2026-10",
            "payments": [
              {
                "amount": 25807,
                "currency": "INR",
              },
            ],
            "post_date": null,
          },
        ],
      }
    `);
  });

  it('/history clamps the month count (default 12, max 24)', async () => {
    expect((await get('/partner-payments/history')).body.data.payouts).toHaveLength(12);
    expect((await get('/partner-payments/history?months=99')).body.data.payouts).toHaveLength(24);
    expect((await get('/partner-payments/history?months=0')).body.data.payouts).toHaveLength(1);
    expect((await get('/partner-payments/history?months=abc')).body.data.payouts).toHaveLength(12);
  });
});
