import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../supabase', () => ({ supabaseAdmin: db }));
import { cleanupKnowledgeReviewOrphans } from '../services/taskMirror';
beforeEach(() => { vi.clearAllMocks(); });
describe('knowledge review orphan cleanup transport', () => {
  it('returns the database deletion count without downloading IDs', async () => {
    db.rpc.mockResolvedValue({ data: 3, error: null });
    expect(await cleanupKnowledgeReviewOrphans()).toBe(3);
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith('cleanup_knowledge_review_orphans');
    expect(db.from).not.toHaveBeenCalled();
  });
  it('handles an idle sweep', async () => {
    db.rpc.mockResolvedValue({ data: 0, error: null });
    expect(await cleanupKnowledgeReviewOrphans()).toBe(0);
  });
  it('propagates database errors without using a truncated fallback', async () => {
    db.rpc.mockResolvedValue({ data: null, error: new Error('Unavailable') });
    await expect(cleanupKnowledgeReviewOrphans()).rejects.toThrow('Unavailable');
    expect(db.from).not.toHaveBeenCalled();
  });
});
