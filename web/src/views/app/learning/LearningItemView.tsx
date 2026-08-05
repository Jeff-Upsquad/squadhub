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

// Full-screen reader for a Resources item (Notion / help-center style):
//   • left   — item-specific nav: a course's chapters, or an SOP's nested page
//              tree (with a "search in this SOP" box).
//   • middle — the active lesson / page body.
//   • right  — sub-pages of the open SOP page + an on-this-page outline.

type Lesson = LmsLesson & { blocks?: any[] };
type ItemFull = LmsItem & { lessons: Lesson[]; category?: { name: string; color: string } | null };
type AssignmentFull = (LmsAssignment & { completed_lesson_ids: string[] }) | null;

// Plain text out of a Tiptap doc (for scoped SOP search + snippets).
function tiptapText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  let out = node.text ? node.text + ' ' : '';
  if (Array.isArray(node.content)) for (const k of node.content) out += tiptapText(k);
  return out;
}
function lessonText(l: Lesson): string {
  return (l.blocks || []).filter((b) => b.type === 'text').map((b) => tiptapText(b.text_content)).join(' ');
}
function snippetAround(text: string, q: string): string {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return '';
  const s = Math.max(0, i - 36);
  return (s > 0 ? '…' : '') + text.slice(s, i + q.length + 66).trim() + '…';
}

export default function LearningItemView({
  itemId,
  initialLessonId,
  onBack,
}: {
  itemId: string;
  initialLessonId?: string | null;
  onBack: () => void;
}) {
  const { data, isLoading, refetch } = useLmsItem(itemId);
  const start = useStartAssignment();
  const startEdit = useStartEditDraft();
  const [activeLessonId, setActiveLessonId] = useState<string | null>(initialLessonId ?? null);
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
  const isSop = item?.track === 'sop';
  const lessons = useMemo(() => item?.lessons || [], [item]);
  const completedSet = useMemo(() => new Set(assignment?.completed_lesson_ids || []), [assignment]);

  // Deep-link target (from a search result) wins once, when it arrives.
  useEffect(() => {
    if (initialLessonId) setActiveLessonId(initialLessonId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLessonId]);

  // Default selection: course → first incomplete; SOP → first top-level page.
  useEffect(() => {
    if (activeLessonId || !lessons.length) return;
    if (isCourse) {
      const firstIncomplete = lessons.find((l) => !completedSet.has(l.id));
      setActiveLessonId((firstIncomplete || lessons[0]).id);
    } else if (isSop) {
      const firstTop = lessons.find((l) => !l.parent_lesson_id) || lessons[0];
      setActiveLessonId(firstTop.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCourse, isSop, lessons.length]);

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

  const activeLesson = lessons.find((l) => l.id === activeLessonId) || null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top bar */}
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
        {item.icon && <span className="text-[15px] leading-none">{item.icon}</span>}
        <span className="truncate text-[12.5px] font-medium text-[var(--sh-ink)]">{item.title}</span>
        <span className="ml-auto flex items-center gap-2">
          {assignment && isCourse && (
            <>
              <span className="text-[11px] text-[var(--sh-ink-3)]">{assignment.progress_percent}%</span>
              <div className="h-1 w-24 overflow-hidden rounded-full bg-[var(--sh-hair)]">
                <div className={`h-full ${assignment.status === 'completed' ? 'bg-emerald-500' : 'bg-[var(--sh-ink)]'}`} style={{ width: `${assignment.progress_percent}%` }} />
              </div>
            </>
          )}
          {can(access, 'commenter') && (
            <button onClick={() => setShowComments(true)} className="rounded-[6px] border border-[var(--sh-hair)] bg-[var(--surface)] px-2.5 py-1 text-[12px] text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)]">
              Comments
            </button>
          )}
          {can(access, 'contributor') && (
            <button onClick={onEdit} disabled={startEdit.isPending} className="rounded-[6px] bg-[var(--sh-ink)] px-3 py-1 text-[12px] font-semibold text-[var(--sidebar)] hover:opacity-90 disabled:opacity-60">
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

      {/* left nav | content | right rail */}
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[264px_1fr]">
        {/* Left — item-specific nav */}
        <aside className="hidden min-h-0 overflow-y-auto border-r border-[var(--sh-hair)] bg-[var(--sidebar)] md:block">
          {isSop ? (
            <SopTreePane lessons={lessons} activeId={activeLessonId} onPick={setActiveLessonId} />
          ) : isCourse ? (
            <LessonRail lessons={lessons} completedSet={completedSet} activeLessonId={activeLessonId} onPick={setActiveLessonId} />
          ) : (
            <div className="px-4 py-4 text-[12px] text-[var(--sh-ink-3)]">Post</div>
          )}
        </aside>

        {/* Middle + right */}
        <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[1fr_248px]">
          <main ref={contentRef} className="min-h-0 overflow-y-auto">
            {isSop ? (
              <SopBody item={item} lessons={lessons} activeLesson={activeLesson} onPick={setActiveLessonId} />
            ) : isCourse ? (
              <CourseBody item={item} assignment={assignment} lessons={lessons} completedSet={completedSet} activeLessonId={activeLessonId} setActiveLessonId={setActiveLessonId} />
            ) : (
              <PostBody item={item} assignment={assignment} />
            )}
          </main>

          <aside className="hidden min-h-0 overflow-y-auto border-l border-[var(--sh-hair)] bg-[var(--sidebar)] lg:block">
            {isSop && activeLesson ? (
              <SopRightRail lessons={lessons} activeLesson={activeLesson} onPick={setActiveLessonId} containerRef={contentRef} scanKey={activeLesson.id} />
            ) : (
              <OnThisPage containerRef={contentRef} scanKey={activeLesson?.id || item.id} />
            )}
          </aside>
        </div>
      </div>

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

/* ================================================================== */
/* SOP — nested page tree (left)                                       */
/* ================================================================== */

interface TreeNode { lesson: Lesson; children: TreeNode[]; }

function buildTree(lessons: Lesson[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const l of lessons) byId.set(l.id, { lesson: l, children: [] });
  const roots: TreeNode[] = [];
  for (const l of lessons) {
    const node = byId.get(l.id)!;
    const parent = l.parent_lesson_id ? byId.get(l.parent_lesson_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.lesson.position - b.lesson.position);
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}
function ancestorsOf(lessons: Lesson[], id: string | null): Set<string> {
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const out = new Set<string>();
  let cur = id ? byId.get(id) : undefined;
  const guard = new Set<string>();
  while (cur?.parent_lesson_id && !guard.has(cur.parent_lesson_id)) {
    guard.add(cur.parent_lesson_id);
    out.add(cur.parent_lesson_id);
    cur = byId.get(cur.parent_lesson_id);
  }
  return out;
}

function SopTreePane({ lessons, activeId, onPick }: { lessons: Lesson[]; activeId: string | null; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildTree(lessons), [lessons]);

  // Keep the active page's ancestors expanded.
  useEffect(() => {
    const anc = ancestorsOf(lessons, activeId);
    if (anc.size) setExpanded((prev) => new Set([...prev, ...anc]));
  }, [lessons, activeId]);

  const query = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (query.length < 1) return null;
    const byId = new Map(lessons.map((l) => [l.id, l]));
    const path = (l: Lesson): string[] => {
      const trail: string[] = [];
      let cur: Lesson | undefined = l;
      const guard = new Set<string>();
      while (cur?.parent_lesson_id && !guard.has(cur.parent_lesson_id)) {
        guard.add(cur.parent_lesson_id);
        const p = byId.get(cur.parent_lesson_id);
        if (!p) break;
        trail.unshift(p.title);
        cur = p;
      }
      return trail;
    };
    const hits: { lesson: Lesson; kind: 'page' | 'text'; snippet?: string; path: string[] }[] = [];
    for (const l of lessons) {
      if (l.title.toLowerCase().includes(query)) hits.push({ lesson: l, kind: 'page', path: path(l) });
      else {
        const body = lessonText(l);
        if (body.toLowerCase().includes(query)) hits.push({ lesson: l, kind: 'text', snippet: snippetAround(body, query), path: path(l) });
      }
    }
    return hits;
  }, [lessons, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <div className="relative">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--sh-ink-3)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search in this SOP…"
            className="w-full rounded-[8px] border border-[var(--sh-hair)] bg-[var(--surface)] py-[7px] pl-8 pr-7 text-[12.5px] text-[var(--sh-ink)] placeholder:text-[var(--sh-ink-3)] focus:border-[var(--sh-ink)] focus:outline-none"
          />
          {q && <button onClick={() => setQ('')} className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)]">×</button>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-6">
        {results ? (
          results.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-[var(--sh-ink-3)]">No matches in this SOP.</p>
          ) : (
            <ul>
              {results.map((r) => (
                <li key={r.lesson.id}>
                  <button onClick={() => { onPick(r.lesson.id); setQ(''); }} className="w-full rounded-md px-2.5 py-2 text-left hover:bg-[var(--sh-hair-3)]">
                    <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--sh-ink)]">
                      <span>{r.lesson.icon || (r.kind === 'text' ? '¶' : '📄')}</span>
                      <span className="truncate">{r.lesson.title}</span>
                    </span>
                    {r.path.length > 0 && <span className="mt-0.5 block truncate text-[10.5px] text-[var(--sh-ink-3)]">{r.path.join(' › ')}</span>}
                    {r.snippet && <span className="mt-0.5 block text-[11px] leading-snug text-[var(--sh-ink-3)]">{r.snippet}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <TreeList nodes={tree} depth={0} activeId={activeId} expanded={expanded} onToggle={(id) => setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; })} onPick={onPick} />
        )}
      </div>
    </div>
  );
}

function TreeList({ nodes, depth, activeId, expanded, onToggle, onPick }: {
  nodes: TreeNode[]; depth: number; activeId: string | null; expanded: Set<string>;
  onToggle: (id: string) => void; onPick: (id: string) => void;
}) {
  return (
    <ul>
      {nodes.map((n) => {
        const hasChildren = n.children.length > 0;
        const open = expanded.has(n.lesson.id);
        const active = activeId === n.lesson.id;
        return (
          <li key={n.lesson.id}>
            <div
              className={`group flex items-center gap-1 rounded-md pr-1.5 ${active ? 'bg-[var(--sh-hair-3)]' : 'hover:bg-[var(--sh-hair-3)]'}`}
              style={{ paddingLeft: `${depth * 14 + 4}px` }}
            >
              <button
                onClick={() => hasChildren && onToggle(n.lesson.id)}
                className={`grid h-5 w-5 shrink-0 place-items-center text-[var(--sh-ink-3)] ${hasChildren ? '' : 'invisible'}`}
                aria-label="Toggle"
              >
                <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
              </button>
              <button onClick={() => onPick(n.lesson.id)} className="flex min-w-0 flex-1 items-center gap-1.5 py-[6px] text-left">
                <span className="text-[13px] leading-none">{n.lesson.icon || '📄'}</span>
                <span className={`truncate text-[12.5px] leading-snug ${active ? 'font-medium text-[var(--sh-ink)]' : 'text-[var(--sh-ink-2)]'}`}>{n.lesson.title}</span>
              </button>
            </div>
            {hasChildren && open && (
              <TreeList nodes={n.children} depth={depth + 1} activeId={activeId} expanded={expanded} onToggle={onToggle} onPick={onPick} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* SOP — page body (middle) */
function SopBody({ item, lessons, activeLesson, onPick }: {
  item: ItemFull; lessons: Lesson[]; activeLesson: Lesson | null; onPick: (id: string) => void;
}) {
  if (!activeLesson) {
    return <div className="flex h-full items-center justify-center text-sm text-[var(--sh-ink-3)]">This SOP has no pages yet.</div>;
  }
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const crumbs: Lesson[] = [];
  let cur: Lesson | undefined = activeLesson;
  const guard = new Set<string>();
  while (cur?.parent_lesson_id && !guard.has(cur.parent_lesson_id)) {
    guard.add(cur.parent_lesson_id);
    const p = byId.get(cur.parent_lesson_id);
    if (!p) break;
    crumbs.unshift(p);
    cur = p;
  }
  const children = lessons.filter((l) => l.parent_lesson_id === activeLesson.id).sort((a, b) => a.position - b.position);

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-8">
      {(crumbs.length > 0) && (
        <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--sh-ink-3)]">
          {crumbs.map((c) => (
            <span key={c.id} className="flex items-center gap-1.5">
              <button onClick={() => onPick(c.id)} className="hover:text-[var(--sh-ink)]">{c.title}</button>
              <span>›</span>
            </span>
          ))}
          <span className="text-[var(--sh-ink-2)]">{activeLesson.title}</span>
        </nav>
      )}
      <header className="mb-6">
        {activeLesson.icon && <div className="mb-1 text-[40px] leading-none">{activeLesson.icon}</div>}
        <h1 className="serif text-[32px] leading-tight text-[var(--sh-ink)]" style={{ fontFamily: 'var(--font-serif, Plus Jakarta Sans, sans-serif)', letterSpacing: '-0.01em' }}>
          {activeLesson.title}
        </h1>
        {activeLesson.summary && <p className="mt-2 text-[14px] text-[var(--sh-ink-2)]">{activeLesson.summary}</p>}
      </header>

      <div className="space-y-4">
        {activeLesson.blocks?.map((block: any) => (
          <BlockRenderer key={block.id} block={block} assignmentId={null} />
        ))}
        {(!activeLesson.blocks || activeLesson.blocks.length === 0) && (
          <p className="text-[13px] text-[var(--sh-ink-3)]">This page has no content yet.</p>
        )}
      </div>

      {children.length > 0 && (
        <div className="mt-8 border-t border-[var(--sh-hair)] pt-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--sh-ink-3)]">Sub-pages</p>
          <div className="space-y-1.5">
            {children.map((c) => {
              const grand = lessons.filter((l) => l.parent_lesson_id === c.id).length;
              return (
                <button key={c.id} onClick={() => onPick(c.id)} className="flex w-full items-center gap-2.5 rounded-[10px] border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2.5 text-left hover:border-[var(--sh-ink-3)]">
                  <span className="text-[17px] leading-none">{c.icon || '📄'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-[var(--sh-ink)]">{c.title}</span>
                    <span className="block text-[11px] text-[var(--sh-ink-3)]">{grand ? `${grand} sub-page${grand > 1 ? 's' : ''}` : 'Page'}</span>
                  </span>
                  <span className="text-[var(--sh-ink-3)]">›</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}

/* SOP — right rail: sub-pages + on-this-page */
function SopRightRail({ lessons, activeLesson, onPick, containerRef, scanKey }: {
  lessons: Lesson[]; activeLesson: Lesson; onPick: (id: string) => void;
  containerRef: React.RefObject<HTMLElement | null>; scanKey: string;
}) {
  const children = lessons.filter((l) => l.parent_lesson_id === activeLesson.id).sort((a, b) => a.position - b.position);
  return (
    <div className="px-3 py-4">
      {children.length > 0 && (
        <div className="mb-4">
          <div className="px-1.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--sh-ink-3)]">Sub-pages</div>
          <ul>
            {children.map((c) => (
              <li key={c.id}>
                <button onClick={() => onPick(c.id)} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)]">
                  <span>{c.icon || '📄'}</span><span className="truncate">{c.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <OnThisPage containerRef={containerRef} scanKey={scanKey} />
    </div>
  );
}

/* ================================================================== */
/* Course (one lesson at a time)                                       */
/* ================================================================== */

function CourseBody({
  item, assignment, lessons, completedSet, activeLessonId, setActiveLessonId,
}: {
  item: ItemFull; assignment: AssignmentFull; lessons: Lesson[]; completedSet: Set<string>;
  activeLessonId: string | null; setActiveLessonId: (id: string) => void;
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
          <button onClick={() => { const prev = lessons[activeIndex - 1]; if (prev) setActiveLessonId(prev.id); }} disabled={activeIndex === 0}
            className="rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] disabled:opacity-30">← Previous</button>
          {isActiveCompleted ? (
            <div className="flex items-center gap-2 text-sm text-emerald-700">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-[10px] text-white">✓</span>
              Lesson completed
            </div>
          ) : (
            <button onClick={onMarkLessonComplete} disabled={complete.isPending}
              className="rounded-md bg-[var(--sh-ink)] px-5 py-2 text-sm font-semibold text-[var(--sidebar)] hover:opacity-90 disabled:opacity-60">
              {complete.isPending ? 'Saving…' : 'Mark lesson complete'}
            </button>
          )}
          <button onClick={() => { const next = lessons[activeIndex + 1]; if (next) setActiveLessonId(next.id); }} disabled={activeIndex >= lessons.length - 1}
            className="rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] disabled:opacity-30">Next →</button>
        </div>
      )}
    </article>
  );
}

/* ================================================================== */
/* Post / single-page                                                  */
/* ================================================================== */

function PostBody({ item, assignment }: { item: ItemFull; assignment: AssignmentFull }) {
  const lesson = item.lessons[0];
  const complete = useCompleteLesson();
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

      {assignment && lesson && (
        <div className="mt-10 border-t border-[var(--sh-hair)] pt-6">
          {isCompleted ? (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white text-xs">✓</span>
              <span className="font-medium">Completed</span>
              {assignment.completed_at && <span className="text-[12px] text-emerald-600">on {new Date(assignment.completed_at).toLocaleDateString()}</span>}
            </div>
          ) : (
            <button onClick={onMarkComplete} disabled={complete.isPending}
              className="rounded-lg bg-[var(--sh-ink)] px-5 py-2.5 text-sm font-semibold text-[var(--sidebar)] hover:opacity-90 disabled:opacity-60">
              {complete.isPending ? 'Saving…' : 'Mark as complete'}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/* ================================================================== */
/* Course left rail — chapters                                         */
/* ================================================================== */

function LessonRail({ lessons, completedSet, activeLessonId, onPick }: {
  lessons: Lesson[]; completedSet: Set<string>; activeLessonId: string | null; onPick: (id: string) => void;
}) {
  const doneCount = lessons.filter((l) => completedSet.has(l.id)).length;
  const pct = lessons.length ? Math.round((doneCount / lessons.length) * 100) : 0;
  return (
    <div className="px-3 py-4">
      <div className="flex items-center justify-between px-1.5 pb-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--sh-ink-3)]">Chapters</span>
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
              <button onClick={() => onPick(lesson.id)}
                className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition ${active ? 'bg-[var(--sh-hair-3)] text-[var(--sh-ink)]' : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)]'}`}>
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${done ? 'bg-emerald-500 text-white' : active ? 'bg-[var(--sh-ink)] text-[var(--sidebar)]' : 'bg-[var(--sh-hair)] text-[var(--sh-ink-3)]'}`}>
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

/* ================================================================== */
/* Right rail — on-this-page heading outline                           */
/* ================================================================== */

interface Heading { id: string; text: string; level: number; }

function slugifyHeading(text: string, i: number) {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48);
  return `sec-${i}-${base || 'section'}`;
}

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
      setHeadings((prev) => (prev.length === next.length && prev.every((p, i) => p.id === next[i].id && p.text === next[i].text) ? prev : next));
    };
    scan();
    const mo = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(scan); });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => { mo.disconnect(); cancelAnimationFrame(raf); };
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
                <button onClick={() => jumpTo(h.id)} style={{ paddingLeft: `${(h.level - 1) * 12 + 12}px` }}
                  className={`-ml-px block w-full border-l py-1.5 pr-2 text-left text-[12px] leading-snug transition ${active ? 'border-[var(--sh-ink)] font-medium text-[var(--sh-ink)]' : 'border-transparent text-[var(--sh-ink-3)] hover:text-[var(--sh-ink)]'}`}>
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
