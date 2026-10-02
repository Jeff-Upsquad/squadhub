import { describe, expect, it } from 'vitest';
import { queueGoalTaskWrite } from '../src/views/app/goals/goalMutationQueue';

describe('rapid goal task edits', () => {
  it('keeps the latest drag last even when the earlier network request is slow', async () => {
    const scope = {};
    const saves: number[] = [];
    let release!: () => void;
    const slow = new Promise<void>((resolve) => { release = resolve; });
    const first = queueGoalTaskWrite(scope, 'a', async () => { await slow; saves.push(1); });
    const second = queueGoalTaskWrite(scope, 'a', async () => { saves.push(2); });
    await queueGoalTaskWrite(scope, 'b', async () => { saves.push(3); });
    expect(saves).toEqual([3]);
    release();
    await Promise.all([first, second]);
    expect(saves).toEqual([3, 1, 2]);
  });

  it('allows the next correction to save after an earlier edit fails', async () => {
    const scope = {};
    const failed = queueGoalTaskWrite(scope, 'a', async () => { throw new Error('Offline'); });
    const correction = queueGoalTaskWrite(scope, 'a', async () => 'saved');
    await expect(failed).rejects.toThrow('Offline');
    await expect(correction).resolves.toBe('saved');
  });
});
