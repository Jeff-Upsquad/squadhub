import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc, range, order } = vi.hoisted(() => ({ rpc: vi.fn(), range: vi.fn(), order: vi.fn() }));
vi.mock('../supabase', () => ({ supabaseAdmin: { rpc } }));
import { getHomeTaskCandidates } from '../utils/homeTaskCandidates';
beforeEach(() => { vi.clearAllMocks(); rpc.mockReturnValue({ order }); order.mockReturnValue({ range }); });
describe('Home task candidates', () => {
  it('retains eligible tasks beyond the Data API page limit', async () => {
    const first = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), description: 'preserve full task body' }));
    range.mockResolvedValueOnce({ data: first, error: null }).mockResolvedValueOnce({ data: [{ id: 'older' }], error: null });
    expect(await getHomeTaskCandidates('user', 'new')).toEqual([...first, { id: 'older' }]);
    expect(rpc).toHaveBeenCalledWith('pm_home_task_candidates', { p_user_id: 'user', p_kind: 'new', p_include_done: false, p_include_reviewed: false });
    expect(range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
    expect(order).toHaveBeenCalledWith('id');
  });
  it('keeps Show reviewed and include completed explicit', async () => {
    range.mockResolvedValue({ data: [], error: null });
    await getHomeTaskCandidates('reviewer', 'new', { includeReviewed: true });
    await getHomeTaskCandidates('owner', 'focused', { includeDone: true });
    expect(rpc.mock.calls.map(c => c[1])).toEqual([
      { p_user_id: 'reviewer', p_kind: 'new', p_include_done: false, p_include_reviewed: true },
      { p_user_id: 'owner', p_kind: 'focused', p_include_done: true, p_include_reviewed: false },
    ]);
  });
  it('fails visibly rather than returning a partial list after a page error', async () => {
    range.mockResolvedValueOnce({ data: Array.from({length:1000}, (_,i) => ({id:String(i)})), error:null });
    const error = { message: 'database unavailable' }; range.mockResolvedValueOnce({ data: null, error });
    await expect(getHomeTaskCandidates('user', 'new')).rejects.toEqual(error);
  });
});
