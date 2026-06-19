'use client';
import { useNotesStore } from '../../../stores/notesStore';
import NotesSidebar from './NotesSidebar';
import NotePage from './NotePage';
import './notes.css';

export default function NotesShell() {
  const activeNoteId = useNotesStore((s) => s.activeNoteId);

  return (
    <div className="flex min-h-0 flex-1">
      <NotesSidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {activeNoteId ? (
          <NotePage key={activeNoteId} noteId={activeNoteId} />
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
