import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config', () => ({
  config: {
    squadhireWebhookUrl: 'https://squadhire.example.com/hook',
    squadhireWebhookSecret: 'test-secret',
  },
}));

const tableRows: Record<string, any[]> = {};

function chainFor(table: string): any {
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) =>
            resolve({ data: tableRows[table] ?? [], error: null });
        }
        if (prop === 'maybeSingle' || prop === 'single') {
          return async () => ({ data: (tableRows[table] ?? [])[0] ?? null, error: null });
        }
        return () => chain;
      },
    },
  );
  return chain;
}

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => chainFor(table),
  },
}));

const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '' }));
vi.stubGlobal('fetch', fetchMock);

import { deliver, syncContentToSquadhire } from '../services/squadhireTraining';

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockClear();
  for (const k of Object.keys(tableRows)) delete tableRows[k];
});

async function flushAndAdvance(ms: number) {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(ms);
}

describe('syncContentToSquadhire', () => {
  it('ignores a null item id', async () => {
    syncContentToSquadhire(null);
    await flushAndAdvance(30_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips items without the SquadHire audience flag', async () => {
    tableRows.lms_items = [{ id: 'item-1', squadhire_audience: false }];
    syncContentToSquadhire('item-1');
    await flushAndAdvance(30_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('delivers an agency-only document without exposing it to talents', async () => {
    tableRows.lms_items = [{
      id: 'agency-item', kind: 'post', track: 'learning', title: 'Training Program Agencies',
      status: 'published', squadhire_audience: false, squadhire_agency_audience: true,
    }];
    tableRows.lms_lessons = [];
    await deliver('agency-item');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('https://squadhire.example.com/api/integrations/squadhub/training/sync');
    expect(JSON.parse(init.body)).toMatchObject({
      id: 'agency-item', visible: true, audiences: { talent: false, agency: true },
    });
  });

  it('pushes once for a burst of saves on a flagged item', async () => {
    tableRows.lms_items = [
      {
        id: 'item-2',
        kind: 'post',
        track: 'sop',
        title: 'Onboarding',
        status: 'published',
        squadhire_audience: true,
      },
    ];
    tableRows.lms_lessons = [];
    syncContentToSquadhire('item-2');
    syncContentToSquadhire('item-2');
    syncContentToSquadhire('item-2');
    await flushAndAdvance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await flushAndAdvance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('pushes again for edits saved after the first push', async () => {
    tableRows.lms_items = [
      {
        id: 'item-3',
        kind: 'course',
        track: 'learning',
        title: 'Course',
        status: 'published',
        squadhire_audience: true,
      },
    ];
    tableRows.lms_lessons = [];
    syncContentToSquadhire('item-3');
    await flushAndAdvance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    syncContentToSquadhire('item-3');
    await flushAndAdvance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends knowledge items to the knowledge endpoint with their categories', async () => {
    tableRows.lms_items = [
      {
        id: 'item-4',
        kind: 'post',
        track: 'knowledge',
        title: 'When do I get paid?',
        status: 'published',
        squadhire_audience: false,
        knowledge_categories: ['general'],
      },
    ];
    tableRows.lms_lessons = [];
    tableRows.squad_bot_knowledge_docs = [{ item_id: 'item-4', bot: { id: 'hire', home_app: 'squadhire' } }];
    syncContentToSquadhire('item-4');
    await flushAndAdvance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('https://squadhire.example.com/api/integrations/squadhub/knowledge/sync');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ id: 'item-4', visible: true, knowledge_categories: ['general'] });
    expect(body.track).toBeUndefined();
  });

  it('sends one shared doc when any linked bot uses SquadHire', async () => {
    tableRows.lms_items = [
      { id: 'item-6', kind: 'post', track: 'knowledge', title: 'Hiring answer', status: 'published', knowledge_categories: [], bot_id: 'bot-hire' },
    ];
    tableRows.squad_bot_knowledge_docs = [
      { item_id: 'item-6', bot: { id: 'crm', home_app: 'squad_crm' } },
      { item_id: 'item-6', bot: { id: 'hire', home_app: 'squadhire' } },
    ];
    tableRows.lms_lessons = [];
    syncContentToSquadhire('item-6');
    await flushAndAdvance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retracts knowledge when only bots outside SquadHire remain linked', async () => {
    tableRows.lms_items = [
      { id: 'item-7', kind: 'post', track: 'knowledge', title: 'Pricing answer', status: 'published', knowledge_categories: [], bot_id: 'bot-crm' },
    ];
    tableRows.squad_bot_knowledge_docs = [{ item_id: 'item-7', bot: { id: 'crm', home_app: 'squad_crm' } }];
    syncContentToSquadhire('item-7');
    await flushAndAdvance(10_000);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ id: 'item-7', visible: false, pages: [], summary: null, knowledge_categories: [] });
    expect(body.title).not.toBe('Pricing answer');
  });

  it('withdraws an unpublished knowledge item', async () => {
    tableRows.lms_items = [
      { id: 'item-5', kind: 'post', track: 'knowledge', title: 'Old answer', status: 'draft', knowledge_categories: ['tech'] },
    ];
    syncContentToSquadhire('item-5');
    await flushAndAdvance(10_000);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ id: 'item-5', visible: false, pages: [] });
  });
});

it('never sends a contributor draft clone to SquadHire', async () => {
  tableRows.lms_items = [{ id: 'clone', track: 'knowledge', origin_item_id: 'original', status: 'published' }];
  await deliver('clone');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('withdraws a knowledge doc with no bots while keeping it in SquadHub', async () => {
  tableRows.lms_items = [{ id: 'unlinked', track: 'knowledge', status: 'published' }];
  tableRows.squad_bot_knowledge_docs = [];
  await deliver('unlinked');
  const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
  expect(body).toMatchObject({ id: 'unlinked', visible: false, pages: [] });
});
