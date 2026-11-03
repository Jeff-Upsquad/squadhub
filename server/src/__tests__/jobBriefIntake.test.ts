import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

const db = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, refreshed: vi.fn(), events: vi.fn() }));
vi.mock('../supabase', () => ({ supabaseAdmin: { from: (table: string) => {
  const filters: ((row: any) => boolean)[] = [];
  let action = 'select'; let payload: any;
  function execute() {
    const rows = db.tables[table] ||= [];
    if (action === 'insert') {
      if (rows.some((r) => r.id === payload.id)) return { data: null, error: { message: 'Duplicate primary key' } };
      rows.push({ ...payload, ...(table === 'job_profiles' ? { status: payload.status || 'active' } : {}) });
      return { data: [rows[rows.length - 1]], error: null };
    }
    const matches = rows.filter((r) => filters.every((f) => f(r)));
    if (action === 'update') for (const row of matches) Object.assign(row, payload);
    return { data: structuredClone(matches), error: null };
  }
  const query: any = {
    select: () => query, order: () => query,
    eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
    ilike: (key: string, value: string) => { filters.push((row) => String(row[key] || '').toLowerCase() === value.replace(/\\([_%\\])/g, '$1').toLowerCase()); return query; },
    in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
    is: (key: string, value: unknown) => { filters.push((row) => (row[key] ?? null) === value); return query; },
    or: (value: string) => { const parts = [...value.matchAll(/(\w+)\.in\.\(([^)]+)\)/g)]; filters.push((row) => parts.some((m) => m[2].split(',').includes(row[m[1]]))); return query; },
    insert: (value: any) => { action = 'insert'; payload = value; return query; },
    update: (value: any) => { action = 'update'; payload = value; return query; },
    maybeSingle: async () => { const result = execute(); return { data: result.data?.[0] || null, error: result.error }; },
    single: async () => { const result = execute(); return { data: result.data?.[0] || null, error: result.error }; },
    then: (resolve: any, reject: any) => Promise.resolve(execute()).then(resolve, reject),
  };
  return query;
} } }));
vi.mock('../utils/leadLookup', () => ({ ensureHubContact: async () => ({ submission: db.tables.client_submissions[0], client: null }) }));
vi.mock('../utils/cardCrmAssignees', () => ({ resolveCrmCardAssigneesFromSubmission: async () => ({}) }));
vi.mock('../utils/jobCardEvents', () => ({ logJobCardEvent: db.events }));
vi.mock('../utils/jobProfileDelivery', () => ({ redeliverForBusinessProfile: db.refreshed, redeliverForBrandProfile: db.refreshed, redeliverPublishedCardsForJobProfiles: db.refreshed }));
import router from '../routes/integrations/squadhire-job-brief';

const uuid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const identity = { business_user_id: uuid(1), email: 'owner@example.test', phone: '+919000000000', contact_name: 'Test owner' };
const business = { name: 'Test Business', industry: 'Software', about: 'Our business', contact_email: identity.email };
const brand = { name: 'Test Brand', about: 'Our product', business_profile_id: uuid(3) };
const job = { business_profile_id: uuid(3), brand_profile_id: uuid(4), title: 'Designer', description: 'Design products',
  responsibilities: ['Own product design'], requirements: ['A portfolio'], skills: ['Figma'], employment_type: 'internship', work_mode: 'remote',
  salary_min: 20000, salary_max: 30000, salary_currency: 'INR', salary_period: 'monthly', squadhire_category_ids: [uuid(99)] };
let server: Server; let base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use('/brief', router);
  server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}/brief`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  db.tables = { client_submissions: [{ id: uuid(2), squadhire_business_user_id: uuid(1), email: identity.email }, { id: uuid(22), email: 'other@example.test' }],
    business_profiles: [{ id: uuid(23), lead_submission_id: uuid(22), name: 'Other Business' }],
    brand_profiles: [{ id: uuid(24), business_profile_id: uuid(23), name: 'Other Brand' }],
    business_locations: [{ id: uuid(25), business_profile_id: uuid(23), label: 'Other office' }] };
  db.refreshed.mockReset().mockResolvedValue(undefined); db.events.mockClear();
});
async function call(path: string, body?: any) {
  return fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...identity }) }
    : { method: 'GET' });
}
async function save(kind: string, id: number, data: any) { return call(`/profiles/${kind}`, { id: uuid(id), data }); }
async function setup(withBrand = true) {
  expect((await save('business', 3, business)).status).toBe(200);
  if (withBrand) expect((await save('brand', 4, brand)).status).toBe(200);
  expect((await save('job', 5, { ...job, brand_profile_id: withBrand ? uuid(4) : null })).status).toBe(200);
}
const create = (request = 6) => call('', { request_id: uuid(request), job_profile_id: uuid(5), category_name: 'Designers', openings_count: 2 });

describe('business hiring profiles and card linking', () => {
  it('saves all three canonical profiles and attaches the job to the review card', async () => {
    await setup(); const response = await create(); expect(response.status).toBe(201);
    const { data } = await response.json() as any;
    expect(data.card).toMatchObject({ state: 'onboarding', job_profile_id: uuid(5) });
    expect(data.content).toMatchObject({ brand_name: 'Test Brand', business_profile: { external_id: uuid(3), name: 'Test Business' },
      brand_profile: { external_id: uuid(4) }, job_profile: { external_id: uuid(5), skills: ['Figma'], employment_type: 'internship' } });
    expect(data.card.published_at).toBeFalsy();
    expect(db.refreshed).not.toHaveBeenCalled();
  });
  it('same-as-business links directly to the business without creating a duplicate brand', async () => {
    await setup(false); const { data } = await (await create()).json() as any;
    expect(data.content.brand_profile).toBeNull(); expect(data.content.brand_name).toBe('Test Business');
    expect(db.tables.brand_profiles).toHaveLength(1); // Only the foreign fixture exists.
  });
  it('lists only owned saved profiles and supports multiple brands', async () => {
    await setup(); await save('brand', 7, { ...brand, name: 'Another Brand' });
    const response = await call('/profiles?' + new URLSearchParams(identity));
    const { data } = await response.json() as any;
    expect(data.businesses.map((b: any) => b.name)).toEqual(['Test Business']);
    expect(data.brands).toHaveLength(2); expect(data.jobs[0].id).toBe(uuid(5));
  });
  it('edits the same saved record and refreshes published snapshots', async () => {
    await setup(); const result = await save('brand', 4, { ...brand, name: 'Updated Brand' });
    expect(result.status).toBe(200); expect(db.tables.brand_profiles.filter((b) => b.id === uuid(4))).toHaveLength(1);
    expect(db.tables.brand_profiles.find((b) => b.id === uuid(4)).name).toBe('Updated Brand'); expect(db.refreshed).toHaveBeenCalledWith(uuid(4));
  });
  it('keeps retries on one card and reuses the saved job profile', async () => {
    await setup(); await create(); expect((await create()).status).toBe(200);
    expect(db.tables.job_cards).toHaveLength(1); expect(db.tables.job_profiles).toHaveLength(1);
  });
  it('rejects edits or references to another account’s profiles and locations', async () => {
    await setup();
    expect((await save('business', 23, business)).status).toBe(403);
    expect((await save('brand', 24, brand)).status).toBe(403);
    expect((await save('job', 8, { ...job, brand_profile_id: uuid(24) })).status).toBe(403);
    expect((await save('job', 8, { ...job, location_id: uuid(25) })).status).toBe(403);
    expect((await save('brand', 8, { ...brand, business_profile_id: uuid(23) })).status).toBe(403);
    expect(db.tables.job_profiles).toHaveLength(1);
  });
  it('validates salary ranges, categories, and required physical locations', async () => {
    await setup();
    for (const patch of [{ salary_max: 1 }, { squadhire_category_ids: [] }, { work_mode: 'onsite' }]) {
      expect((await save('job', 8, { ...job, ...patch })).status).toBe(400);
    }
    expect(db.tables.job_profiles).toHaveLength(1);
  });
  it('stores and reuses an owned physical venue', async () => {
    await setup(); expect((await save('location', 9, { business_profile_id: uuid(3), label: 'Office', address: 'Test street', city: 'Kochi', district: 'Ernakulam' })).status).toBe(200);
    expect((await save('job', 5, { ...job, work_mode: 'onsite', location_id: uuid(9) })).status).toBe(200);
    const { data } = await (await create()).json() as any; expect(data.content.job_profile.location.city).toBe('Kochi');
  });
  it('ties outlet locations to an owned brand and broadcasts their details', async () => {
    await setup();
    expect((await save('location', 9, { business_profile_id: uuid(3), brand_profile_id: uuid(4), label: 'Kochi Outlet', address: 'MG Road', city: 'Kochi', district: 'Ernakulam', region: 'Kerala', postal_code: '682016', description: 'Waterfront cafe outlet' })).status).toBe(200);
    const stored = db.tables.business_locations.find((l) => l.id === uuid(9));
    expect(stored.brand_profile_id).toBe(uuid(4)); expect(stored.district).toBe('Ernakulam');
    // A location may only hang off a brand of the SAME business.
    expect((await save('location', 10, { business_profile_id: uuid(3), brand_profile_id: uuid(24), label: 'Bad', address: 'X', district: 'Ernakulam' })).status).toBe(403);
    expect((await save('job', 5, { ...job, work_mode: 'onsite', location_id: uuid(9) })).status).toBe(200);
    const { data } = await (await create()).json() as any;
    expect(data.content.job_profile.location).toMatchObject({ label: 'Kochi Outlet', city: 'Kochi', district: 'Ernakulam', postal_code: '682016', description: 'Waterfront cafe outlet' });
  });
  it('ignores browser-supplied owner columns when creating a business', async () => {
    await save('business', 3, { ...business, lead_submission_id: uuid(22), created_by: uuid(99) });
    const saved = db.tables.business_profiles.find((b) => b.id === uuid(3));
    expect(saved.lead_submission_id).toBe(uuid(2)); expect(saved.created_by).toBeUndefined();
  });
});
