/** Parent-first order for pages whose positions are local to each parent. */
export function flattenLessonTree<T extends { id: string; parent_lesson_id?: string | null; position: number }>(lessons: T[]): { lesson: T; depth: number }[] {
  const sorted = [...lessons].sort((a, b) => a.position - b.position);
  const ids = new Set(lessons.map((lesson) => lesson.id));
  const children = new Map<string | null, T[]>();
  for (const lesson of sorted) {
    const parent = lesson.parent_lesson_id && ids.has(lesson.parent_lesson_id) ? lesson.parent_lesson_id : null;
    children.set(parent, [...(children.get(parent) || []), lesson]);
  }
  const result: { lesson: T; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (lesson: T, depth: number) => {
    if (seen.has(lesson.id)) return;
    seen.add(lesson.id);
    result.push({ lesson, depth });
    for (const child of children.get(lesson.id) || []) visit(child, depth + 1);
  };
  for (const root of children.get(null) || []) visit(root, 0);
  // Keep malformed legacy trees visible and editable too.
  for (const lesson of sorted) visit(lesson, 0);
  return result;
}
