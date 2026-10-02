import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { initials } from './goalUtils';

export type GoalIconName =
  | 'plus' | 'search' | 'chevron' | 'chevronDown' | 'arrow' | 'close' | 'external' | 'calendar'
  | 'grid' | 'rows' | 'folder' | 'list' | 'check' | 'link' | 'more' | 'grip' | 'panel' | 'people'
  | 'tag' | 'trash' | 'clock' | 'minus' | 'target' | 'unlink' | 'tray' | 'timeline' | 'sparkle'
  | 'expand' | 'edit' | 'mountain' | 'today' | 'flag';

const PATHS: Record<GoalIconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  external: <><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></>,
  rows: <><rect x="4" y="5" width="16" height="4" rx="1.5" /><rect x="4" y="11" width="16" height="4" rx="1.5" /><path d="M4 19h16" /></>,
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  link: <><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" /></>,
  unlink: <><path d="M15.5 12.8 19.4 9a4.5 4.5 0 0 0-6.4-6.4l-1.6 1.6" /><path d="M8.5 11.2 4.6 15a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6" /><path d="m4 4 16 16" /></>,
  more: <><circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" /></>,
  grip: <><circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none" /></>,
  panel: <><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M14.5 4.5v15" /></>,
  people: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20a6.5 6.5 0 0 0-4-6" /></>,
  tag: <><path d="M3.5 12.2V5a1.5 1.5 0 0 1 1.5-1.5h7.2a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8l-6.3 6.3a2 2 0 0 1-2.8 0l-7.4-7.2a2 2 0 0 1-.6-.8z" /><circle cx="8.5" cy="8.5" r="1.4" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  minus: <path d="M5 12h14" />,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></>,
  tray: <><path d="M4 13.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7.5" /><path d="M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /></>,
  timeline: <><path d="M4 6h9M8 12h10M6 18h7" /><circle cx="15.5" cy="6" r="1.6" /><circle cx="20" cy="12" r="1.6" /><circle cx="15.5" cy="18" r="1.6" /></>,
  sparkle: <path d="M12 3.5 13.8 10l6.7 2-6.7 2L12 20.5 10.2 14 3.5 12l6.7-2z" />,
  expand: <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />,
  edit: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  mountain: <><path d="m2.5 19.5 6.5-11 4 6.5 2.5-3.5 6 8z" /><path d="M9 8.5V3.5l3.5 1.4L9 6.2" /></>,
  flag: <><path d="M5.5 21V3.5" /><path d="M5.5 4.5c4.5-2.6 8 2.6 13 0v8.5c-5 2.6-8.5-2.6-13 0" /></>,
  today: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /><circle cx="12" cy="15" r="1.8" fill="currentColor" /></>,
};

export default function GoalIcon({ name, size = 16, className, style, strokeWidth = 1.8 }: {
  name: GoalIconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

// Cloth frames share one command structure so SMIL can morph between them —
// a ripple travels along the cloth like a flag in a light breeze.
const CLOTH = [
  'M6.2 4.2C9 2.9 12 5.5 15 4.2C17 3.3 18.6 3.6 20.4 4.3L20.4 12.6C18.6 11.9 17 11.6 15 12.6C12 13.9 9 11.3 6.2 12.6Z',
  'M6.2 4.2C9 5.4 12 3 15 4.2C17 5 18.6 4.8 20 4.1L20 12.4C18.6 13.1 17 13.3 15 12.6C12 11.4 9 13.8 6.2 12.6Z',
];

/**
 * The goal flag: a pole with a cloth that waves gently (static when the OS
 * asks for reduced motion, or when `still`).
 */
export function WavingFlag({ size = 16, color = '#7c5cff', still = false, className, title }: {
  size?: number;
  color?: string;
  still?: boolean;
  className?: string;
  title?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const sheen = `gl-sheen-${useId().replace(/:/g, '')}`;
  const animate = !still && !reduced;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d="M5.4 3.2v18.3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" opacity="0.72" />
      <circle cx="5.4" cy="2.6" r="1.25" fill="currentColor" opacity="0.72" />
      <path d={CLOTH[0]} fill={color}>
        {animate && (
          <animate attributeName="d" dur="2.4s" repeatCount="indefinite" calcMode="spline"
            keyTimes="0;0.5;1" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" values={`${CLOTH[0]};${CLOTH[1]};${CLOTH[0]}`} />
        )}
      </path>
      <path d={CLOTH[0]} fill={`url(#${sheen})`} opacity="0.5">
        {animate && (
          <animate attributeName="d" dur="2.4s" repeatCount="indefinite" calcMode="spline"
            keyTimes="0;0.5;1" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" values={`${CLOTH[0]};${CLOTH[1]};${CLOTH[0]}`} />
        )}
      </path>
      <defs>
        <linearGradient id={sheen} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Circular progress. Animates in from empty on mount. */
export function ProgressRing({ progress, size = 44, stroke = 4, color = 'var(--gl-accent)', children, done }: {
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
  done?: boolean;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, progress)) / 100);
  return (
    <span className="gl-ring" style={{ width: size, height: size }} data-done={done || undefined}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--gl-ring-track)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
          style={{ '--gl-ring-full': `${c}px` } as CSSProperties}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children != null && <span className="gl-ring-center">{children}</span>}
    </span>
  );
}

export interface MemberLike { id: string; display_name: string; avatar_url?: string | null }

export function Avatar({ member, size = 24 }: { member: MemberLike; size?: number }) {
  return (
    <span className="gl-avatar" style={{ width: size, height: size, fontSize: Math.max(9, size * 0.4) }} title={member.display_name}>
      {member.avatar_url ? <img src={member.avatar_url} alt="" /> : initials(member.display_name)}
    </span>
  );
}

export function AvatarStack({ members, size = 24, max = 3 }: { members: MemberLike[]; size?: number; max?: number }) {
  if (!members.length) return null;
  const shown = members.slice(0, max);
  return (
    <span className="gl-avatars" title={members.map((m) => m.display_name).join(', ')}>
      {shown.map((m) => <Avatar key={m.id} member={m} size={size} />)}
      {members.length > max && (
        <span className="gl-avatar gl-avatar-more" style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38) }}>
          +{members.length - max}
        </span>
      )}
    </span>
  );
}

/** One segment per task (done = filled), or a smooth bar for big goals. */
export function SegmentBar({ done, total, color }: { done: number; total: number; color?: string }) {
  const style = color ? ({ '--gl-seg': color } as CSSProperties) : undefined;
  if (!total) return <span className="gl-segbar gl-segbar-empty" style={style} />;
  if (total > 24) {
    return (
      <span className="gl-segbar gl-segbar-smooth" style={style}>
        <i style={{ width: `${(done / total) * 100}%` }} />
      </span>
    );
  }
  return (
    <span className="gl-segbar" style={style} role="img" aria-label={`${done} of ${total} tasks done`}>
      {Array.from({ length: total }, (_, i) => <i key={i} data-on={i < done || undefined} style={{ animationDelay: `${i * 22}ms` }} />)}
    </span>
  );
}
