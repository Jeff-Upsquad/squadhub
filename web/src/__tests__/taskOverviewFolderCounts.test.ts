import { describe, expect, it } from 'vitest';
import type { Task } from '@squadhub/shared';
import { isTaskCompleted } from '../lib/taskGrouping';

function makeTask(partial: Record<string, unknown>): Task {
  return {
    id: 't-1',
    title: 'Test task',
    status: 'open' as unknown as Task['status'],
    priority: 'normal',
    is_completed: false,
    completed_at: null,
    work_date: null,
    due_date: null,
    start_date: null,
    created_at: '2026-10-17T00:00:00.000Z',
    updated_at: '2026-10-17T00:00:00.000Z',
    list_id: 'l-1',
    list: { id: 'l-1', name: 'List 1' },
    user_id: 'u-1',
    ...partial,
  } as unknown as Task;
}

describe('TaskOverview folder open counts', () => {
  it('excludes closed and completed tasks from folder counts and all folders count', () => {
    const folders = [
      { id: 'f-dev', name: 'Dev Tasks' },
      { id: 'f-squadhub', name: 'SquadHub' },
    ];
    const lists = [
      { id: 'l-1', name: 'Dev List 1', folderId: 'f-dev' },
      { id: 'l-2', name: 'SquadHub List 1', folderId: 'f-squadhub' },
      { id: 'l-direct', name: 'Direct List', folderId: null },
    ];

    const tasks: Task[] = [
      // Dev folder: 2 open, 3 closed
      makeTask({ id: '1', list: { id: 'l-1', name: 'Dev List 1' }, status: 'open' }),
      makeTask({ id: '2', list: { id: 'l-1', name: 'Dev List 1' }, status: { id: 's-in-progress', category: 'progress' } }),
      makeTask({ id: '3', list: { id: 'l-1', name: 'Dev List 1' }, status: 'closed' }),
      makeTask({ id: '4', list: { id: 'l-1', name: 'Dev List 1' }, status: 'done' }),
      makeTask({ id: '5', list: { id: 'l-1', name: 'Dev List 1' }, status: { id: 's-done', category: 'done' } }),

      // SquadHub folder: 1 open, 1 closed
      makeTask({ id: '6', list: { id: 'l-2', name: 'SquadHub List 1' }, status: 'open' }),
      makeTask({ id: '7', list: { id: 'l-2', name: 'SquadHub List 1' }, status: { id: 's-closed', category: 'closed' } }),

      // No folder: 1 open, 2 closed
      makeTask({ id: '8', list: { id: 'l-direct', name: 'Direct List' }, status: 'open' }),
      makeTask({ id: '9', list: { id: 'l-direct', name: 'Direct List' }, status: 'closed' }),
      makeTask({ id: '10', list: { id: 'l-direct', name: 'Direct List' }, status: 'cancelled' }),

      // Subtask (should be excluded from top tasks)
      makeTask({ id: '11', parent_task_id: '1', list: { id: 'l-1', name: 'Dev List 1' }, status: 'open' }),
    ];

    const top = tasks.filter((t) => !t.parent_task_id);
    const topOpen = top.filter((t) => !isTaskCompleted(t));

    // Verify subtask excluded from top
    expect(top.length).toBe(10);

    // Verify closed tasks excluded from topOpen (4 open out of 10)
    expect(topOpen.length).toBe(4);

    // Folder chips calculation matches TaskOverview logic
    const allFoldersCount = topOpen.length;
    expect(allFoldersCount).toBe(4);

    const folderCounts = folders.map((f) => {
      const ids = new Set(lists.filter((l) => l.folderId === f.id).map((l) => l.id));
      return {
        id: f.id,
        name: f.name,
        count: topOpen.filter((t) => !!t.list?.id && ids.has(t.list.id)).length,
      };
    });

    expect(folderCounts).toEqual([
      { id: 'f-dev', name: 'Dev Tasks', count: 2 },
      { id: 'f-squadhub', name: 'SquadHub', count: 1 },
    ]);

    const noFolderIds = new Set(lists.filter((l) => !l.folderId).map((l) => l.id));
    const noFolderCount = topOpen.filter((t) => !!t.list?.id && noFolderIds.has(t.list.id)).length;
    expect(noFolderCount).toBe(1);

    // Sum of all folders and direct lists equals allFoldersCount
    expect(folderCounts[0].count + folderCounts[1].count + noFolderCount).toBe(allFoldersCount);
  });
});
