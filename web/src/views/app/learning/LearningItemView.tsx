'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LmsAccessLevel, LmsAssignment, LmsItem, LmsLesson } from '@squadhub/shared';
import { useLmsItem, useStartAssignment, useCompleteLesson } from '../../../hooks/useLms';
import { useStartEditDraft } from '../../../hooks/useLmsCollab';
import BlockRenderer from './blocks/BlockRenderer';
import LmsEditor from './LmsEditor';
import LmsCommentsPanel from './LmsCommentsPanel';

const RANK: Record<LmsAccessLevel, number> = { viewer: 1, commenter: 2, contributor: 3, admin: 4 };
const can = (a: LmsAccessLevel | undefined, min: LmsAccessLevel) => !!a && RANK[a] >= RANK[min];

// Three-pane reader for a Resources item (help-center style):
//   • left  — the catalog (lives in LearningSidebar / LearningShell)
//   • middle — this view's main content (the lesson / article body)
//   • right  — the "sections" rail: a course's lessons, or an article's
//              on-this-page heading outline.

type Lesson = LmsLesson & { blocks?: any[] };
type ItemFull = LmsItem & { lessons: Lesson[]; category?: { name: string; color: string } | null };
type AssignmentFull = (LmsAssignment & { completed_lesson_ids: string[] }) | null;

export default function LearningItemView({ itemId, onBack }: { itemId: string; onBack: () => void }) {
  const { data, isLoading, refetch } = useLmsItem(itemId);
  const start = useStartAssignment();
  const startEdit = useStartEditDraft();
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ draftItemId: string; isClone: boolean } | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [submittedNote, setSubmittedNote] = useState(false);
  const contentRef = useRef<HTMLElement>(null);

  // Mark in_progress on first open (if still not_started)
  useEffect(() => {
    if (data?.assignment && data.assignment.status === 'not_started') {
      start.mutate(data.assignment.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.assignment?.id]);

  const item = data?.item as ItemFull | undefined;
  const assignment = (data?.assignment as AssignmentFull) ?? null;
  const isCourse = item?.kind === 'course';
  const lessons = useMemo(() => item?.lessons || [], [item]);
  const completedSet = useMemo(() => new Set(assignment?.completed_lesson_ids || []), [assignment]);

  // Course: pick the first incomplete lesson (else the first) on load.
  useEffect(() => {
    if (isCourse && !activeLessonId && lessons.length) {
      const firstIncomplete = lessons.find((l) => !completedSet.has(l.id));
      setActiveLessonId((firstIncomplete || lessons[0]).id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCourse, lessons.length]);

  // Reset the scroll position when switching lessons.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [activeLessonId]);

  const access = item?.my_access;

  async function onEdit() {
    if (!item) return;
    const res = await startEdit.mutateAsync(item.id);
    setEditing({ draftItemId: res.draft_item_id, isClone: res.is_clone });
  }

  if (isLoading || !item) {
    return <div className="flex h-full items-center justify-center text-sm text-[var(--sh-ink-3)]">Loading…</div>;
  }

  // Full-screen editing mode (admins edit live; contributors edit a draft clone).
  if (editing) {
    return (
      <LmsEditor
        draftItemId={editing.draftItemId}
        isClone={editing.isClone}
        onExit={() => { setEditing(null); refetch(); }}
        onSubmitted={() => { setEditing(null); setSubmittedNote(true); refetch(); }}
      />
    );
  }

  const isSop = item.track === 'sop';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top bar — back returns to the overview (desktop) or the list (mobile) */}
      <div className="flex items-center gap-2 border-b border-[var(--sh-hair)] px-4 py-2.5">
        <button
          onClick={onBack}
          title="Back to Resources"
          aria-label="Back to Resources"
          className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[6px] text-[var(--sh-ink-3)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="truncate text-[12.5px] font-medium text-[var(--sh-ink)]">{item.title}</span>
        <span className="ml-auto flex items-center gap-2">
          {assignment && !isSop && (
            <>
              <span className="text-[11px] text-[var(--sh-ink-3)]">{assignment.progress_percent}%</span>
              <div className="h-1 w-24 overflow-hidden rounded-full bg-[var(--sh-hair)]">
                <div className={`h-full ${assignment.status === 'completed' ? 'bg-emerald-500' : 'bg-[var(--sh-ink)]'}`} style={{ width: `${assignment.progress_percent}%` }} />
              </div>
            </>
          )}
          {can(access, 'commenter') && (
            <button
              onClick={() => setShowComments(true)}
              className="rounded-[6px] border border-[var(--sh-hair)] bg-[var(--surface)] px-2.5 py-1 text-[12px] text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)]"
            >
              Comments
            </button>
          )}
          {can(access, 'contributor') && (
            <button
              onClick={onEdit}
              disabled={startEdit.isPending}
              className="rounded-[6px] bg-[var(--sh-ink)] px-3 py-1 text-[12px] font-semibold text-[var(--sidebar)] hover:opacity-90 disabled:opacity-60"
            >
              {startEdit.isPending ? 'Opening…' : access === 'admin' ? 'Edit' : 'Suggest edit'}
            </button>
          )}
        </span>
      </div>

      {submittedNote && (
        <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-[12.5px] text-emerald-900">
          <span>✓ Submitted for review. An admin will approve it before it goes live.</span>
          <button onClick={() => setSubmittedNote(false)} className="ml-auto text-emerald-700 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Middle content + right sections rail */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_248px]">
        <main ref={contentRef} className="min-h-0 overflow-y-auto">
          {isCourse ? (
            <CourseBody
              item={item}
              assignment={assignment}
              lessons={lessons}
              completedSet={completedSet}
              activeLessonId={activeLessonId}
              setActiveLessonId={setActiveLessonId}
            />
          ) : (
            <PostBody item={item} assignment={assignment} />
          )}
        </main>

        <aside className="hidden min-h-0 overflow-y-auto border-l border-[var(--sh-hair)] bg-[var(--sidebar)] lg:block">
          {isCourse ? (
            <LessonRail
              lessons={lessons}
              completedSet={completedSet}
              activeLessonId={activeLessonId}
              onPick={setActiveLessonId}
            />
          ) : (
            <OnThisPage containerRef={contentRef} scanKey={item.id} />
          )}
        </aside>
      </div>

      {/* Comments slide-over (commenter+ only) */}
      {showComments && can(access, 'commenter') && (
        <div className="fixed inset-0 z-40 flex justify-end" onClick={() => setShowComments(false)}>
          <div className="absolute inset-0 bg-black/20" />
          <div className="relative z-10 h-full w-[340px] max-w-[85vw] border-l border-[var(--sh-hair)] bg-[var(--surface)] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <LmsCommentsPanel itemId={item.id} access={access!} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Middle — course (one lesson at a time)                              */
/* ------------------------------------------------------------------ */

function CourseBody({
  item,
  assignment,
  lessons,
  completedSet,
  activeLessonId,
  setActiveLessonId,
}: {
  item: ItemFull;
  assignment: AssignmentFull;
  lessons: Lesson[];
  completedSet: Set<string>;
  activeLessonId: string | null;
  setActiveLessonId: (id: string) => void;
}) {
  const complete = useCompleteLesson();
  const activeLesson = lessons.find((l) => l.id === activeLessonId) || lessons[0];
  const activeIndex = lessons.findIndex((l) => l.id === activeLesson?.id);
  const isActiveCompleted = activeLesson ? completedSet.has(activeLesson.id) : false;

  async function onMarkLessonComplete() {
    if (!assignment || !activeLesson || complete.isPending) return;
    await complete.mutateAsync({ assignmentId: assignment.id, lessonId: activeLesson.id });
    const next = lessons.find((l, i) => i > activeIndex && !completedSet.has(l.id));
    if (next) setActiveLessonId(next.id);
  }

  if (!activeLesson) {
    return <div className="flex h-full items-center justify-center text-sm text-[var(--sh-ink-3)]">No lessons in this course.</div>;
  }

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-8">
      <header className="mb-6">
        <p className="text-[12px] font-medium uppercase tracking-wider text-[var(--sh-ink-3)]">
          Lesson {activeIndex + 1} of {lessons.length}
        </p>
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

      {assignment && (
        <div className="mt-10 flex items-center justify-between gap-3 border-t border-[var(--sh-hair)] pt-6">
          <button
            onClick={() => {
              const prev = lessons[activeIndex - 1];
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
              const next = lessons[activeIndex + 1];
              if (next) setActiveLessonId(next.id);
            }}
            disabled={activeIndex >= lessons.length - 1}
            className="rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Middle — post / SOP (single article)                                */
/* ------------------------------------------------------------------ */

function PostBody({ item, assignment }: { item: ItemFull; assignment: AssignmentFull }) {
  const lesson = item.lessons[0];
  const complete = useCompleteLesson();
  const isSop = item.track === 'sop';
  const isCompleted = assignment?.status === 'completed';

  async function onMarkComplete() {
    if (!assignment || !lesson || complete.isPending) return;
    await complete.mutateAsync({ assignmentId: assignment.id, lessonId: lesson.id });
  }

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-10">
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

      <div className="space-y-4">
        {lesson?.blocks?.map((block: any) => (
          <BlockRenderer key={block.id} block={block} assignmentId={assignment?.id ?? null} />
        ))}
        {(!lesson || (lesson.blocks?.length ?? 0) === 0) && (
          <p className="text-center text-sm text-[var(--sh-ink-3)]">No content yet.</p>
        )}
      </div>

      {/* SOPs are reference docs — no completion chrome. */}
      {assignment && lesson && !isSop && (
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

/* ------------------------------------------------------------------ */
/* Right rail — course lessons                                         */
/* ------------------------------------------------------------------ */

function LessonRail({
  lessons,
  completedSet,
  activeLessonId,
  onPick,
}: {
  lessons: Lesson[];
  completedSet: Set<string>;
  activeLessonId: string | null;
  onPick: (id: string) => void;
}) {
  const doneCount = lessons.filter((l) => completedSet.has(l.id)).length;
  const pct = lessons.length ? Math.round((doneCount / lessons.length) * 100) : 0;
  return (
    <div className="px-3 py-4">
      <div className="flex items-center justify-between px-1.5 pb-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--sh-ink-3)]">Lessons</span>
        <span className="text-[10.5px] tabular-nums text-[var(--sh-ink-3)]">{doneCount}/{lessons.length}</span>
      </div>
      <div className="mx-1.5 mb-2 h-1 overflow-hidden rounded-full bg-[var(--sh-hair)]">
        <div className="h-full rounded-full bg-[var(--sh-ink)]" style={{ width: `${pct}%` }} />
      </div>
      <ul>
        {lessons.map((lesson, i) => {
          const done = completedSet.has(lesson.id);
          const active = activeLessonId === lesson.id;
          return (
            <li key={lesson.id}>
              <button
                onClick={() => onPick(lesson.id)}
                className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition ${
                  active ? 'bg-[var(--sh-hair-3)] text-[var(--sh-ink)]' : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)]'
                }`}
              >
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${
                  done ? 'bg-emerald-500 text-white' : active ? 'bg-[var(--sh-ink)] text-[var(--sidebar)]' : 'bg-[var(--sh-hair)] text-[var(--sh-ink-3)]'
                }`}>
                  {done ? '✓' : i + 1}
                </span>
                <span className="flex-1 text-[12.5px] leading-snug">{lesson.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Right rail — on-this-page heading outline (posts / SOPs)            */
/* ------------------------------------------------------------------ */

interface Heading {
  id: string;
  text: string;
  level: number;
}

function slugifyHeading(text: string, i: number) {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48);
  return `sec-${i}-${base || 'section'}`;
}

// Scans the rendered content for headings and keeps them in sync (Tiptap
// renders asynchronously, so we re-scan on DOM mutations), then tracks which
// one is currently in view for scroll-spy highlighting.
function OnThisPage({ containerRef, scanKey }: { containerRef: React.RefObject<HTMLElement | null>; scanKey: string }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    let raf = 0;
    const scan = () => {
      const nodes = Array.from(root.querySelectorAll('h1, h2, h3')) as HTMLElement[];
      const next: Heading[] = nodes
        .map((n, i) => {
          const text = (n.textContent || '').trim();
          if (!n.id) n.id = slugifyHeading(text, i);
          return { id: n.id, text, level: Number(n.tagName[1]) };
        })
        .filter((h) => h.text);
      setHeadings((prev) =>
        prev.length === next.length && prev.every((p, i) => p.id === next[i].id && p.text === next[i].text) ? prev : next
      );
    };
    scan();
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(scan);
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [containerRef, scanKey]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || headings.length === 0) return;
    const onScroll = () => {
      const rootTop = root.getBoundingClientRect().top;
      let current = headings[0].id;
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - rootTop <= 88) current = h.id;
        else break;
      }
      setActiveId(current);
    };
    onScroll();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [containerRef, headings]);

  function jumpTo(id: string) {
    const root = containerRef.current;
    const el = document.getElementById(id);
    if (!root || !el) return;
    const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 16;
    root.scrollTo({ top, behavior: 'smooth' });
    setActiveId(id);
  }

  return (
    <div className="px-3 py-4">
      <div className="px-1.5 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--sh-ink-3)]">On this page</div>
      {headings.length === 0 ? (
        <p className="px-1.5 py-2 text-[11.5px] leading-snug text-[var(--sh-ink-3)]">No sections on this page.</p>
      ) : (
        <ul className="border-l border-[var(--sh-hair)]">
          {headings.map((h) => {
            const active = activeId === h.id;
            return (
              <li key={h.id}>
                <button
                  onClick={() => jumpTo(h.id)}
                  style={{ paddingLeft: `${(h.level - 1) * 12 + 12}px` }}
                  className={`-ml-px block w-full border-l py-1.5 pr-2 text-left text-[12px] leading-snug transition ${
                    active
                      ? 'border-[var(--sh-ink)] font-medium text-[var(--sh-ink)]'
                      : 'border-transparent text-[var(--sh-ink-3)] hover:text-[var(--sh-ink)]'
                  }`}
                >
                  {h.text}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
