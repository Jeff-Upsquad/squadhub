import { beforeEach, expect, it, vi } from 'vitest';

const { rows } = vi.hoisted(() => ({ rows: {} as Record<string, any[]> }));
vi.mock('../config', () => ({ config: { squadhireWebhookUrl: '', squadhireWebhookSecret: '' } }));
vi.mock('../utils/clientExternalLinks', () => ({
  resolveHireBusinessUserIdForCardDelivery: vi.fn(async () => null),
}));
vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const result = () => (rows[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value));
      const chain: any = new Proxy({}, {
        get(_target, prop) {
          if (prop === 'then') return (resolve: any) => resolve({ data: result(), error: null });
          if (prop === 'maybeSingle') return async () => ({ data: result()[0] ?? null, error: null });
          if (prop === 'eq') return (key: string, value: unknown) => { filters.push([key, value]); return chain; };
          return () => chain;
        },
      });
      return chain;
    },
  },
}));

import { buildSquadhirePayloadForCard } from '../utils/squadhireWebhook';

beforeEach(() => {
  for (const key of Object.keys(rows)) delete rows[key];
  rows.subscription_cards = [{
    id: 'card', state: 'published', published_at: '2026-10-26T05:38:35Z',
    source: 'internal_brief', card_type: 'subscription', distribution: 'broadcast',
    publish_targets: ['talent'], squadhire_category_ids: ['editors'],
    target_tiers: ['Junior'], lead_submission_id: 'customer', subscription_price: 3000,
    plan_snapshot: { pricing: [
      { country_id: 'india', price: 3000, margin_value: 1000, margin_type: 'fixed' },
      { country_id: 'usa', price: 30, margin_value: 0, margin_type: 'fixed' },
    ], partner_pricing: [{ country_id: 'india', price: 2000 }] },
  }];
  rows.client_submissions = [{ id: 'customer', country_id: 'india' }];
  rows.countries = [{ id: 'india', currency: 'INR' }, { id: 'usa', currency: 'USD' }];
});

it('uses the linked customer country for a brief with multiple catalog currencies', async () => {
  const payload = await buildSquadhirePayloadForCard('card');
  expect(payload?.content).toMatchObject({ customer_monthly_price: 3000, monthly_price: 2000, currency: 'INR' });
});

it('keeps the saved margin when the customer price changes', async () => {
  rows.subscription_cards[0].subscription_price = 5000;
  const payload = await buildSquadhirePayloadForCard('card');
  expect(payload?.content).toMatchObject({ customer_monthly_price: 5000, monthly_price: 4000 });
});

it('prefers an explicit target country over the customer country', async () => {
  rows.subscription_card_target_countries = [{ card_id: 'card', country_id: 'usa', countries: { name: 'USA' } }];
  const payload = await buildSquadhirePayloadForCard('card');
  expect(payload?.content.monthly_price).toBe(3000);
});
