'use client';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { useNotesStore } from '../../../stores/notesStore';
import { useNote, useNotesTree, useNoteAutosave } from '../../../hooks/useNotes';
import { useNoteUpload } from './useNoteUpload';
import type { Note, NoteTreeItem, NoteTextSize, NotePatch } from './types';
import NoteEditor from './NoteEditor';

function useBreadcrumbs(noteId: string): NoteTreeItem[] {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const { data: items } = useNotesTree(workspaceId);
  if (!items) return [];
  const byId = new Map(items.map((n) => [n.id, n]));
  const chain: NoteTreeItem[] = [];
  let cur = byId.get(noteId);
  let guard = 0;
  while (cur && guard < 50) {
    chain.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    guard += 1;
  }
  return chain;
}

function PageMenu({
  size,
  fullWidth,
  onSize,
  onFullWidth,
  onClose,
}: {
  size: NoteTextSize;
  fullWidth: boolean;
  onSize: (s: NoteTextSize) => void;
  onFullWidth: (v: boolean) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-[59]" onClick={onClose} />
      <div className="absolute right-0 top-9 z-[60] w-52 rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] p-2 shadow-lg">
        <div className="px-1.5 pb-1 text-[10.5px] font-medium uppercase tracking-wider text-[var(--sh-ink-4)]">Text size</div>
        <div className="mb-2 flex gap-1">
          {(['small', 'normal', 'large'] as NoteTextSize[]).map((s) => (
            <button
              key={s}
              onClick={() => onSize(s)}
              className={`flex-1 rounded-md border px-2 py-1 text-[12px] capitalize transition ${
                size === s
                  ? 'border-[var(--sh-ink-4)] bg-[var(--sh-hair-3)] text-[var(--sh-ink)]'
                  : 'border-[var(--sh-hair)] text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          onClick={() => onFullWidth(!fullWidth)}
          className="flex w-full items-center justify-between rounded-md px-1.5 py-1.5 text-[12.5px] text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)]"
        >
          <span>Full width</span>
          <span className={`relative h-4 w-7 rounded-full transition ${fullWidth ? 'bg-[var(--sh-ink)]' : 'bg-[var(--sh-hair)]'}`}>
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${fullWidth ? 'left-3.5' : 'left-0.5'}`} />
          </span>
        </button>
      </div>
    </>
  );
}

function PageInner({ note }: { note: Note }) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const setActiveNote = useNotesStore((s) => s.setActiveNote);
  const qc = useQueryClient();
  const { save } = useNoteAutosave(note.id);
  const { upload } = useNoteUpload(note.id);
  const crumbs = useBreadcrumbs(note.id);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [title, setTitle] = useState(note.title);

  const editable = note.access !== 'read';

  useEffect(() => setTitle(note.title), [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchNoteCache = (partial: Partial<Note>) =>
    qc.setQueryData<Note>(['notes', 'note', note.id], (old) => (old ? { ...old, ...partial } : old));
  const patchTreeCache = (partial: Partial<NoteTreeItem>) =>
    qc.setQueryData<NoteTreeItem[]>(['notes', 'tree', workspaceId], (old) =>
      old?.map((n) => (n.id === note.id ? { ...n, ...partial } : n)),
    );

  const apply = (patch: NotePatch, opts?: { tree?: boolean }) => {
    patchNoteCache(patch as Partial<Note>);
    if (opts?.tree) patchTreeCache(patch as Partial<NoteTreeItem>);
    save(patch);
  };

  const onTitle = (v: string) => {
    setTitle(v);
    apply({ title: v }, { tree: true });
  };

  const onIcon = () => {
    if (!editable) return;
    const next = window.prompt('Page icon (emoji)', note.icon || '📄');
    if (next === null) return;
    apply({ icon: next.trim() || null }, { tree: true });
  };

  const onCoverPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const res = await upload(file);
    if (res) apply({ cover_url: res.file_url });
  };

  const size = note.text_size;
  const fullWidth = note.full_width;

  return (
    <div className={`sh-notes-page ts-${size} ${fullWidth ? 'pw-full' : 'pw-default'}`}>
      {note.cover_url && (
        <div className="sh-notes-cover group">
          <img src={note.cover_url} alt="" />
          {editable && (
            <div className="sh-notes-cover__actions">
              <button onClick={() => coverInputRef.current?.click()}>Change</button>
              <button onClick={() => apply({ cover_url: null })}>Remove</button>
            </div>
          )}
        </div>
      )}

      <div className="sh-notes-page__inner">
        {/* breadcrumbs + page menu */}
        <div className="sh-notes-topbar">
          <div className="sh-notes-crumbs">
            {crumbs.map((c, i) => (
              <span key={c.id} className="sh-notes-crumb">
                {i > 0 && <span className="sh-notes-crumb__sep">/</span>}
                <button onClick={() => setActiveNote(c.id)} className={c.id === note.id ? 'is-current' : ''}>
                  <span>{c.icon || '📄'}</span>
                  <span className="truncate">{c.title || 'Untitled'}</span>
                </button>
              </span>
            ))}
          </div>
          <div className="relative">
            <button className="sh-notes-aa" title="Page style" onClick={() => setMenuOpen((v) => !v)}>Aa</button>
            {menuOpen && (
              <PageMenu
                size={size}
                fullWidth={fullWidth}
                onSize={(s) => apply({ text_size: s })}
                onFullWidth={(v) => apply({ full_width: v })}
                onClose={() => setMenuOpen(false)}
              />
            )}
          </div>
        </div>

        {/* icon + add-cover affordances */}
        <div className="sh-notes-head-tools">
          <button className="sh-notes-bigicon" onClick={onIcon} disabled={!editable}>{note.icon || '📄'}</button>
          {editable && !note.cover_url && (
            <button className="sh-notes-addcover" onClick={() => coverInputRef.current?.click()}>＋ Add cover</button>
          )}
        </div>

        {/* title */}
        <input
          className="sh-notes-title"
          value={title}
          placeholder="Untitled"
          readOnly={!editable}
          onChange={(e) => onTitle(e.target.value)}
        />

        {!editable && <div className="sh-notes-readonly">Read-only · shared with you</div>}

        {/* editor */}
        <NoteEditor
          noteId={note.id}
          initialContent={note.content}
          editable={editable}
          workspaceId={workspaceId}
          // Keep the cached note in sync with editor saves so navigating away
          // and back within the session reflects edits (the autosave PATCH alone
          // doesn't update the query cache, which has staleTime: Infinity).
          save={(patch) => { patchNoteCache(patch as Partial<Note>); save(patch); }}
        />
      </div>

      <input ref={coverInputRef} type="file" accept="image/*" hidden onChange={onCoverPicked} />
    </div>
  );
}

export default function NotePage({ noteId }: { noteId: string }) {
  const { data: note, isLoading, isError } = useNote(noteId);

  if (isLoading) {
    return <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--sh-ink-4)]">Loading…</div>;
  }
  if (isError || !note) {
    return <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--sh-ink-4)]">This page is unavailable.</div>;
  }
  return <PageInner note={note} />;
}
