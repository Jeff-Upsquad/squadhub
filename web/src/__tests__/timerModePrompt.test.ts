import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
const { get, post, prompt } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), prompt: vi.fn() }));
vi.mock('../services/api', () => ({ default: { get, post } }));
vi.mock('../stores/timerPromptStore', () => ({ askTimerPrompt: prompt }));
import { offerWorkTimer } from '../services/timerMode';

const scope = { workspaceId: 'workspace', context: 'teammates' };
describe('task timer work-mode prompt', () => {
  let qc: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient();
    post.mockResolvedValue({ data: {} });
  });

  it.each(['break', 'no_work'])('offers to switch from %s and switches only on acceptance', async (timer_type) => {
    get.mockResolvedValue({ data: { data: { session: { timer_type } } } });
    prompt.mockResolvedValue(true);
    await offerWorkTimer(qc, scope);
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Switch to work' }));
    expect(post).toHaveBeenCalledWith('/timer/start', { timer_type: 'work', workspace_id: 'workspace', context: 'teammates' });
  });

  it('keeps the current session when declined', async () => {
    get.mockResolvedValue({ data: { data: { session: { timer_type: 'break' } } } });
    prompt.mockResolvedValue(false);
    await offerWorkTimer(qc, scope);
    expect(post).not.toHaveBeenCalled();
  });

  it.each(['work', undefined])('does not prompt for %s', async (timer_type) => {
    get.mockResolvedValue({ data: { data: { session: timer_type ? { timer_type } : null } } });
    await offerWorkTimer(qc, scope);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('keeps offline task starts available with no known active session', async () => {
    get.mockRejectedValue(new Error('offline'));
    await expect(offerWorkTimer(qc, scope)).resolves.toBeUndefined();
    expect(prompt).not.toHaveBeenCalled();
  });

  it('uses the known break session when offline', async () => {
    qc.setQueryData(['timer-active', 'workspace', 'teammates'], { data: { session: { timer_type: 'break' } } });
    get.mockRejectedValue(new Error('offline'));
    prompt.mockResolvedValue(false);
    await offerWorkTimer(qc, scope);
    expect(prompt).toHaveBeenCalledOnce();
    expect(post).not.toHaveBeenCalled();
  });
});
