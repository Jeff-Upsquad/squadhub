import { describe, expect, it } from 'vitest';
import { flattenLessonTree } from './lessonTree';

describe('knowledge page ordering', () => {
  it('keeps children under their parent when sibling positions overlap', () => {
    const rows = flattenLessonTree([
      { id: 'child', parent_lesson_id: 'root-b', position: 0 },
      { id: 'root-b', position: 1 },
      { id: 'root-a', position: 0 },
      { id: 'grandchild', parent_lesson_id: 'child', position: 0 },
    ]);
    expect(rows.map(({ lesson, depth }) => [lesson.id, depth])).toEqual([
      ['root-a', 0], ['root-b', 0], ['child', 1], ['grandchild', 2],
    ]);
  });

  it('keeps orphaned and cyclic legacy pages reachable exactly once', () => {
    const rows = flattenLessonTree([
      { id: 'orphan', parent_lesson_id: 'missing', position: 0 },
      { id: 'a', parent_lesson_id: 'b', position: 0 },
      { id: 'b', parent_lesson_id: 'a', position: 0 },
    ]);
    expect(rows.map(({ lesson }) => lesson.id)).toEqual(['orphan', 'a', 'b']);
  });
});
