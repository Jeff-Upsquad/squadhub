'use client';
import { useEffect, useMemo, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { useCollabFull, useEditorMutations, useSubmitReview, useDiscardDraft } from '../../../hooks/useLmsCollab';

type Props = {
  draftItemId: string;
  isClone: boolean;
  onExit: () => void;
  onSubmitted: () => void;
};

const BLOCK_LABELS: Record<string, string> = {
  text: 'Text', image: 'Image', video_upload: 'Video', video_embed: 'Video (embed)', audio: 'Audio', pdf: 'PDF', quiz: 'Quiz',
};
// Blocks a contributor can fully author in the web editor. File-media + quiz
// authoring stays in the admin editor (uploads are chat-scoped in web).
const WEB_EDITABLE = new Set(['text', 'video_embed']);

export default function LmsEditor({ draftItemId, isClone, onExit, onSubmitted }: Props) {
  const { data: item, isLoading } = useCollabFull(draftItemId);
  const m = useEditorMutations(draftItemId);
  const submit = useSubmitReview();
  const discard = useDiscardDraft();
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);

  const lessons = useMemo(() => item?.lessons || [], [item]);
  const isCourse = item?.kind === 'course';
  const isSop = item?.track === 'sop';
  const hasNav = isCourse || isSop;

  useEffect(() => {
    if (activeLessonId || !lessons.length) return;
    const first = isSop ? (lessons.find((l) => !l.parent_lesson_id) || lessons[0]) : lessons[0];
    setActiveLessonId(first.id);
  }, [lessons, activeLessonId, isSop]);

  if (isLoading || !item) {
    return <div className="flex h-full items-center justify-center text-sm text-[var(--sh-ink-3)]">Loading editor…</div>;
  }

  const activeLesson = lessons.find((l) => l.id === activeLessonId) || lessons[0];
  const reviewState = item.review_state || 'none';

  async function onSubmit() {
    await submit.mutateAsync(draftItemId);
    onSubmitted();
  }
  async function onDiscard() {
    if (!confirm('Discard this draft? Your changes will be lost.')) return;
    await discard.mutateAsync(draftItemId);
    onExit();
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Banner */}
      <div className={`flex flex-wrap items-center gap-2 border-b px-4 py-2.5 text-[13px] ${
        isClone ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'
      }`}>
        <span className="font-medium">
          {isClone
            ? reviewState === 'changes_requested' ? 'Changes requested' : 'Draft — not yet submitted'
            : 'Editing live content'}
        </span>
        <span className="opacity-80">
          {isClone
            ? 'This is a private draft. Submit it for an admin to review and publish.'
            : 'Your changes save immediately and are live.'}
        </span>
        {isClone && reviewState === 'changes_requested' && item.review_note && (
          <span className="w-full rounded bg-white/60 px-2 py-1 text-[12px]">“{item.review_note}”</span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {isClone && (
            <button onClick={onDiscard} className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[12px] font-medium text-amber-800 hover:bg-amber-100">
              Discard
            </button>
          )}
          <button onClick={onExit} className="rounded-md border border-black/10 bg-white px-2.5 py-1 text-[12px] font-medium hover:bg-black/5">
            {isClone ? 'Save & close' : 'Done'}
          </button>
          {isClone && (
            <button
              onClick={onSubmit}
              disabled={submit.isPending}
              className="rounded-md bg-[var(--sh-ink)] px-3 py-1 text-[12px] font-semibold text-[var(--sidebar)] hover:opacity-90 disabled:opacity-60"
            >
              {submit.isPending ? 'Submitting…' : 'Submit for review'}
            </button>
          )}
        </span>
      </div>

      <div className={`grid min-h-0 flex-1 grid-cols-1 ${hasNav ? 'lg:grid-cols-[240px_1fr]' : ''}`}>
        {/* Course: flat lesson list */}
        {isCourse && (
          <aside className="hidden min-h-0 overflow-y-auto border-r border-[var(--sh-hair)] bg-[var(--sidebar)] p-2 lg:block">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--sh-ink-3)]">Lessons</span>
              <button onClick={() => m.addLesson.mutate({})} className="text-[16px] leading-none text-[var(--sh-ink-3)] hover:text-[var(--sh-ink)]" title="Add lesson">+</button>
            </div>
            <ul>
              {lessons.map((l, i) => (
                <li key={l.id}>
                  <button
                    onClick={() => setActiveLessonId(l.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] ${
                      activeLessonId === l.id ? 'bg-[var(--sh-hair-3)] text-[var(--sh-ink)]' : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)]'
                    }`}
                  >
                    <span className="w-4 text-right text-[11px] text-[var(--sh-ink-3)]">{i + 1}</span>
                    <span className="flex-1 truncate">{l.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}

        {/* SOP: nested page tree */}
        {isSop && (
          <aside className="hidden min-h-0 overflow-y-auto border-r border-[var(--sh-hair)] bg-[var(--sidebar)] p-2 lg:block">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--sh-ink-3)]">Pages</span>
              <button
                onClick={() => m.addLesson.mutate({ title: 'Untitled' }, { onSuccess: (r: any) => setActiveLessonId(r?.data?.data?.id ?? null) })}
                className="text-[16px] leading-none text-[var(--sh-ink-3)] hover:text-[var(--sh-ink)]" title="Add top-level page">+</button>
            </div>
            <EditorTree
              lessons={lessons}
              activeId={activeLessonId}
              onPick={setActiveLessonId}
              onAddSub={(parentId) => m.addLesson.mutate({ title: 'Untitled', parent_lesson_id: parentId }, { onSuccess: (r: any) => setActiveLessonId(r?.data?.data?.id ?? null) })}
            />
          </aside>
        )}

        <main className="min-h-0 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-6 py-8">
            {/* Item title + summary */}
            <input
              defaultValue={item.title}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== item.title) m.patchItem.mutate({ title: v }); }}
              placeholder="Title"
              className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-[28px] font-bold text-[var(--sh-ink)] outline-none hover:border-[var(--sh-hair)] focus:border-[var(--sh-ink)]"
            />
            <textarea
              defaultValue={item.summary || ''}
              onBlur={(e) => { if (e.target.value !== (item.summary || '')) m.patchItem.mutate({ summary: e.target.value || null }); }}
              rows={2}
              placeholder="Short summary (optional)"
              className="mt-1 w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-[14px] text-[var(--sh-ink-2)] outline-none focus:border-[var(--sh-ink)]"
            />

            {isCourse && activeLesson && (
              <div className="mt-6 flex items-center gap-2">
                <input
                  key={activeLesson.id}
                  defaultValue={activeLesson.title}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== activeLesson.title) m.patchLesson.mutate({ id: activeLesson.id, title: v }); }}
                  className="flex-1 rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-[16px] font-semibold text-[var(--sh-ink)] outline-none focus:border-[var(--sh-ink)]"
                />
                {lessons.length > 1 && (
                  <button
                    onClick={() => { if (confirm(`Delete lesson "${activeLesson.title}"?`)) { m.deleteLesson.mutate(activeLesson.id); setActiveLessonId(null); } }}
                    className="text-[12px] text-red-600 hover:underline"
                  >
                    Delete lesson
                  </button>
                )}
              </div>
            )}

            {isSop && activeLesson && (
              <div className="mt-6 flex items-center gap-2">
                {/* Emoji icon — type any emoji; blank clears it. */}
                <input
                  key={`${activeLesson.id}-icon`}
                  defaultValue={activeLesson.icon || ''}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== (activeLesson.icon || '')) m.patchLesson.mutate({ id: activeLesson.id, icon: v || null }); }}
                  placeholder="🙂"
                  maxLength={4}
                  className="w-12 rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-2 py-2 text-center text-[18px] outline-none focus:border-[var(--sh-ink)]"
                  title="Page icon (emoji)"
                />
                <input
                  key={activeLesson.id}
                  defaultValue={activeLesson.title}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== activeLesson.title) m.patchLesson.mutate({ id: activeLesson.id, title: v }); }}
                  placeholder="Untitled"
                  className="flex-1 rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-[16px] font-semibold text-[var(--sh-ink)] outline-none focus:border-[var(--sh-ink)]"
                />
                <button
                  onClick={() => m.addLesson.mutate({ title: 'Untitled', parent_lesson_id: activeLesson.id }, { onSuccess: (r: any) => setActiveLessonId(r?.data?.data?.id ?? null) })}
                  className="whitespace-nowrap rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-2.5 py-2 text-[12px] text-[var(--sh-ink-2)] hover:border-[var(--sh-ink)]"
                  title="Add a sub-page under this page"
                >
                  + Sub-page
                </button>
                {lessons.length > 1 && (
                  <button
                    onClick={() => { if (confirm(`Delete "${activeLesson.title}" and all its sub-pages?`)) { m.deleteLesson.mutate(activeLesson.id); setActiveLessonId(null); } }}
                    className="text-[12px] text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                )}
              </div>
            )}

            {/* Blocks */}
            <div className="mt-6 space-y-3">
              {activeLesson?.blocks?.map((block: any, i: number) => (
                <BlockCard
                  key={block.id}
                  block={block}
                  canMoveUp={i > 0}
                  canMoveDown={i < (activeLesson.blocks!.length - 1)}
                  onMove={(dir) => {
                    const arr = [...activeLesson.blocks!];
                    const t = i + dir;
                    if (t < 0 || t >= arr.length) return;
                    [arr[i], arr[t]] = [arr[t], arr[i]];
                    m.reorderBlocks.mutate({ lessonId: activeLesson.id, items: arr.map((b, idx) => ({ id: b.id, position: idx })) });
                  }}
                  onPatch={(patch) => m.patchBlock.mutate({ id: block.id, ...patch })}
                  onDelete={() => { if (confirm('Delete this block?')) m.deleteBlock.mutate(block.id); }}
                />
              ))}
              {activeLesson && <AddBlock onAdd={(type) => m.addBlock.mutate({ lessonId: activeLesson.id, type })} />}
              {!activeLesson && <p className="text-center text-sm text-[var(--sh-ink-3)]">No lesson selected.</p>}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/* ---- Block card ---- */
function BlockCard({ block, canMoveUp, canMoveDown, onMove, onPatch, onDelete }: {
  block: any;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (dir: -1 | 1) => void;
  onPatch: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--sh-hair)] px-3 py-1.5">
        <span className="text-[11px] font-medium text-[var(--sh-ink-3)]">{BLOCK_LABELS[block.type] || block.type}</span>
        <div className="flex items-center gap-0.5">
          <button onClick={() => onMove(-1)} disabled={!canMoveUp} className="rounded p-1 text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] disabled:opacity-30" title="Move up">↑</button>
          <button onClick={() => onMove(1)} disabled={!canMoveDown} className="rounded p-1 text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] disabled:opacity-30" title="Move down">↓</button>
          <button onClick={onDelete} className="rounded p-1 text-[var(--sh-ink-3)] hover:bg-red-50 hover:text-red-600" title="Delete">×</button>
        </div>
      </div>
      <div className="p-3">
        <BlockBody block={block} onPatch={onPatch} />
      </div>
    </div>
  );
}

function BlockBody({ block, onPatch }: { block: any; onPatch: (patch: Record<string, unknown>) => void }) {
  if (block.type === 'text') {
    return <RichTextEditor value={block.text_content} onChange={(doc) => onPatch({ text_content: doc })} />;
  }
  if (block.type === 'video_embed') {
    return (
      <div className="space-y-2">
        <input
          defaultValue={block.embed_url || ''}
          onBlur={(e) => {
            const url = e.target.value.trim();
            if (url === (block.embed_url || '')) return;
            onPatch(url ? { embed_url: url, embed_provider: providerOf(url) } : { embed_url: null, embed_provider: null });
          }}
          placeholder="Paste a YouTube / Vimeo / Loom URL"
          className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-[13px] outline-none focus:border-[var(--sh-ink)]"
        />
        {block.embed_url && <p className="truncate text-[11px] text-[var(--sh-ink-3)]">{block.embed_provider} · {block.embed_url}</p>}
      </div>
    );
  }
  // Media + quiz: read-only preview + caption, with a note pointing to admin.
  return (
    <div className="space-y-2">
      {block.file_url && block.type === 'image' && <img src={block.file_url} alt="" className="max-h-56 rounded-md" />}
      {block.file_url && block.type === 'video_upload' && <video src={block.file_url} controls className="max-h-56 w-full rounded-md" />}
      {block.file_url && block.type === 'audio' && <audio src={block.file_url} controls className="w-full" />}
      {block.file_url && block.type === 'pdf' && <a href={block.file_url} target="_blank" rel="noreferrer" className="text-[13px] text-blue-600 underline">{block.file_name || 'Open PDF'}</a>}
      {block.type !== 'quiz' && (
        <input
          defaultValue={block.caption || ''}
          onBlur={(e) => { if (e.target.value !== (block.caption || '')) onPatch({ caption: e.target.value }); }}
          placeholder="Caption (optional)"
          className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-1.5 text-[12.5px] outline-none focus:border-[var(--sh-ink)]"
        />
      )}
      <p className="rounded bg-[var(--sh-hair-3)] px-2 py-1 text-[11px] text-[var(--sh-ink-3)]">
        {block.type === 'quiz' ? 'Quiz editing' : 'Uploading or replacing this file'} is available in the admin editor.
      </p>
    </div>
  );
}

function providerOf(url: string): string {
  if (/youtu\.?be/.test(url)) return 'youtube';
  if (/vimeo/.test(url)) return 'vimeo';
  if (/loom/.test(url)) return 'loom';
  return 'embed';
}

/* ---- Add block ---- */
function AddBlock({ onAdd }: { onAdd: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full rounded-md border border-dashed border-[var(--sh-hair)] bg-[var(--surface)] py-2 text-[13px] text-[var(--sh-ink-3)] hover:border-[var(--sh-ink)] hover:text-[var(--sh-ink)]">
        + Add block
      </button>
    );
  }
  return (
    <div className="rounded-md border border-dashed border-[var(--sh-hair)] bg-[var(--surface)] p-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {['text', 'video_embed', 'image', 'video_upload', 'audio', 'pdf', 'quiz'].map((t) => (
          <button
            key={t}
            onClick={() => { onAdd(t); setOpen(false); }}
            className="rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-2 py-2 text-left text-[12.5px] text-[var(--sh-ink)] hover:border-[var(--sh-ink)]"
          >
            {BLOCK_LABELS[t]}
            {!WEB_EDITABLE.has(t) && <span className="ml-1 text-[9px] text-[var(--sh-ink-3)]">(media in admin)</span>}
          </button>
        ))}
      </div>
      <button onClick={() => setOpen(false)} className="mt-2 text-[11px] text-[var(--sh-ink-3)] hover:text-[var(--sh-ink)]">Cancel</button>
    </div>
  );
}

/* ---- SOP page tree (editor) ---- */
interface ETreeNode { lesson: any; children: ETreeNode[]; }
function buildEditorTree(lessons: any[]): ETreeNode[] {
  const byId = new Map<string, ETreeNode>();
  for (const l of lessons) byId.set(l.id, { lesson: l, children: [] });
  const roots: ETreeNode[] = [];
  for (const l of lessons) {
    const node = byId.get(l.id)!;
    const parent = l.parent_lesson_id ? byId.get(l.parent_lesson_id) : null;
    if (parent) parent.children.push(node); else roots.push(node);
  }
  const sortRec = (ns: ETreeNode[]) => { ns.sort((a, b) => a.lesson.position - b.lesson.position); ns.forEach((n) => sortRec(n.children)); };
  sortRec(roots);
  return roots;
}

function EditorTree({ lessons, activeId, onPick, onAddSub }: {
  lessons: any[]; activeId: string | null; onPick: (id: string) => void; onAddSub: (parentId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildEditorTree(lessons), [lessons]);
  const toggle = (id: string) => setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const render = (nodes: ETreeNode[], depth: number): React.ReactNode => (
    <ul>
      {nodes.map((n) => {
        const has = n.children.length > 0;
        const open = expanded.has(n.lesson.id);
        const active = activeId === n.lesson.id;
        return (
          <li key={n.lesson.id}>
            <div className={`group flex items-center gap-1 rounded-md pr-1 ${active ? 'bg-[var(--sh-hair-3)]' : 'hover:bg-[var(--sh-hair-3)]'}`} style={{ paddingLeft: `${depth * 14}px` }}>
              <button onClick={() => has && toggle(n.lesson.id)} className={`grid h-5 w-5 shrink-0 place-items-center text-[var(--sh-ink-3)] ${has ? '' : 'invisible'}`}>
                <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
              </button>
              <button onClick={() => onPick(n.lesson.id)} className="flex min-w-0 flex-1 items-center gap-1.5 py-[5px] text-left">
                <span className="text-[12px] leading-none">{n.lesson.icon || '📄'}</span>
                <span className={`truncate text-[12.5px] ${active ? 'font-medium text-[var(--sh-ink)]' : 'text-[var(--sh-ink-2)]'}`}>{n.lesson.title}</span>
              </button>
              <button onClick={() => { onAddSub(n.lesson.id); setExpanded((p) => new Set([...p, n.lesson.id])); }}
                className="shrink-0 rounded px-1 text-[14px] leading-none text-[var(--sh-ink-3)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--sh-ink)]" title="Add sub-page">+</button>
            </div>
            {has && open && render(n.children, depth + 1)}
          </li>
        );
      })}
    </ul>
  );
  return <>{render(tree, 0)}</>;
}

/* ---- Editable Tiptap (mirrors the read-only TextBlock styling) ---- */
function RichTextEditor({ value, onChange }: { value: unknown; onChange: (doc: unknown) => void }) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false }), Link.configure({ openOnClick: false }), Image],
    content: (value as any) || '',
    immediatelyRender: false,
    onBlur: ({ editor }) => onChange(editor.getJSON()),
  });

  useEffect(() => {
    if (editor && value && !editor.isFocused) editor.commands.setContent(value as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!editor) return null;
  return (
    <div className="lms-edit-prose">
      <EditorContent editor={editor} />
      <style jsx>{`
        .lms-edit-prose :global(.ProseMirror) { outline: none; min-height: 3rem; }
        .lms-edit-prose :global(h1) { font-size: 1.6em; font-weight: 700; margin: 0.5em 0 0.3em; color: var(--sh-ink); }
        .lms-edit-prose :global(h2) { font-size: 1.3em; font-weight: 700; margin: 0.5em 0 0.3em; color: var(--sh-ink); }
        .lms-edit-prose :global(p) { line-height: 1.6; margin: 0.35em 0; color: var(--sh-ink-2); }
        .lms-edit-prose :global(ul) { list-style: disc; padding-left: 1.4em; }
        .lms-edit-prose :global(ol) { list-style: decimal; padding-left: 1.4em; }
        .lms-edit-prose :global(a) { color: #2563eb; text-decoration: underline; }
        .lms-edit-prose :global(code) { background: var(--sh-hair-3); padding: 1px 5px; border-radius: 3px; }
      `}</style>
    </div>
  );
}
