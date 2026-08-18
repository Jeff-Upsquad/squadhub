'use client';

import React from 'react';

export type CardViewMode = 'admin' | 'client' | 'details';

// Segmented control that flips a card-detail screen between:
//   · Admin — recipients funnel (working view)
//   · Client view — same review screen the business sees in SquadHire,
//     including shortlist / reject / select / bidding / chat (messages send
//     as the acting Leads user, not as the business)
//   · Deal details — the New Deal form layout, view-only, with every field
//     that was available when the card was drafted/published
export default function CardViewToggle({
  viewMode,
  onSetViewMode,
}: {
  viewMode: CardViewMode;
  onSetViewMode: (m: CardViewMode) => void;
}) {
  const opts: { key: CardViewMode; label: string }[] = [
    { key: 'admin', label: 'Admin' },
    { key: 'client', label: 'Client view' },
    { key: 'details', label: 'Deal details' },
  ];
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--color-sh-warm-border)] bg-[var(--color-sh-cream)] p-0.5">
      {opts.map((o) => {
        const active = viewMode === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onSetViewMode(o.key)}
            className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
              active
                ? 'bg-[var(--color-surface)] text-[var(--color-sh-ink)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                : 'text-[var(--color-sh-ink-subtle)] hover:text-[var(--color-sh-ink)]'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
