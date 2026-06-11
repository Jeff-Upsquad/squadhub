'use client';
import { useEffect, useState } from 'react';
import type { LmsAssignment, LmsItem, LmsLesson } from '@squadhub/shared';
import BlockRenderer from './blocks/BlockRenderer';
import { useCompleteLesson } from '../../../hooks/useLms';

type ItemWithLessons = LmsItem & { lessons: (LmsLesson & { blocks: any[] })[]; category?: { name: string; color: string } | null };

interface Props {
  item: ItemWithLessons;
  assignment: (LmsAssignment & { completed_lesson_ids: string[] }) | null;
}

export default function CourseView({ item, assignment }: Props) {
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const complete = useCompleteLesson();

  const completedSet = new Set(assignment?.completed_lesson_ids || []);

  useEffect(() => {
    if (!activeLessonId && item.lessons.length) {
      // Auto-pick first incomplete lesson, else first
      const firstIncomplete = item.lessons.find((l) => !completedSet.has(l.id));
      setActiveLessonId((firstIncomplete || item.lessons[0]).id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.lessons.length]);

  const activeLesson = item.lessons.find((l) => l.id === activeLessonId) || item.lessons[0];
  const activeIndex = item.lessons.findIndex((l) => l.id === activeLesson?.id);
  const isActiveCompleted = activeLesson ? completedSet.has(activeLesson.id) : false;

  async function onMarkLessonComplete() {
    if (!assignment || !activeLesson || complete.isPending) return;
    await complete.mutateAsync({ assignmentId: assignment.id, lessonId: activeLesson.id });
    // Advance to next incomplete lesson
    const next = item.lessons.find((l, i) => i > activeIndex && !completedSet.has(l.id));
    if (next) setActiveLessonId(next.id);
  }

  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[280px_1fr]">
      {/* Lesson list */}
      <aside className="border-b border-[var(--sh-hair)] bg-[var(--surface)] md:border-b-0 md:border-r">
        <div className="border-b border-[var(--sh-hair)] p-4">
          <div className="flex items-center gap-2">
            {item.category && (
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.category.color }} />
            )}
            <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--sh-ink-3)]">Course</p>
          </div>
          <h2 className="mt-1 font-[family-name:var(--font-display)] text-[17px] font-bold leading-tight text-[var(--sh-ink)]">{item.title}</h2>
          {item.summary && <p className="mt-1 text-[12px] leading-snug text-[var(--sh-ink-3)]">{item.summary}</p>}
        </div>
        <ul className="p-2">
          {item.lessons.map((lesson, i) => {
            const done = completedSet.has(lesson.id);
            const active = activeLesson?.id === lesson.id;
            return (
              <li key={lesson.id}>
                <button
                  onClick={() => setActiveLessonId(lesson.id)}
                  className={`flex w-full items-start gap-2 rounded-md px-3 py-2 text-left transition ${
                    active ? 'bg-[var(--sh-hair-3)] text-[var(--sh-ink)]' : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)]'
                  }`}
                >
                  <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${
                    done ? 'bg-emerald-500 text-white' : active ? 'bg-[var(--sh-ink)] text-[var(--sidebar)]' : 'bg-[var(--sh-hair)] text-[var(--sh-ink-3)]'
                  }`}>
                    {done ? '✓' : i + 1}
                  </span>
                  <span className="flex-1 text-[13px] leading-snug">
                    {lesson.title}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Lesson content */}
      <main className="overflow-y-auto">
        {activeLesson ? (
          <article className="mx-auto w-full max-w-3xl px-6 py-8">
            <header className="mb-6">
              <p className="text-[12px] font-medium uppercase tracking-wider text-[var(--sh-ink-3)]">Lesson {activeIndex + 1} of {item.lessons.length}</p>
              <h1 className="mt-1 serif text-[32px] leading-tight text-[var(--sh-ink)]" style={{ fontFamily: 'var(--font-serif, Plus Jakarta Sans, sans-serif)', letterSpacing: '-0.01em' }}>
                {activeLesson.title}
              </h1>
              {activeLesson.summary && <p className="mt-2 text-[14px] text-[var(--sh-ink-2)]">{activeLesson.summary}</p>}
            </header>

            <div className="space-y-4">
              {activeLesson.blocks?.map((block: any) => (
                <BlockRenderer key={block.id} block={block} assignmentId={assignment?.id ?? null} />
              ))}
              {(!activeLesson.blocks || activeLesson.blocks.length === 0) && (
                <p className="text-center text-sm text-[var(--sh-ink-3)]">This lesson has no content yet.</p>
              )}
            </div>

            {/* Footer nav */}
            {assignment && (
              <div className="mt-10 flex items-center justify-between gap-3 border-t border-[var(--sh-hair)] pt-6">
                <button
                  onClick={() => {
                    const prev = item.lessons[activeIndex - 1];
                    if (prev) setActiveLessonId(prev.id);
                  }}
                  disabled={activeIndex === 0}
                  className="rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] disabled:opacity-30"
                >
                  ← Previous
                </button>
                {isActiveCompleted ? (
                  <div className="flex items-center gap-2 text-sm text-emerald-700">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-[10px] text-white">✓</span>
                    Lesson completed
                  </div>
                ) : (
                  <button
                    onClick={onMarkLessonComplete}
                    disabled={complete.isPending}
                    className="rounded-md bg-[var(--sh-ink)] px-5 py-2 text-sm font-semibold text-[var(--sidebar)] hover:opacity-90 disabled:opacity-60"
                  >
                    {complete.isPending ? 'Saving…' : 'Mark lesson complete'}
                  </button>
                )}
                <button
                  onClick={() => {
                    const next = item.lessons[activeIndex + 1];
                    if (next) setActiveLessonId(next.id);
                  }}
                  disabled={activeIndex >= item.lessons.length - 1}
                  className="rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] disabled:opacity-30"
                >
                  Next →
                </button>
              </div>
            )}
          </article>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--sh-ink-3)]">No lessons in this course.</div>
        )}
      </main>
    </div>
  );
}
