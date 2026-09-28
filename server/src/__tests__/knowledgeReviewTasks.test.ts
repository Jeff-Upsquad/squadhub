import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows: Record<string, any[]> = {};
const writes: Array<{ table: string; method: string; value: any }> = [];
const mirror = vi.fn(async (_recipientId: string, _opts: { reopen?: boolean }) => {});

function query(table: string) {
  let method = 'select';
  let value: any;
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    insert: (v: any) => { method = 'insert'; value = v; writes.push({ table, method, value }); return chain; },
    update: (v: any) => { method = 'update'; value = v; writes.push({ table, method, value }); return chain; },
    upsert: (v: any) => { method = 'upsert'; value = v; writes.push({ table, method, value }); return chain; },
    maybeSingle: async () => ({ data: (rows[table] || [])[0] ?? null, error: null }),
    single: async () => ({
      data: method === 'insert' && table === 'lms_task_sends'
        ? { id: 'send-1', version: 1 }
        : method === 'upsert' && table === 'lms_task_send_recipients'
          ? { id: 'recipient-1' }
          : (rows[table] || [])[0] ?? null,
      error: null,
    }),
    then: (resolve: (v: any) => void) => resolve({ data: rows[table] || [], error: null }),
  };
  return chain;
}

vi.mock('../supabase', () => ({ supabaseAdmin: { from: (table: string) => query(table) } }));
vi.mock('../services/taskMirror', () => ({
  mirrorResourceRecipient: (recipientId: string, opts: { reopen?: boolean }) => mirror(recipientId, opts),
}));

import { reconcileKnowledgeReviews } from '../services/knowledgeReviewTasks';

beforeEach(() => {
  for (const key of Object.keys(rows)) delete rows[key];
  writes.length = 0;
  mirror.mockClear();
  rows.lms_knowledge_review_config = [{ reviewer_user_id: 'reviewer-1' }];
  rows.lms_knowledge_review_changes = [{
    item_id: 'item-1', page_key: 'page-1', lesson_id: 'page-1', revision: 2, processed_revision: 0,
  }];
  rows.lms_items = [{ id: 'item-1', title: 'Bot handbook', track: 'knowledge', status: 'published', origin_item_id: null }];
  rows.lms_lessons = [{ id: 'page-1', title: 'Hiring rules' }];
  rows.lms_task_send_recipients = [{ id: 'recipient-1' }];
  rows.tasks = [{ id: 'task-1' }];
});

describe('knowledge review task reconciliation', () => {
  it('creates one page-scoped Resources task for a new review', async () => {
    rows.lms_task_sends = [];
    expect(await reconcileKnowledgeReviews()).toBe(1);
    expect(writes.find((w) => w.table === 'lms_task_sends' && w.method === 'insert')?.value)
      .toMatchObject({ scope: 'lesson', lesson_id: 'page-1', source_kind: 'knowledge', knowledge_review_key: 'item-1:page-1' });
    expect(mirror).toHaveBeenCalledWith('recipient-1', { reopen: false });
    expect(writes.find((w) => w.table === 'lms_knowledge_review_changes' && w.method === 'update')?.value.processed_revision).toBe(2);
  });

  it('reopens the existing task when its page changes again', async () => {
    rows.lms_task_sends = [{ id: 'send-1', version: 4 }];
    expect(await reconcileKnowledgeReviews()).toBe(1);
    expect(writes.find((w) => w.table === 'lms_task_sends' && w.method === 'update')?.value)
      .toMatchObject({ version: 5, title: 'Review knowledge page: Hiring rules' });
    expect(mirror).toHaveBeenCalledWith('recipient-1', { reopen: true });
  });
});
