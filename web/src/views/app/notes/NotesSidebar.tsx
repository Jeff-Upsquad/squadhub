'use client';
import { useMemo, useState } from 'react';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { useNotesStore } from '../../../stores/notesStore';
import {
  useNotesTree,
  useCreateNote,
  useDeleteNote,
  useUpdateNote,
  useNotesTrash,
  useRestoreNote,
} from '../../../hooks/useNotes';
import type { NoteTreeItem } from './types';
import ShareModal from './ShareModal';

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`h-3 w-3 transition-transform ${open ? '' : '-rotate-90'}`} viewBox="0 0 18 18" fill="currentColor">
      <path d="M5 7h8L9 11z" />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg className="h-3 w-3 shrink-0 text-[var(--sh-ink-4)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

function RowMenu({
  onShare,
  onRename,
  onDelete,
  onClose,
}: {
  onShare: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-[59]" onClick={onClose} />
      <div className="absolute right-1 top-7 z-[60] w-40 rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] py-1 shadow-lg">
        <button className="sh-note-menu__item" onClick={onShare}>Share…</button>
        <button className="sh-note-menu__item" onClick={onRename}>Rename</button>
        <button className="sh-note-menu__item sh-note-menu__item--danger" onClick={onDelete}>Delete</button>
      </div>
    </>
  );
}

function NoteRow({
  note,
  childrenOf,
  depth,
}: {
  note: NoteTreeItem;
  childrenOf: (parentId: string) => NoteTreeItem[];
  depth: number;
}) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const activeNoteId = useNotesStore((s) => s.activeNoteId);
  const setActiveNote = useNotesStore((s) => s.setActiveNote);
  const pushRecent = useNotesStore((s) => s.pushRecent);
  const expandedIds = useNotesStore((s) => s.expandedIds);
  const toggleExpanded = useNotesStore((s) => s.toggleExpanded);
  const setExpanded = useNotesStore((s) => s.setExpanded);

  const create = useCreateNote(workspaceId);
  const del = useDeleteNote(workspaceId);
  const update = useUpdateNote(workspaceId);

  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const kids = childrenOf(note.id);
  const open = expandedIds.has(note.id);
  const isActive = activeNoteId === note.id;

  const openNote = () => {
    setActiveNote(note.id);
    pushRecent(note.id);
  };

  const addChild = () => {
    create.mutate(
      { parent_id: note.id, title: 'Untitled' },
      {
        onSuccess: (child) => {
          setExpanded(note.id, true);
          setActiveNote(child.id);
          pushRecent(child.id);
        },
      },
    );
  };

  return (
    <div>
      <div
        className={`sh-note-row group${isActive ? ' is-active' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        <button
          className="sh-note-row__chev"
          onClick={(e) => { e.stopPropagation(); toggleExpanded(note.id); }}
          aria-label={open ? 'Collapse' : 'Expand'}
          style={{ visibility: kids.length ? 'visible' : 'hidden' }}
        >
          <Chevron open={open} />
        </button>
        <button className="sh-note-row__main" onClick={openNote}>
          <span className="sh-note-row__icon">{note.icon || '📄'}</span>
          <span className="sh-note-row__title">{note.title || 'Untitled'}</span>
          {note.visibility === 'shared' && <span className="sh-note-row__lock"><LockGlyph /></span>}
        </button>
        <div className="sh-note-row__actions">
          <button className="sh-note-row__act" title="Add page inside" onClick={(e) => { e.stopPropagation(); addChild(); }}>
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          </button>
          <button className="sh-note-row__act" title="More" onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="6" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="18" r="1.5" /></svg>
          </button>
          {menuOpen && (
            <RowMenu
              onClose={() => setMenuOpen(false)}
              onShare={() => { setMenuOpen(false); setShareOpen(true); }}
              onRename={() => {
                setMenuOpen(false);
                const next = window.prompt('Rename page', note.title);
                if (next !== null && next.trim()) update.mutate({ id: note.id, patch: { title: next.trim() } });
              }}
              onDelete={() => {
                setMenuOpen(false);
                if (window.confirm(`Delete "${note.title}" and its sub-pages? You can restore it from Trash.`)) {
                  del.mutate(note.id);
                  if (isActive) setActiveNote(null);
                }
              }}
            />
          )}
        </div>
      </div>

      {open && kids.map((k) => <NoteRow key={k.id} note={k} childrenOf={childrenOf} depth={depth + 1} />)}

      {shareOpen && workspaceId && (
        <ShareModal noteId={note.id} noteTitle={note.title} workspaceId={workspaceId} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}

function TrashPanel({ workspaceId, onClose }: { workspaceId: string | undefined; onClose: () => void }) {
  const { data: trash, isLoading } = useNotesTrash(workspaceId);
  const restore = useRestoreNote(workspaceId);
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/30 pt-24" onClick={onClose}>
      <div className="w-[440px] max-w-[90vw] rounded-xl border border-[var(--sh-hair)] bg-[var(--surface)] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--sh-hair)] px-4 py-3">
          <h3 className="text-[14px] font-semibold text-[var(--sh-ink)]">Trash</h3>
          <button className="text-[var(--sh-ink-4)] hover:text-[var(--sh-ink)]" onClick={onClose}>✕</button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {isLoading && <p className="px-2 py-3 text-[12.5px] text-[var(--sh-ink-4)]">Loading…</p>}
          {!isLoading && (!trash || trash.length === 0) && (
            <p className="px-2 py-6 text-center text-[12.5px] text-[var(--sh-ink-4)]">Trash is empty</p>
          )}
          {trash?.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--sh-hair-3)]">
              <span>{t.icon || '📄'}</span>
              <span className="flex-1 truncate text-[13px] text-[var(--sh-ink-2)]">{t.title || 'Untitled'}</span>
              <button
                className="rounded-md border border-[var(--sh-hair)] px-2 py-0.5 text-[12px] text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)]"
                onClick={() => restore.mutate(t.id)}
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function NotesSidebar() {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const { data: items, isLoading } = useNotesTree(workspaceId);
  const create = useCreateNote(workspaceId);
  const setActiveNote = useNotesStore((s) => s.setActiveNote);
  const pushRecent = useNotesStore((s) => s.pushRecent);
  const [trashOpen, setTrashOpen] = useState(false);

  const { roots, childrenOf } = useMemo(() => {
    const list = items || [];
    const byParent = new Map<string | null, NoteTreeItem[]>();
    for (const n of list) {
      const key = n.parent_id;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(n);
    }
    for (const arr of byParent.values()) arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    return {
      roots: byParent.get(null) || [],
      childrenOf: (parentId: string) => byParent.get(parentId) || [],
    };
  }, [items]);

  const newPage = () => {
    create.mutate(
      { title: 'Untitled' },
      {
        onSuccess: (note) => {
          setActiveNote(note.id);
          pushRecent(note.id);
        },
      },
    );
  };

  return (
    <aside className="sh-notes-sidebar flex h-full w-full shrink-0 flex-col bg-[var(--sidebar)]">
      <div className="flex items-center justify-between px-3 py-3">
        <h2 className="text-[13px] font-semibold tracking-tight text-[var(--sh-ink)]">SquadNotes</h2>
        <button className="sh-note-row__act" title="New page" onClick={newPage}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-4">
        <div className="px-2 py-1 text-[10.5px] font-medium uppercase tracking-wider text-[var(--sh-ink-4)]">Pages</div>
        {isLoading && <p className="px-3 py-2 text-[12px] text-[var(--sh-ink-4)]">Loading…</p>}
        {!isLoading && roots.length === 0 && (
          <button onClick={newPage} className="mx-2 mt-1 rounded-md px-2 py-2 text-left text-[12.5px] text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)]">
            + Create your first page
          </button>
        )}
        {roots.map((n) => (
          <NoteRow key={n.id} note={n} childrenOf={childrenOf} depth={0} />
        ))}
      </div>

      <div className="border-t border-[var(--sh-hair)] px-1.5 py-1.5">
        <button className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]" onClick={() => setTrashOpen(true)}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          Trash
        </button>
      </div>

      {trashOpen && <TrashPanel workspaceId={workspaceId} onClose={() => setTrashOpen(false)} />}
    </aside>
  );
}
