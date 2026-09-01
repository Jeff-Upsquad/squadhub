'use client';

/**
 * Shared primitives for the mobile browser shell.
 *
 * These are the web counterparts of the Business Android app's
 * `ui/components/SlackKit.kt` + `ui/theme` helpers — same names, same
 * proportions, so a change on one side is easy to mirror on the other.
 * Styling lives in `styles/mobile.css` under the `.msh` scope.
 */

import type { ReactNode } from 'react';

// ---- Icons — 24×24 outline/filled pairs, matching the Compose icon set ----
// Outline is the resting state, filled the selected one (Icons.Outlined.* /
// Icons.Rounded.* in MainTabs.kt).
export const MIcon = {
  homeOutline: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.6 10.4 12 3.9l8.4 6.5V19a1.6 1.6 0 0 1-1.6 1.6h-3.5v-4.9a3.3 3.3 0 0 0-6.6 0v4.9H5.2A1.6 1.6 0 0 1 3.6 19z" />
    </svg>
  ),
  home: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.05 4.05a1.45 1.45 0 0 1 1.9 0l6.4 5.34c.32.27.5.66.5 1.08v8.05a1.7 1.7 0 0 1-1.7 1.7H15.5v-4.55a3.5 3.5 0 0 0-7 0v4.55H5.85a1.7 1.7 0 0 1-1.7-1.7v-8.03c0-.42.18-.81.5-1.08z" />
    </svg>
  ),
  chatOutline: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.2 12.1c0 3.9-3.6 7-8.1 7a9.3 9.3 0 0 1-2.4-.3L4.6 20.3l1.3-3.5a6.6 6.6 0 0 1-2.1-4.7c0-3.9 3.6-7 8.1-7s8.3 3.1 8.3 7z" />
    </svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.1 4.1c4.5 0 8.1 3.1 8.1 7s-3.6 7-8.1 7a9.3 9.3 0 0 1-2.4-.3l-5.1 1.5 1.3-3.5a6.6 6.6 0 0 1-2.1-4.7c0-3.9 3.8-7 8.3-7z" />
    </svg>
  ),
  inboxOutline: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 13.4 5.9 5.6A2 2 0 0 1 7.8 4.1h8.4a2 2 0 0 1 1.9 1.5L20 13.4v4.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 13.4h4.1a.6.6 0 0 1 .6.4 3.4 3.4 0 0 0 6.6 0 .6.6 0 0 1 .6-.4H20" />
    </svg>
  ),
  inbox: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.9 5.6A2 2 0 0 1 7.8 4.1h8.4a2 2 0 0 1 1.9 1.5l1.9 7.8V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4.6zm.35 6.55h2.1a1.5 1.5 0 0 1 1.45 1.1 2.35 2.35 0 0 0 4.5 0 1.5 1.5 0 0 1 1.45-1.1h2.1L16.1 6.4H7.9z" />
    </svg>
  ),
  discoverOutline: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.4" />
      <path d="m14.8 9.2-1.7 3.9-3.9 1.7 1.7-3.9z" />
    </svg>
  ),
  discover: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path fillRule="evenodd" d="M12 2.8a9.2 9.2 0 1 0 0 18.4 9.2 9.2 0 0 0 0-18.4Zm3.62 5.58a.85.85 0 0 1 0 .84l-1.76 4.08a1 1 0 0 1-.52.52l-4.08 1.76a.85.85 0 0 1-1.12-1.12l1.76-4.08a1 1 0 0 1 .52-.52l4.08-1.76a.85.85 0 0 1 1.12.28Zm-3.08 3.08-1.2.52-.52 1.2 1.2-.52.52-1.2Z" clipRule="evenodd" />
    </svg>
  ),
  moreOutline: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
      <path d="M6 12h.01M12 12h.01M18 12h.01" />
    </svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="6" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="18" cy="12" r="1.8" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  ),
  compose: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.6 16.2 15.8 5a1.9 1.9 0 0 1 2.7 2.7L7.3 18.9H4.6z" />
      <path d="M13.4 7.4 16.6 10.6" />
    </svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8.2" r="3.4" />
      <path d="M5.2 19.4a6.8 6.8 0 0 1 13.6 0" />
    </svg>
  ),
  help: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.4" />
      <path d="M9.6 9.4a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1 1-1 1.8V14" />
      <path d="M12 17.2h.01" />
    </svg>
  ),
  sun: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3.4v1.8M12 18.8v1.8M3.4 12h1.8M18.8 12h1.8M6.1 6.1l1.3 1.3M16.6 16.6l1.3 1.3M17.9 6.1l-1.3 1.3M7.4 16.6l-1.3 1.3" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.8 13.6A6.6 6.6 0 0 1 10.4 7.2 6.6 6.6 0 1 0 16.8 13.6z" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="7.4" y="3.4" width="9.2" height="17.2" rx="2.2" />
      <path d="M11 17.6h2" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m14.5 5-7 7 7 7" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="m9.5 5 7 7-7 7" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  tick: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  ),
  flag: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.6 15s1-1 4-1 5 2 8 2 3.8-1 3.8-1V3.4s-1 1-3.8 1-5-2-8-2-4 1-4 1z" />
      <path d="M4.6 21.4V15" />
    </svg>
  ),
  star: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3.2 2.65 5.36 5.92.86-4.28 4.17 1.01 5.9L12 16.7l-5.3 2.79 1.01-5.9-4.28-4.17 5.92-.86z" />
    </svg>
  ),
  bookmark: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.2 4.7A1.7 1.7 0 0 1 7.9 3h8.2a1.7 1.7 0 0 1 1.7 1.7v16l-5.8-3.8-5.8 3.8z" />
    </svg>
  ),
  folder: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M3.6 7.2A2.2 2.2 0 0 1 5.8 5h3.3l1.7 2h7.4a2.2 2.2 0 0 1 2.2 2.2v7.6a2.2 2.2 0 0 1-2.2 2.2H5.8a2.2 2.2 0 0 1-2.2-2.2z" />
    </svg>
  ),
  list: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 7h11M8.5 12h11M8.5 17h11M4.4 7h.01M4.4 12h.01M4.4 17h.01" />
    </svg>
  ),
  space: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="3.6" y="3.6" width="7.4" height="7.4" rx="2.2" />
      <rect x="13" y="3.6" width="7.4" height="7.4" rx="2.2" />
      <rect x="3.6" y="13" width="7.4" height="7.4" rx="2.2" />
      <rect x="13" y="13" width="7.4" height="7.4" rx="2.2" />
    </svg>
  ),
  design: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20.5a8.5 8.5 0 1 1 8.5-8.5c0 2-1.6 3-3.2 3h-1.6a1.9 1.9 0 0 0-1.3 3.3 1.6 1.6 0 0 1-1.2 2.2z" />
      <circle cx="8" cy="11" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="11" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ),
  tasks: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="4.2" />
      <path d="m8.4 12.1 2.5 2.5 4.7-5.2" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.8" y="5.4" width="16.4" height="14.8" rx="3.2" />
      <path d="M3.8 10h16.4M8.4 3.6v3.4M15.6 3.6v3.4" />
    </svg>
  ),
  docs: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.4 3.8h6.2l4.8 4.8v11.6H7.4z" />
      <path d="M13.4 3.9v4.6h4.6M10 13.4h5M10 16.4h3.4" />
    </svg>
  ),
  apps: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="6.4" cy="6.4" r="2.3" />
      <circle cx="12" cy="6.4" r="2.3" />
      <circle cx="17.6" cy="6.4" r="2.3" />
      <circle cx="6.4" cy="12" r="2.3" />
      <circle cx="12" cy="12" r="2.3" />
      <circle cx="17.6" cy="12" r="2.3" />
      <circle cx="6.4" cy="17.6" r="2.3" />
      <circle cx="12" cy="17.6" r="2.3" />
      <circle cx="17.6" cy="17.6" r="2.3" />
    </svg>
  ),
  resources: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.2 5.6A1.6 1.6 0 0 1 5.8 4h3.6A2.6 2.6 0 0 1 12 6.6V19a2.2 2.2 0 0 0-2.2-2H4.2z" />
      <path d="M19.8 5.6A1.6 1.6 0 0 0 18.2 4h-3.6A2.6 2.6 0 0 0 12 6.6V19a2.2 2.2 0 0 1 2.2-2h5.6z" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4V12l3 1.8" />
    </svg>
  ),
  meeting: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.8" y="6.4" width="12.4" height="11.2" rx="2.8" />
      <path d="m15.2 10.6 4.2-2.6a.7.7 0 0 1 1.1.6v6.8a.7.7 0 0 1-1.1.6l-4.2-2.6z" />
    </svg>
  ),
  clips: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="3.2" />
      <path d="M10.2 9.6 14.6 12l-4.4 2.4z" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 14.4a1.6 1.6 0 0 0 .32 1.77l.06.06a1.95 1.95 0 1 1-2.76 2.76l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47v.17a1.95 1.95 0 1 1-3.9 0v-.09a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a1.95 1.95 0 1 1-2.76-2.76l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.97h-.17a1.95 1.95 0 1 1 0-3.9h.09a1.6 1.6 0 0 0 1.47-1.05 1.6 1.6 0 0 0-.32-1.77l-.06-.06a1.95 1.95 0 1 1 2.76-2.76l.06.06a1.6 1.6 0 0 0 1.77.32h.08a1.6 1.6 0 0 0 .97-1.47v-.17a1.95 1.95 0 1 1 3.9 0v.09a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a1.95 1.95 0 1 1 2.76 2.76l-.06.06a1.6 1.6 0 0 0-.32 1.77v.08a1.6 1.6 0 0 0 1.47.97h.17a1.95 1.95 0 1 1 0 3.9h-.09a1.6 1.6 0 0 0-1.47.97z" />
    </svg>
  ),
  bell: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8.6a6 6 0 1 0-12 0c0 6.4-2.4 8.2-2.4 8.2h16.8S18 15 18 8.6" />
      <path d="M13.7 20.4a2 2 0 0 1-3.4 0" />
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15.5 8.4V5.9a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v12.2a2 2 0 0 0 2 2h6.5a2 2 0 0 0 2-2v-2.5" />
      <path d="M19.8 12H10m9.8 0-3-3m3 3-3 3" />
    </svg>
  ),
  checkin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4.4H6.6a2 2 0 0 0-2 2v11.2a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2V6.4a2 2 0 0 0-2-2H15" />
      <rect x="9" y="2.8" width="6" height="3.4" rx="1.2" />
      <path d="m9.4 13 1.9 1.9 3.4-3.9" />
    </svg>
  ),
  planner: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.2 5.6h15.6M4.2 12h15.6M4.2 18.4h15.6" />
      <rect x="6.4" y="3.4" width="5.4" height="4.4" rx="1.6" fill="currentColor" stroke="none" opacity="0.35" />
      <rect x="11" y="9.8" width="6.4" height="4.4" rx="1.6" fill="currentColor" stroke="none" opacity="0.35" />
    </svg>
  ),
  card: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5.4" width="18" height="13.2" rx="3" />
      <path d="M3 10h18M6.6 14.6h3.6" />
    </svg>
  ),
  wallet: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.4 8.2A2.6 2.6 0 0 1 6 5.6h11.4a2.6 2.6 0 0 1 2.6 2.6v8.4a2.6 2.6 0 0 1-2.6 2.6H6a2.6 2.6 0 0 1-2.6-2.6z" />
      <path d="M20 10.8h-3.4a1.7 1.7 0 0 0 0 3.4H20" />
    </svg>
  ),
  people: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9.4" cy="8.4" r="3.4" />
      <path d="M3.4 19.4a6 6 0 0 1 12 0M16.4 5.4a3.4 3.4 0 0 1 0 6.6M17.6 19.4a5.8 5.8 0 0 0-1.9-4.3" />
    </svg>
  ),
  support: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="3.1" />
      <path d="m5.9 5.9 3.7 3.7m4.8 4.8 3.7 3.7m0-12.2-3.7 3.7m-4.8 4.8-3.7 3.7" />
    </svg>
  ),
} as const;

// ---- Deterministic avatar / card tints ----
// Same intent as AvatarFills + spaceTint(): stable color per name, no state.
const TINTS = [
  '#4F6BED', '#2E9E7E', '#C2557A', '#7A5AF8', '#C77C2E',
  '#1F8FA8', '#B4553C', '#5E7A2E', '#8A5CC4', '#2F7DBF',
];

export function tintFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function initialsOf(name: string | null | undefined): string {
  const s = (name || '').trim();
  if (!s) return '?';
  return s.charAt(0).toUpperCase();
}

/** Squircle avatar with an optional presence dot (SquadAvatar). */
export function MAvatar({
  name,
  size = 36,
  url,
  presence,
}: {
  name: string | null | undefined;
  size?: number;
  url?: string | null;
  /** `undefined` hides the dot entirely; `true`/`false` shows online/away. */
  presence?: boolean;
}) {
  const base = tintFor(name || '?');
  return (
    <span
      className="msh-avatar"
      data-presence={presence === undefined ? undefined : presence ? 'true' : 'away'}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        ['--fill' as string]: `linear-gradient(180deg, color-mix(in srgb, ${base} 88%, #fff), color-mix(in srgb, ${base} 84%, #000))`,
      }}
    >
      {url ? <img src={url} alt="" /> : initialsOf(name)}
    </span>
  );
}

/** Uppercase group heading with a count (ClientHeader). */
export function MGroupHead({ title, count }: { title: string; count?: number }) {
  return (
    <div className="msh-group-head">
      <b>{title}</b>
      {count != null && <span>{count}</span>}
    </div>
  );
}

/** One tappable card in a Home group (SpaceCard). */
export function MCard({
  title,
  subtitle,
  icon,
  seed,
  onOpen,
  onAdd,
  index = 0,
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  seed?: string;
  onOpen: () => void;
  onAdd?: () => void;
  index?: number;
}) {
  const tint = tintFor(seed ?? title);
  return (
    <div
      className="msh-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      // Stagger the rise-in so a group of cards cascades rather than popping.
      style={{ animationDelay: `${Math.min(index, 8) * 28}ms`, ['--tint' as string]: tint }}
    >
      <span className="msh-card-ic">{icon}</span>
      <span className="msh-card-body">
        <b>{title}</b>
        {subtitle && <span>{subtitle}</span>}
      </span>
      {onAdd && (
        <button
          type="button"
          className="msh-card-add"
          aria-label={`New task in ${title}`}
          onClick={(e) => { e.stopPropagation(); onAdd(); }}
        >
          {MIcon.plus}
        </button>
      )}
      <span className="msh-card-chev">{MIcon.chevron}</span>
    </div>
  );
}

/** One tappable list row (conversations, menu items). */
export function MRow({
  icon,
  title,
  subtitle,
  badge,
  unread,
  danger,
  trailing,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  badge?: number;
  unread?: boolean;
  danger?: boolean;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`msh-row${danger ? ' msh-danger' : ''}`}
      data-unread={unread ? 'true' : undefined}
      onClick={onClick}
    >
      <span className="msh-row-ic">{icon}</span>
      <span className="msh-row-body">
        <b>{title}</b>
        {subtitle && <span>{subtitle}</span>}
      </span>
      {badge != null && badge > 0 && <span className="msh-badge">{badge > 99 ? '99+' : badge}</span>}
      {trailing ?? <span className="msh-row-chev">{MIcon.chevron}</span>}
    </button>
  );
}

export function MLoading() {
  return (
    <div style={{ paddingTop: 12 }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="msh-skel" style={{ animationDelay: `${i * 90}ms` }} />
      ))}
    </div>
  );
}

export function MEmpty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="msh-center">
      <b>{title}</b>
      {body && <p>{body}</p>}
    </div>
  );
}
