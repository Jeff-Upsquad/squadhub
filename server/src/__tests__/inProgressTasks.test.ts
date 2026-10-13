import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from, range } = vi.hoisted(() => ({ from: vi.fn(), range: vi.fn() }));
vi.mock('../supabase', () => ({ supabaseAdmin: { from } }));
import { getUserWorkedTaskIds } from '../utils/inProgressTasks';

describe('persistent worked task history', () => {
  const eq = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    const query = { eq, order: vi.fn(), range };
    eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    from.mockReturnValue({ select: vi.fn().mockReturnValue(query) });
  });

  it('retains older work beyond the first page and deduplicates sessions', async () => {
    range.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, () => ({ task_id: 'recent' })), error: null });
    range.mockResolvedValueOnce({ data: [{ task_id: 'older' }, { task_id: 'recent' }], error: null });
    expect(await getUserWorkedTaskIds('jeff')).toEqual(['recent', 'older']);
    expect(eq).toHaveBeenCalledWith('user_id', 'jeff');
    expect(range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it('returns no history for a user who has not worked on tasks', async () => {
    range.mockResolvedValueOnce({ data: [], error: null });
    expect(await getUserWorkedTaskIds('new-user')).toEqual([]);
  });

  it('reports query failures instead of silently losing carried tasks', async () => {
    const error = { message: 'database unavailable' };
    range.mockResolvedValueOnce({ data: null, error });
    await expect(getUserWorkedTaskIds('jeff')).rejects.toEqual(error);
  });
});
