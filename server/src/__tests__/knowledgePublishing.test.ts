import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const state = vi.hoisted(() => ({
  item: {} as Record<string, unknown>,
  pages: [{ id: 'ready', is_active: true }, { id: 'unfinished', is_active: false }],
}));

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: any = new Proxy({}, {
        get(_target, property) {
          if (property === 'update') return (patch: Record<string, unknown>) => {
            if (table === 'lms_items') Object.assign(state.item, patch);
            if (table === 'lms_lessons') state.pages.forEach((page) => Object.assign(page, patch));
            return chain;
          };
          if (property === 'single' || property === 'maybeSingle') return async () => ({ data: state.item, error: null });
          if (property === 'then') return (resolve: (value: unknown) => void) => resolve({ data: [], error: null });
          return () => chain;
        },
      });
      return chain;
    },
  },
}));
vi.mock('../middleware/auth', () => ({ requireAuth: vi.fn() }));
vi.mock('../middleware/admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('../services/lmsAccess', () => ({ getItemAccess: vi.fn(async () => 'admin'), meetsAccess: vi.fn(() => true), getItemApproverUserIds: vi.fn() }));
vi.mock('../services/taskMirror', () => ({ mirrorCourseItem: vi.fn(async () => undefined) }));
vi.mock('../services/lmsAuthoring', () => ({ applyRevision: vi.fn(), discardClone: vi.fn(), notifyLms: vi.fn(), cloneItemForReview: vi.fn() }));
vi.mock('../services/lmsTaskSends', () => ({ createSend: vi.fn(), resendSend: vi.fn(), deleteSend: vi.fn(), autoResendForItem: vi.fn(), listSendsForItem: vi.fn(), recipientsForSend: vi.fn() }));
vi.mock('../services/lmsBlockVideos', () => ({ loadBlockVideos: vi.fn(), withBlockVideos: vi.fn() }));
vi.mock('../services/squadBots', () => ({ HIRING_BOT_SLUG: 'hiring', botIdForSlug: vi.fn(), isSquadhireBot: vi.fn() }));
vi.mock('../services/squadhireTraining', () => ({
  fetchKnowledgeCategories: vi.fn(), isSquadhireSynced: vi.fn(() => true), retractKnowledgeFromSquadhire: vi.fn(), syncContentToSquadhire: vi.fn(), syncItemToSquadhire: vi.fn(),
}));

import adminRouter from '../routes/lms-admin';
import collabRouter from '../routes/lms-collab';
import { syncItemToSquadhire } from '../services/squadhireTraining';

beforeEach(() => {
  vi.clearAllMocks();
  state.item = { id: 'doc', kind: 'post', track: 'knowledge', status: 'draft', published_at: null };
  state.pages = [{ id: 'ready', is_active: true }, { id: 'unfinished', is_active: false }];
});

describe.each([['admin', adminRouter], ['main app', collabRouter]] as const)('%s document publishing', (_name, router) => {
  async function publish() {
    const layer = router.stack.find((entry: any) => entry.route?.path === '/items/:id/publish' && entry.route.methods.post);
    if (!layer?.route) throw new Error('Publish route not found');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await layer.route.stack[0].handle({ params: { id: 'doc' }, userId: 'admin' } as unknown as Request, res as unknown as Response, vi.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  }

  it('publishes knowledge without exposing unfinished pages', async () => {
    await publish();
    expect(state.item.status).toBe('published');
    expect(state.pages.map((page) => page.is_active)).toEqual([true, false]);
    expect(syncItemToSquadhire).toHaveBeenCalledWith('doc');
  });

  it('still publishes the content page for ordinary posts', async () => {
    state.item.track = 'learning';
    await publish();
    expect(state.pages.every((page) => page.is_active)).toBe(true);
  });
});
