import { beforeEach, describe, expect, it, vi } from 'vitest';
const { post, choice, stopTimer, state } = vi.hoisted(() => ({
  post: vi.fn(), choice: vi.fn(), stopTimer: vi.fn(),
  state: { timers: [] as { taskId: string }[] },
}));
vi.mock('../services/api', () => ({ default: { post } }));
vi.mock('../stores/timerPromptStore', () => ({ askTaskBreakChoice: choice }));
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

  it('offers keep and stop actions for a break', async () => {
    choice.mockResolvedValue('keep');
    await start('break');
    expect(choice).toHaveBeenCalledWith(
      expect.objectContaining({
        keepLabel: 'Keep task and switch to the break timer.',
        stopLabel: 'Stop tasks and switch to the break timer.',
      }),
    );
    expect(post).toHaveBeenCalledWith('/timer/start', { timer_type: 'break', workspace_id: 'workspace', context: 'teammates' });
  });

  it.each(['break', 'no_work'] as const)('keeps task timers and starts %s alongside them on keep', async (type) => {
    choice.mockResolvedValue('keep');
    await start(type);
    expect(stopTimer).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/timer/start', { timer_type: type, workspace_id: 'workspace', context: 'teammates' });
  });

  it.each(['break', 'no_work'] as const)('stops every task before starting %s on stop', async (type) => {
    const events: string[] = [];
    choice.mockResolvedValue('stop');
    stopTimer.mockImplementation(async (id) => { events.push(`stop:${id}`); });
    post.mockImplementation(async () => { events.push('switch'); return { data: {} }; });
    await start(type);
    expect(events).toEqual(['stop:primary', 'stop:secondary', 'switch']);
    expect(post).toHaveBeenCalledWith('/timer/start', { timer_type: type, workspace_id: 'workspace', context: 'teammates' });
  });

  it('keeps task timers and current work mode when dismissed', async () => {
    choice.mockResolvedValue(null);
    await start('break');
    expect(stopTimer).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('starts a break directly when no tasks are running', async () => {
    state.timers = [];
    await start('break');
    expect(choice).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledOnce();
  });

  it('switches to work without stopping task timers', async () => {
    await start('work');
    expect(choice).not.toHaveBeenCalled();
    expect(stopTimer).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledOnce();
  });
});
