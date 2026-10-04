import { beforeEach, describe, expect, it, vi } from 'vitest';
const { post, prompt, state } = vi.hoisted(() => ({
  post: vi.fn(), prompt: vi.fn(),
  state: { timers: [] as { taskId: string }[] },
}));
vi.mock('../services/api', () => ({ default: { post } }));
vi.mock('../stores/timerPromptStore', () => ({ askTimerPrompt: prompt }));
vi.mock('../stores/pmStore', () => ({ usePMStore: { getState: () => state } }));
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
  });

  it('keeps tasks running while starting a break when accepted', async () => {
    prompt.mockResolvedValue(true);
    await start('break');
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({ confirmLabel: 'Keep task and switch to the break timer.' }),
    );
    expect(post).toHaveBeenCalledWith('/timer/start', { timer_type: 'break', workspace_id: 'workspace', context: 'teammates' });
  });

  it.each(['break', 'no_work'] as const)('keeps task timers and starts %s alongside them when accepted', async (type) => {
    prompt.mockResolvedValue(true);
    await start(type);
    expect(post).toHaveBeenCalledWith('/timer/start', { timer_type: type, workspace_id: 'workspace', context: 'teammates' });
  });

  it('keeps task timers and current work mode when declined', async () => {
    prompt.mockResolvedValue(false);
    await start('break');
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
    expect(post).toHaveBeenCalledOnce();
  });
});
