'use client';
import { sopSourceFromNotification } from '../../lib/openSopResource';

type N = {
  type: string;
  title?: string | null;
  body?: string | null;
  created_at: string;
  metadata?: Record<string, any> | null;
  is_read?: boolean;
};

function pennant(filled: boolean, strike: boolean) {
  const fill = filled ? (strike ? '#8B1E1E' : '#B45309') : 'none';
  const stroke = filled ? (strike ? '#8B1E1E' : '#B45309') : 'var(--sh-ink-4)';
  return (
    <svg width="13" height="17" viewBox="0 0 13 17" aria-hidden className="sopn-pennant" data-filled={filled}>
      <path d="M2.2 1.2 v14.4" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2.8 1.4 L11.4 5.4 L2.8 9.3 Z" fill={fill} stroke={stroke} strokeWidth="1.15" strokeLinejoin="round" />
    </svg>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (d.toDateString() === now.toDateString()) {
    if (mins < 60) return `${mins}m ago`;
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function SopNotifCard({
  n,
  active,
  onSelect,
  onOpenSop,
  onOpenSource,
}: {
  n: N;
  active?: boolean;
  onSelect?: () => void;
  onOpenSop: () => void;
  onOpenSource?: () => void;
}) {
  const strike = n.type === 'sop_strike';
  const m = n.metadata || {};
  const filled = Math.max(0, Number(m.flag_count) || 0);
  const total = Math.max(filled, Number(m.flag_threshold) || 0);
  const show = Math.min(Math.max(total, 1), 8);
  const filledShown = Math.min(filled, show);
  const page = (m.lesson_title as string) || (m.item_title as string) || n.title || 'SOP';
  const item = m.lesson_title ? (m.item_title as string) : null;
  const reason = (m.reason as string | null) || null;
  const pts = m.strike_points;
  const monthCount = Number(m.monthly_strikes ?? 0);
  const monthPts = m.monthly_points ?? 0;
  const windowTxt = (m.window_label as string) || null;
  const source = sopSourceFromNotification(n);

  return (
    <article
      className="sopn"
      data-strike={strike}
      data-active={active ? 'true' : 'false'}
      data-unread={n.is_read === false ? 'true' : 'false'}
      onClick={onSelect}
    >
      <header className="sopn-head">
        <span className="sopn-kicker">{strike ? 'Strike' : 'Flag'}</span>
        <span className="sopn-time">{when(n.created_at)}</span>
      </header>
      <h3 className="sopn-title">{page}</h3>
      {item && <p className="sopn-sub">{item}</p>}

      <div className="sopn-meter" title={`${filled} of ${total} flags${windowTxt ? ` · ${windowTxt}` : ''}`}>
        <div className="sopn-flags" aria-hidden>
          {Array.from({ length: show }, (_, i) => (
            <span key={i}>{pennant(i < filledShown, strike)}</span>
          ))}
        </div>
        <div className="sopn-meter-copy">
          <b>{filled}</b>
          <span> / {total}</span>
          {windowTxt && <em>{windowTxt}</em>}
        </div>
      </div>

      <div className="sopn-stats">
        <div className="sopn-stat">
          <span className="sopn-stat-k">This {strike ? 'strike' : 'flag'}</span>
          <span className="sopn-stat-v">{pts ?? 0} <small>pt</small></span>
        </div>
        <div className="sopn-stat">
          <span className="sopn-stat-k">This month</span>
          <span className="sopn-stat-v">
            {monthCount} <small>strike{monthCount === 1 ? '' : 's'}</small>
            <em>{monthPts} pt</em>
          </span>
        </div>
      </div>

      {reason && (
        <p className="sopn-reason">
          <span>Reason</span>
          {reason}
        </p>
      )}

      <div className="sopn-links">
        <button type="button" className="sopn-btn sopn-btn-ink" onClick={(e) => { e.stopPropagation(); onOpenSop(); }}>
          Open SOP
        </button>
      </div>
      {source && onOpenSource && (
        <button
          type="button"
          className="sopn-source"
          onClick={(e) => { e.stopPropagation(); onOpenSource(); }}
        >
          Click to view the source/reason for this {strike ? 'strike' : 'flag'}.
        </button>
      )}
    </article>
  );
}
