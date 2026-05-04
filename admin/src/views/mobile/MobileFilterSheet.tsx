'use client';

import { useEffect } from 'react';

type SalesPerson = { id: string; display_name: string | null; email: string | null };

export default function MobileFilterSheet({
  open,
  onClose,
  salesPeople,
  publishedBy,
  onPublishedByChange,
  groupBy,
  onGroupByChange,
}: {
  open: boolean;
  onClose: () => void;
  salesPeople: SalesPerson[];
  publishedBy: string;
  onPublishedByChange: (id: string) => void;
  groupBy: 'status' | 'date';
  onGroupByChange: (g: 'status' | 'date') => void;
}) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border-t-2 border-x-2 border-black bg-white px-5 pb-8 pt-4" style={{ animation: 'slideUp 0.25s ease-out' }}>
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#a3a3a3]" />
        <div className="flex items-center justify-between">
          <h3 className="font-[family-name:var(--font-jakarta)] text-lg font-bold text-[#0a0a0a]">
            Filters
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg border-2 border-black bg-white p-1.5 active:scale-[0.97] transition-transform"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Group by */}
        <div className="mt-5">
          <h4 className="mb-2 font-[family-name:var(--font-jakarta)] text-xs font-bold uppercase tracking-wider text-[#a3a3a3]">
            Group By
          </h4>
          <div className="flex gap-2">
            {(['status', 'date'] as const).map((g) => (
              <button
                key={g}
                onClick={() => onGroupByChange(g)}
                className={`flex-1 rounded-xl border-2 px-3 py-2.5 text-sm font-bold transition-all active:scale-[0.97] ${
                  groupBy === g
                    ? 'border-black bg-[#0a0a0a] text-white shadow-[2px_2px_0_0_#d4ff4d]'
                    : 'border-black bg-white text-[#0a0a0a]'
                }`}
              >
                {g === 'status' ? 'Status' : 'Date'}
              </button>
            ))}
          </div>
        </div>

        {/* Published by */}
        <div className="mt-5">
          <h4 className="mb-2 font-[family-name:var(--font-jakarta)] text-xs font-bold uppercase tracking-wider text-[#a3a3a3]">
            Published By
          </h4>
          <div className="space-y-2">
            <button
              onClick={() => onPublishedByChange('')}
              className={`w-full rounded-xl border-2 px-4 py-2.5 text-left text-sm font-bold transition-all active:scale-[0.98] ${
                publishedBy === ''
                  ? 'border-black bg-[#d4ff4d] text-black shadow-[2px_2px_0_0_#000]'
                  : 'border-black/20 bg-white text-[#0a0a0a]'
              }`}
            >
              All sales people
            </button>
            {salesPeople.map((p) => (
              <button
                key={p.id}
                onClick={() => onPublishedByChange(p.id)}
                className={`w-full rounded-xl border-2 px-4 py-2.5 text-left text-sm font-bold transition-all active:scale-[0.98] ${
                  publishedBy === p.id
                    ? 'border-black bg-[#d4ff4d] text-black shadow-[2px_2px_0_0_#000]'
                    : 'border-black/20 bg-white text-[#0a0a0a]'
                }`}
              >
                {p.display_name || p.email || p.id.slice(0, 8)}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-6 w-full rounded-xl border-2 border-black bg-[#0a0a0a] px-4 py-3.5 text-sm font-bold text-white shadow-[3px_3px_0_0_#000] active:scale-[0.97] active:shadow-[1px_1px_0_0_#000] transition-transform"
        >
          Apply Filters
        </button>
      </div>
    </div>
  );
}
