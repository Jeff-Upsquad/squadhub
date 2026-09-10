'use client';

import { useEffect, useState } from 'react';
import './original.css';

type Variant = 'original' | 'frost' | 'noir';

function getInitial(): Variant {
  if (typeof window === 'undefined') return 'original';
  const v = new URLSearchParams(window.location.search).get('v');
  return v === 'frost' || v === 'noir' ? v : 'original';
}

/* ── Exact rail glyphs copied from MainLayout ICON ── */
const RAIL_ICON: Record<string, React.ReactNode> = {
  home: (
    <svg className="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M11.05 4.05a1.45 1.45 0 0 1 1.9 0l6.4 5.34c.32.27.5.66.5 1.08v8.05A1.7 1.7 0 0 1 18.15 20.2H15.5v-4.55a3.5 3.5 0 0 0-7 0v4.55H5.85A1.7 1.7 0 0 1 4.15 18.5v-8.03c0-.42.18-.81.5-1.08z" />
    </svg>
  ),
  inbox: (
    <svg className="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M5.8 4.4h12.4a2 2 0 0 1 2 2v11.2a2 2 0 0 1-2 2H5.8a2 2 0 0 1-2-2V6.4a2 2 0 0 1 2-2z" />
      <path d="M4.6 7.4l6.6 4.7a1.4 1.4 0 0 0 1.6 0l6.6-4.7" fill="none" stroke="var(--ic-cut)" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  tasks: (
    <svg className="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M8.4 3.8h7.2a4.6 4.6 0 0 1 4.6 4.6v7.2a4.6 4.6 0 0 1-4.6 4.6H8.4a4.6 4.6 0 0 1-4.6-4.6V8.4a4.6 4.6 0 0 1 4.6-4.6z" />
      <path d="m8.4 12.1 2.5 2.5 4.7-5.2" fill="none" stroke="var(--ic-cut)" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  docs: (
    <svg className="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M7.4 4.2h5.74a1 1 0 0 1 .71.3l4.06 4.06a1 1 0 0 1 .29.7v9.34A2.2 2.2 0 0 1 16 20.8H7.4A2.2 2.2 0 0 1 5.2 18.6V6.4A2.2 2.2 0 0 1 7.4 4.2z" />
      <path d="M13.3 4.5v3.2a1.4 1.4 0 0 0 1.4 1.4h3.2" fill="none" stroke="var(--ic-cut)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.7 13.4h6.6M8.7 16.4h4.4" fill="none" stroke="var(--ic-cut)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  cal: (
    <svg className="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="4" y="5.4" width="16" height="14.6" rx="3" />
      <path d="M8.5 3.3v3.2M15.5 3.3v3.2" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
      <path d="M4.4 9.7h15.2" fill="none" stroke="var(--ic-cut)" strokeWidth={1.6} strokeLinecap="round" />
      <g fill="var(--ic-cut)">
        <circle cx="8.7" cy="13.7" r="1" /><circle cx="12" cy="13.7" r="1" /><circle cx="15.3" cy="13.7" r="1" />
        <circle cx="8.7" cy="16.8" r="1" /><circle cx="12" cy="16.8" r="1" />
      </g>
    </svg>
  ),
  apps: (
    <svg className="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="6" cy="6" r="1.7" /><circle cx="12" cy="6" r="1.7" /><circle cx="18" cy="6" r="1.7" />
      <circle cx="6" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18" cy="12" r="1.7" />
      <circle cx="6" cy="18" r="1.7" /><circle cx="12" cy="18" r="1.7" /><circle cx="18" cy="18" r="1.7" />
    </svg>
  ),
  learning: (
    <svg className="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M12 5.4 2.5 9.3 12 13.2l9.5-3.9z" />
      <path d="M6.9 11.7v2.9c0 1.2 2.28 2.2 5.1 2.2s5.1-1 5.1-2.2v-2.9" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21.5 9.6v3.7" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      <circle cx="21.5" cy="14" r="1.05" />
    </svg>
  ),
  timesheet: (
    <svg className="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M8 5 16 5 12 11.2 16 19 8 19 12 11.2Z" />
      <path d="M6.6 3.9h10.8M6.6 20.1h10.8" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
    </svg>
  ),
  more: (
    <svg className="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="5.5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="18.5" cy="12" r="1.5" />
    </svg>
  ),
};

function RailBtn({ icon, label, active }: { icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <button title={label} data-active={active || undefined} className="sh-rail-item">
      <span className="sh-rail-ic">{icon}</span>
      <span className="sh-rail-lb">{label}</span>
    </button>
  );
}

/* ── Sidebar NavItem + SectionHeader copied verbatim from HomeSidebar ── */
function NavItem({ icon, label, active, count }: { icon: React.ReactNode; label: string; active?: boolean; count?: number }) {
  return (
    <button
      className={`flex w-full items-center gap-[9px] rounded-[6px] px-2 py-[5px] text-left text-[13px] transition ${
        active
          ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
          : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
      }`}
      style={active ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
    >
      <span className={active ? 'text-[var(--sh-ink)]' : 'text-[var(--sh-ink-3)]'}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count != null && count > 0 && (
        <span className="relative grid place-items-center">
          <span
            className="relative text-[10.5px] font-semibold rounded-full px-[6px] py-[1px] leading-none text-white"
            style={{ fontFamily: 'var(--font-mono, Inter, sans-serif)', background: '#E8622C' }}
          >
            {count}
          </span>
        </span>
      )}
    </button>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="group flex items-center justify-between px-2 pt-3 pb-1">
      <div className="flex items-center gap-1">
        <span className="flex items-center justify-center h-4 w-4 text-[var(--sh-ink-4)]">
          <svg className="h-3 w-3" viewBox="0 0 18 18" fill="currentColor">
            <path d="M5 7h8L9 11z" />
          </svg>
        </span>
        <span className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-[var(--sh-ink-4)] whitespace-nowrap">
          {title}
        </span>
      </div>
    </div>
  );
}

function SbIcon({ d }: { d: React.ReactNode }) {
  return (
    <svg className="h-[14px] w-[14px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      {d}
    </svg>
  );
}

const FAVORITES = [
  'Sales Team Tasks', 'untangle', 'Sales Hiring | upsquad', 'Recording Tasks',
  'Squadbooks', 'Sales Workflow + Training', 'SquadPayroll', 'Recruiter training',
  'Designer Editor space', 'Tutorial creation SH',
];

const FOCUS = [
  { t: 'Payroll calculation - employees', tag: 'Tasks', who: 'J' },
  { t: 'Accountant subscription make it live', tag: 'My Tasks', who: 'J', sub: '1/5' },
  { t: 'Designers Squadbook', tag: 'My Tasks', who: 'J' },
  { t: 'Video Editors Squadbook', tag: 'My Tasks', who: 'J' },
  { t: 'Customers Squadbooks', tag: 'My Tasks', who: 'J' },
  { t: 'Create a master course with multiple chapters and lessons.', tag: 'SquadHire', who: '' },
  { t: 'Move BigRev books to squad books.', tag: 'Accounts Work - clients', who: 'J' },
  { t: 'Move DVAR books to Squad Books.', tag: 'Accounts Work - clients', who: 'J' },
];

const STAT_ICO = {
  width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, viewBox: '0 0 24 24',
};

function GoArrow() {
  return (
    <svg className="go" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17 17 7M7 7h10v10" />
    </svg>
  );
}

export default function OriginalPreview() {
  const [variant, setVariant] = useState<Variant>('original');
  useEffect(() => { setVariant(getInitial()); }, []);

  const pick = (v: Variant) => {
    setVariant(v);
    const url = new URL(window.location.href);
    if (v === 'original') url.searchParams.delete('v');
    else url.searchParams.set('v', v);
    window.history.replaceState(null, '', url.toString());
  };

  return (
    <div className="op-root" data-variant={variant === 'original' ? undefined : variant}>
      <div className="op-switcher" role="radiogroup" aria-label="Background variant">
        <span>Canvas</span>
        {(['original', 'frost', 'noir'] as const).map(v => (
          <button key={v} role="radio" aria-checked={variant === v} data-active={variant === v} onClick={() => pick(v)}>
            {v === 'original' ? 'Original #FBFBF9' : v === 'frost' ? 'Frost ❄ glass' : 'Noir ◑ blackish'}
          </button>
        ))}
      </div>

      <div className="op-shell">
        {/* Far-left rail — exact MainLayout classes */}
        <div
          className="sh-rail-bar flex w-[60px] shrink-0 flex-col items-center gap-0.5 bg-[#080909] px-[4px] pt-[10px] pb-3 relative z-[3] my-2 ml-2 mr-[2px]"
          style={{ boxShadow: 'var(--sh-rail-inset)' }}
        >
          <div className="flex w-full flex-col items-center gap-[2px]">
            <RailBtn icon={RAIL_ICON.home} label="Home" active />
            <RailBtn icon={RAIL_ICON.inbox} label="Inbox" />
            <RailBtn icon={RAIL_ICON.tasks} label="Tasks" />
            <RailBtn icon={RAIL_ICON.docs} label="Docs" />
            <RailBtn icon={RAIL_ICON.cal} label="Cal" />
            <RailBtn icon={RAIL_ICON.apps} label="Apps" />
            <RailBtn icon={RAIL_ICON.learning} label="Res" />
            <button title="Time" data-active={undefined} className="sh-rail-item">
              <span className="sh-rail-ic">{RAIL_ICON.timesheet}</span>
              <span className="sh-rail-lb">Time</span>
            </button>
          </div>
          <div className="h-px w-7 bg-white/10 my-2" />
          <div className="flex w-full flex-col items-center gap-[2px]">
            <RailBtn icon={RAIL_ICON.more} label="More" />
          </div>
          <div className="flex-1" />
          <div className="flex w-full flex-col items-center gap-[2px]">
            <RailBtn
              icon={
                <svg className="h-[16px] w-[16px]" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-6 0a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              }
              label="Support"
            />
            <RailBtn
              icon={
                <svg className="h-[16px] w-[16px]" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              }
              label="Theme"
            />
            <div className="sh-rail-util">
              <button
                className="grid h-8 w-8 place-items-center rounded-full bg-[var(--sh-ink)] text-[var(--sidebar)] text-[11px] font-semibold relative cursor-pointer"
                style={{ border: '2px solid var(--icon-bar)' }}
                title="Jeff"
              >
                J
                <span className="absolute -right-[2px] -bottom-[2px] h-[10px] w-[10px] rounded-full bg-[var(--icon-bar)]" style={{ border: '2px solid var(--sh-ink)' }} />
              </button>
              <span className="sh-rail-lb">Jeff</span>
            </div>
          </div>
        </div>

        {/* Module sidebar — exact MainLayout + HomeSidebar classes */}
        <div
          className="sh-mod-side flex shrink-0 flex-col overflow-hidden relative z-[2] my-2 rounded-[12px]"
          style={{ boxShadow: 'var(--sh-sidebar-drop)', width: 240 }}
        >
          <div className="group/sidebar flex h-full w-full flex-col text-[var(--sh-ink-2)]">
            <div className="flex items-center justify-between border-b border-[var(--sh-hair)] px-4 py-3">
              <div className="flex items-center gap-2">
                <span
                  className="grid h-[22px] w-[22px] place-items-center rounded-[6px] bg-[var(--sh-ink)] text-[var(--sidebar)]"
                  style={{ fontFamily: 'var(--font-serif, Plus Jakarta Sans, sans-serif)', fontSize: 10, fontWeight: 700, letterSpacing: '-0.02em' }}
                >
                  SH
                </span>
                <div className="flex flex-col leading-tight">
                  <span className="text-[13.5px] font-semibold text-[var(--sh-ink)]">SquadHub</span>
                  <span className="text-[10.5px] text-[var(--sh-ink-3)]">Powered by UpSquad</span>
                </div>
              </div>
            </div>
            <div className="px-3 pt-2 pb-2 border-b border-[var(--sh-hair)]">
              <div className="flex items-center overflow-hidden w-[30px]">
                <span
                  className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px] text-[var(--sh-ink-3)]"
                  title="Search (⌘K)"
                >
                  <svg className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                </span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="px-2 pt-2 pb-1 flex flex-col gap-[1px]">
                <NavItem icon={<SbIcon d={<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" />} />} label="My home" active />
                <NavItem icon={<SbIcon d={<><path d="M3 13V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8" /><path d="M3 13h5l2 3h4l2-3h5v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>} />} label="Inbox" />
                <NavItem icon={<SbIcon d={<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>} />} label="Day Planner" />
                <NavItem icon={<SbIcon d={<><path d="M17 2.5 21 6.5 17 10.5" /><path d="M3 11.5v-5h5" /><path d="M7 21.5 3 17.5 7 13.5" /><path d="M21 12.5v5h-5" /></>} />} label="Routines" />
                <NavItem icon={<SbIcon d={<><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.2 2.4 2.4 4.8-5.2" /></>} />} label="My Tasks" />
              </div>
              <SectionHeader title="Apps" />
              <div className="px-2 pb-1 flex flex-col gap-[1px]">
                <NavItem icon={<SbIcon d={<><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.2 2.4 2.4 4.8-5.2" /></>} />} label="Daily Check-In" />
                <NavItem icon={<SbIcon d={<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>} />} label="Time Management" />
                <NavItem icon={<SbIcon d={<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>} />} label="Meetings" />
                <NavItem icon={<SbIcon d={<><rect x="2" y="6" width="13" height="12" rx="2" /><path d="m15 10 7-3.5v11L15 14" /></>} />} label="Squad Clips" />
                <NavItem icon={<SbIcon d={<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></>} />} label="Requirement Cards" count={34} />
                <NavItem icon={<SbIcon d={<><path d="M4 12a8 8 0 0 1 16 0" /><rect x="3" y="12" width="4" height="7" rx="1.5" /><rect x="17" y="12" width="4" height="7" rx="1.5" /></>} />} label="Support Tickets" />
                <NavItem icon={<SbIcon d={<><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M5.5 16.5c.8-1.8 2.5-2.5 3.5-2.5s2.7.7 3.5 2.5" /><path d="M15 9.5h4M15 12.5h4M15 15.5h2.5" /></>} />} label="Candidates" />
              </div>
              <SectionHeader title="Favorites" />
              <div className="px-2 pb-4 flex flex-col gap-[1px]">
                {FAVORITES.map(f => (
                  <NavItem
                    key={f}
                    icon={<SbIcon d={<><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /></>} />}
                    label={f}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Main content area — exact MainLayout + TabBar classes */}
        <div className="op-main relative flex flex-1 flex-col overflow-hidden bg-surface pt-12 md:pt-0">
          <div className="op-tabbar hidden h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--sh-hair)] bg-[var(--sidebar)] px-2 md:flex">
            <div className="group relative flex h-[28px] min-w-[92px] max-w-[190px] shrink-0 cursor-default items-center gap-1.5 rounded-[7px] pl-2.5 pr-1.5 text-[12.5px] transition border border-[var(--sh-hair)] bg-[var(--surface)] font-medium text-[var(--sh-ink)]">
              <span className="text-[var(--sh-ink)]">
                <svg className="h-[13px] w-[13px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" />
                </svg>
              </span>
              <span className="flex-1 truncate">Home</span>
            </div>
            <div className="group relative flex h-[28px] min-w-[92px] max-w-[190px] shrink-0 cursor-default items-center gap-1.5 rounded-[7px] pl-2.5 pr-1.5 text-[12.5px] transition border border-transparent text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]">
              <span className="text-[var(--sh-ink-4)]">
                <svg className="h-[13px] w-[13px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                </svg>
              </span>
              <span className="flex-1 truncate">Dev Tasks</span>
            </div>
          </div>

          <div className="sh-view hm-home h-full overflow-y-auto">
            <div className="hm-wrap">
              <div className="hm-hero">
                <div className="hm-hero-row">
                  <div className="hm-hero-lede">
                    <div className="hm-eyebrow-row">
                      <span className="hm-eyebrow">Thursday, Sep 10 · Week 37 · Q3</span>
                    </div>
                    <h1 className="hm-greet">Good afternoon, Jeff<span className="dot">.</span></h1>
                    <p className="hm-sub">Keep the promise you made to yourself.</p>
                  </div>
                  <div className="hm-hero-aside">
                    <div className="hm-timer" data-state="idle">
                      <div className="hm-timer-meter">
                        <span className="worked">0m<em>worked</em></span>
                        <span className="hm-timer-bar"><span className="seg work" style={{ width: '0%' }} /></span>
                        <span className="hm-timer-readout">
                          <span className="commit">of 9h · 0%</span>
                          <span className="hm-timer-status" data-running="false"><span className="hm-timer-dot" />Not tracking</span>
                        </span>
                      </div>
                      <div className="hm-timer-ctrls">
                        <span className="hm-timer-btn" data-type="work">▸ Work</span>
                        <span className="hm-timer-btn" data-type="break">▸ Break</span>
                        <span className="hm-timer-btn" data-type="no_work">▸ No work</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="hm-stats">
                <div className="hm-stat" role="button" tabIndex={0}>
                  <div className="lbl">
                    <svg {...STAT_ICO}><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="m9 14 2 2 4-4" /></svg>
                    New Tasks
                    <span className="ping" />
                  </div>
                  <div className="val">9<span className="unit">to review</span></div>
                  <div className="sub">When a user is marked as susp…</div>
                  <GoArrow />
                </div>
                <div className="hm-stat" role="button" tabIndex={0}>
                  <div className="lbl">
                    <svg {...STAT_ICO}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
                    Today
                  </div>
                  <div className="val">0<span className="unit">items</span></div>
                  <div className="sub">Nothing on your plate</div>
                  <GoArrow />
                </div>
                <div className="hm-stat" data-alert={true} role="button" tabIndex={0}>
                  <div className="lbl">
                    <svg {...STAT_ICO}><circle cx="12" cy="13" r="8" /><path d="M12 9.5v4l2.5 2" /><path d="M5 3 3 5M19 3l2 2" /></svg>
                    Overdue
                  </div>
                  <div className="val">1</div>
                  <div className="sub">[Demo] Client kickoff</div>
                  <GoArrow />
                </div>
                <div className="hm-stat" role="button" tabIndex={0}>
                  <div className="lbl">
                    <svg {...STAT_ICO}><path d="M17 18a5 5 0 0 0-10 0" /><path d="M12 9V3M4.9 10.9l1.4 1.4M2 18h2M20 18h2M17.7 12.3l1.4-1.4" /><path d="M4 22h16" /></svg>
                    Tomorrow
                  </div>
                  <div className="val">0<span className="unit">items</span></div>
                  <div className="sub">Wide open</div>
                  <GoArrow />
                </div>
                <div className="hm-stat" role="button" tabIndex={0}>
                  <div className="lbl">
                    <svg {...STAT_ICO}><path d="M4 6h16M4 12h16M4 18h10" /></svg>
                    All tasks
                  </div>
                  <div className="val">125<span className="unit">items</span></div>
                  <div className="sub">[Demo] Client kickoff</div>
                  <GoArrow />
                </div>
              </div>

              <div className="hm-stats-secondary">
                <div className="hm-stat" data-alert={true} role="button" tabIndex={0}>
                  <div className="lbl">
                    <svg {...STAT_ICO}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
                    Urgent ·
                  </div>
                  <div className="val">41</div>
                  <GoArrow />
                </div>
                <div className="hm-stat" role="button" tabIndex={0}>
                  <div className="lbl">
                    <svg {...STAT_ICO}><path d="m22 8-6 4 6 4V8Z" /><rect x="2" y="6" width="14" height="12" rx="2" /></svg>
                    Recordings ·
                  </div>
                  <div className="val">1</div>
                  <GoArrow />
                </div>
              </div>

              <div className="hm-card">
                <div className="hm-card-head">
                  <h3>Focus list</h3>
                  <span className="hm-count">· 30</span>
                  <span className="hm-head-actions">
                    <span className="hm-pill">Group: <span className="dim">Space</span> ▾</span>
                  </span>
                </div>
                <div className="hm-group">
                  <div className="hm-group-head">Client Spaces<span className="count">· 1</span></div>
                  <div className="hm-task" role="button" tabIndex={0}>
                    <div className="checkbox" data-done={false} role="button" aria-label="Mark complete" />
                    <div className="t">
                      <span className="title">Payroll calculation - employees</span>
                      <span className="hm-tag">Tasks</span>
                    </div>
                    <div className="hm-ava" style={{ background: '#5b7fc4' }} title="Jeff">J</div>
                  </div>
                </div>
                <div className="hm-group">
                  <div className="hm-group-head">Jeff&apos;s Space<span className="count">· 25</span></div>
                  {FOCUS.slice(1).map(r => (
                    <div key={r.t} className="hm-task" role="button" tabIndex={0}>
                      <div className="checkbox" data-done={false} role="button" aria-label="Mark complete" />
                      <div className="t">
                        <span className="title">{r.t}</span>
                        {r.sub && <span className="hm-sub-count">{r.sub}</span>}
                        <span className="hm-tag">{r.tag}</span>
                      </div>
                      {r.who
                        ? <div className="hm-ava" style={{ background: '#5b7fc4' }} title="Jeff">{r.who}</div>
                        : <div className="hm-ava" data-empty="true" title="Unassigned">–</div>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
