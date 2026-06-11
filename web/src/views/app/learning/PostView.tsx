'use client';
import type { LmsAssignment, LmsItem, LmsLesson } from '@squadhub/shared';
import BlockRenderer from './blocks/BlockRenderer';
import { useCompleteLesson } from '../../../hooks/useLms';

type ItemWithLessons = LmsItem & { lessons: (LmsLesson & { blocks: any[] })[]; category?: { name: string; color: string } | null };

interface Props {
  item: ItemWithLessons;
  assignment: (LmsAssignment & { completed_lesson_ids: string[] }) | null;
}

export default function PostView({ item, assignment }: Props) {
  const lesson = item.lessons[0];
  const complete = useCompleteLesson();
  const isCompleted = assignment?.status === 'completed';

  async function onMarkComplete() {
    if (!assignment || !lesson || complete.isPending) return;
    await complete.mutateAsync({ assignmentId: assignment.id, lessonId: lesson.id });
  }

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-10">
      {/* Header */}
      <header className="mb-8">
        {item.category && (
          <span className="mb-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--sh-ink-3)]">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.category.color }} />
            {item.category.name}
          </span>
        )}
        <h1 className="serif text-[40px] leading-[1.1] text-[var(--sh-ink)]" style={{ fontFamily: 'var(--font-serif, Plus Jakarta Sans, sans-serif)', letterSpacing: '-0.02em' }}>
          {item.title}
        </h1>
        {item.summary && <p className="mt-3 text-[15px] leading-relaxed text-[var(--sh-ink-2)]">{item.summary}</p>}
        {item.published_at && (
          <p className="mt-3 text-[12px] text-[var(--sh-ink-3)]">
            Published {new Date(item.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        )}
        {item.cover_image_url && (
          <div className="mt-6 overflow-hidden rounded-xl border border-[var(--sh-hair)]">
            <img src={item.cover_image_url} alt="" className="w-full" />
          </div>
        )}
      </header>

      {/* Blocks */}
      <div className="space-y-4">
        {lesson?.blocks?.map((block: any) => (
          <BlockRenderer key={block.id} block={block} assignmentId={assignment?.id ?? null} />
        ))}
        {(!lesson || lesson.blocks.length === 0) && (
          <p className="text-center text-sm text-[var(--sh-ink-3)]">No content yet.</p>
        )}
      </div>

      {/* Complete */}
      {assignment && lesson && (
        <div className="mt-10 border-t border-[var(--sh-hair)] pt-6">
          {isCompleted ? (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white text-xs">✓</span>
              <span className="font-medium">Completed</span>
              {assignment.completed_at && <span className="text-[12px] text-emerald-600">on {new Date(assignment.completed_at).toLocaleDateString()}</span>}
            </div>
          ) : (
            <button
              onClick={onMarkComplete}
              disabled={complete.isPending}
              className="rounded-lg bg-[var(--sh-ink)] px-5 py-2.5 text-sm font-semibold text-[var(--sidebar)] hover:opacity-90 disabled:opacity-60"
            >
              {complete.isPending ? 'Saving…' : 'Mark as complete'}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
