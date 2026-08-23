'use client';
import { useNotesStore } from '../../../stores/notesStore';
import NotesSidebar from './NotesSidebar';
import NotePage from './NotePage';
import './notes.css';

export default function NotesShell() {
  const activeNoteId = useNotesStore((s) => s.activeNoteId);

  return (
    <div className="flex min-h-0 flex-1" data-note-open={activeNoteId ? 'true' : undefined}>
      <NotesSidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {activeNoteId ? (
          <>
            {/* Phone: the editor replaces the pages list, so it owns a way
                back. Hidden ≥768px by Tailwind, where the sidebar is visible. */}
            <button
              type="button"
              className="sh-note-back md:hidden"
              onClick={() => useNotesStore.getState().setActiveNote(null)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m15 18-6-6 6-6" />
              </svg>
              All pages
            </button>
            <NotePage key={activeNoteId} noteId={activeNoteId} />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="mb-3 text-[40px] opacity-30">📝</div>
            <h3 className="serif text-[28px] text-[var(--sh-ink)]" style={{ fontFamily: 'var(--font-serif, Plus Jakarta Sans, sans-serif)' }}>
              SquadNotes
            </h3>
            <p className="mt-1 text-[12.5px] text-[var(--sh-ink-3)]">Select a page on the left, or create a new one.</p>
          </div>
        )}
      </div>
    </div>
  );
}
