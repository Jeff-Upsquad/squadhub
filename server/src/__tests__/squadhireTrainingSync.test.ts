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

import { syncContentToSquadhire } from '../services/squadhireTraining';

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
    syncContentToSquadhire('item-4');
    await flushAndAdvance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('https://squadhire.example.com/api/integrations/squadhub/knowledge/sync');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ id: 'item-4', visible: true, knowledge_categories: ['general'] });
    expect(body.track).toBeUndefined();
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
