import { beforeEach, describe, expect, it, vi } from 'vitest';
const { post, prompt, stopTimer, state } = vi.hoisted(() => ({
  post: vi.fn(), prompt: vi.fn(), stopTimer: vi.fn(),
  state: { timers: [] as { taskId: string }[] },
}));
vi.mock('../services/api', () => ({ default: { post } }));
vi.mock('../stores/timerPromptStore', () => ({ askTimerPrompt: prompt }));
vi.mock('../stores/pmStore', () => ({ usePMStore: { getState: () => state } }));
vi.mock('../hooks/useParallelTimers', () => ({ useParallelTimers: () => ({ stopTimer }) }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: (options: unknown) => options,
}));
import { useStartTimer } from '../hooks/useTimer';
import type { TimerType } from '@squadhub/shared';

function start(type: TimerType) {
  const mutation = useStartTimer({ workspaceId: 'workspace', context: 'teammates' }) as unknown as {
    mutationFn: (type: TimerType) => Promise<unknown>;
  };
  return mutation.mutationFn(type);
}

describe('switching to break or no work with task timers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.timers = [{ taskId: 'primary' }, { taskId: 'secondary' }];
    post.mockResolvedValue({ data: { success: true } });
    stopTimer.mockResolvedValue(undefined);
  });

  it.each(['break', 'no_work'] as const)('stops every task and saves time before starting %s', async (type) => {
    const events: string[] = [];
    prompt.mockResolvedValue(true);
    stopTimer.mockImplementation(async (id) => { events.push(`stop:${id}`); });
    post.mockImplementation(async () => { events.push('switch'); return { data: {} }; });
    await start(type);
    expect(events).toEqual(['stop:primary', 'stop:secondary', 'switch']);
    expect(post).toHaveBeenCalledWith('/timer/start', { timer_type: type, workspace_id: 'workspace', context: 'teammates' });
  });

  it('keeps task timers and current work mode when declined', async () => {
    prompt.mockResolvedValue(false);
    await start('break');
    expect(stopTimer).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('starts a break directly when no tasks are running', async () => {
    state.timers = [];
    await start('break');
    expect(prompt).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledOnce();
  });

  it('switches to work without stopping task timers', async () => {
    await start('work');
    expect(prompt).not.toHaveBeenCalled();
    expect(stopTimer).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledOnce();
  });
});
