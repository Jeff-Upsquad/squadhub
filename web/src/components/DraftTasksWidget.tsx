'use client';

import { useState } from 'react';
import { useDraftTaskStore, type SavedDraft } from '../stores/draftTaskStore';

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function DraftTasksWidget({
  onResumeDraft,
}: {
  onResumeDraft: (saved: SavedDraft) => void;
}) {
  const drafts = useDraftTaskStore((s) => s.drafts);
  const removeDraft = useDraftTaskStore((s) => s.removeDraft);
  const clearAll = useDraftTaskStore((s) => s.clearAll);
  const [open, setOpen] = useState(false);

  if (!drafts.length) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[20] flex flex-col items-end gap-2">
      {/* Expanded list */}
      {open && (
        <div
          className="w-72 max-h-80 overflow-y-auto rounded-xl border border-[var(--sh-hair)] bg-[var(--surface)] shadow-lg"
          style={{ boxShadow: 'var(--sh-shadow-sm), 0 8px 24px rgba(0,0,0,0.12)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--sh-hair)]">
            <span className="text-[12px] font-semibold tracking-[0.02em] text-[color:var(--sh-ink-3)] uppercase">
              Draft Tasks
            </span>
            <button
              onClick={() => clearAll()}
              className="text-[11px] text-[color:var(--sh-ink-4)] hover:text-[color:var(--sh-ink-2)] transition-colors"
            >
              Clear all
            </button>
          </div>

          {/* Draft rows */}
          <div className="py-1">
            {drafts
              .slice()
              .sort((a, b) => b.savedAt - a.savedAt)
              .map((saved) => (
                <div
                  key={saved.id}
                  className="group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--sh-hair-3)] transition-colors"
                  onClick={() => {
                    onResumeDraft(saved);
                    setOpen(false);
                  }}
                >
                  {/* Draft icon */}
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-[color:var(--sh-ink-3)]"
                  >
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>

                  {/* Title + time */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-[color:var(--sh-ink)] truncate">
                      {saved.draft.title.trim() || 'Untitled draft'}
                    </div>
                    <div className="text-[11px] text-[color:var(--sh-ink-4)]">
                      {timeAgo(saved.savedAt)}
                    </div>
                  </div>

                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDraft(saved.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded hover:bg-[var(--sh-hair)] transition-all"
                    title="Delete draft"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* FAB button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-xl border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-[13px] font-medium text-[color:var(--sh-ink)] shadow-lg transition-all hover:shadow-xl"
        style={{ boxShadow: 'var(--sh-shadow-sm), 0 4px 12px rgba(0,0,0,0.08)' }}
      >
        {/* Document icon */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
        {drafts.length} {drafts.length === 1 ? 'draft' : 'drafts'}

        {/* Count badge */}
        <span
          className="flex items-center justify-center h-[18px] min-w-[18px] rounded-full text-[10px] font-bold px-1"
          style={{ background: 'var(--sh-ink)', color: 'var(--surface)' }}
        >
          {drafts.length}
        </span>
      </button>
    </div>
  );
}
