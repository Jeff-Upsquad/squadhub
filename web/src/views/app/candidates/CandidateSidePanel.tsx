import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import CandidateDetail from './CandidateDetail';

interface Props {
  candidateId: string | null;
  onClose: () => void;
  onNavigate: (direction: -1 | 1) => void;
  hasPrev: boolean;
  hasNext: boolean;
  currentIndex: number | null;
  totalCount: number;
}

export default function CandidateSidePanel({
  candidateId,
  onClose,
  onNavigate,
  hasPrev,
  hasNext,
  currentIndex,
  totalCount,
}: Props) {
  // Esc to close, ←/→ to navigate (ignored while typing in a field).
  useEffect(() => {
    if (!candidateId) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) onNavigate(-1);
      else if (e.key === 'ArrowRight' && hasNext) onNavigate(1);
    };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [candidateId, hasPrev, hasNext, onNavigate, onClose]);

  if (!candidateId || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40 transition-opacity" onClick={onClose} />
      <aside className="relative flex w-full max-w-2xl flex-col bg-canvas shadow-2xl">
        <div className="flex items-center justify-between border-b border-divider bg-surface px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onNavigate(-1)}
              disabled={!hasPrev}
              title="Previous (←)"
              aria-label="Previous candidate"
              className="rounded-lg p-2 text-foreground-muted hover:bg-canvas disabled:opacity-40"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <button
              onClick={() => onNavigate(1)}
              disabled={!hasNext}
              title="Next (→)"
              aria-label="Next candidate"
              className="rounded-lg p-2 text-foreground-muted hover:bg-canvas disabled:opacity-40"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
            {currentIndex !== null && (
              <span className="ml-2 text-xs text-foreground-muted">{currentIndex + 1} of {totalCount} on this page</span>
            )}
          </div>
          <button
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
            className="rounded-lg p-2 text-foreground-muted hover:bg-canvas"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <CandidateDetail candidateId={candidateId} onClose={onClose} />
        </div>
      </aside>
    </div>,
    document.body,
  );
}
