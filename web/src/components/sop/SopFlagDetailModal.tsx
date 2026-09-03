'use client';

interface FlagDetail {
  sop_label: string;
  count_in_window: number;
  threshold: number;
  window_label: string;
  severity: string;
  strike_points: number;
  is_strike: boolean;
  sop_link: string;
}

export default function SopFlagDetailModal({ detail, onClose }: { detail: FlagDetail; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[var(--sh-hair)] bg-[var(--surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className={`mx-auto grid h-12 w-12 place-items-center rounded-full ${detail.is_strike ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
          <span className="text-xl">{detail.is_strike ? '⚠️' : '🚩'}</span>
        </div>
        <h2 className="mt-3 text-center text-[16px] font-semibold text-[var(--sh-ink)]">
          {detail.is_strike ? 'Strike issued' : 'Flag recorded'}
        </h2>
        <p className="mt-1 text-center text-[12.5px] text-[var(--sh-ink-3)]">
          <b className="text-[var(--sh-ink)]">{detail.sop_label}</b>
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-[var(--sh-hair)] bg-[var(--sh-hair-3)] p-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sh-ink-3)]">Flags</div>
            <div className="text-[18px] font-bold text-[var(--sh-ink)]">{detail.count_in_window}<span className="text-[11px] font-medium text-[var(--sh-ink-3)]"> / {detail.threshold}</span></div>
          </div>
          <div className="rounded-lg border border-[var(--sh-hair)] bg-[var(--sh-hair-3)] p-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sh-ink-3)]">Window</div>
            <div className="text-[12px] font-semibold text-[var(--sh-ink)]">{detail.window_label}</div>
          </div>
          <div className="rounded-lg border border-[var(--sh-hair)] bg-[var(--sh-hair-3)] p-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sh-ink-3)]">Strike pts</div>
            <div className="text-[18px] font-bold text-[var(--sh-ink)]">{detail.strike_points}</div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-center gap-2 text-[11px]">
          <span className={`rounded-full px-2 py-0.5 font-semibold ${detail.severity === 'high' ? 'bg-red-50 text-red-700' : detail.severity === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{detail.severity.toUpperCase()}</span>
          <span className="text-[var(--sh-ink-3)]">{detail.is_strike ? 'Threshold reached — strike applied' : `${detail.threshold - detail.count_in_window} more until strike`}</span>
        </div>

        <div className="mt-5 flex gap-2">
          <a
            href={detail.sop_link}
            className="flex-1 rounded-md border border-[var(--sh-hair)] bg-[var(--sh-hair-3)] px-4 py-2 text-center text-[13px] font-medium text-[var(--sh-ink)] hover:bg-[var(--sh-hair)]"
          >
            View SOP →
          </a>
          <button onClick={onClose} className="flex-1 rounded-md bg-[var(--sh-ink)] px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90">Close</button>
        </div>
      </div>
    </div>
  );
}
