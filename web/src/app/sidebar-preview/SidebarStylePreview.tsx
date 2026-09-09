'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Icon, { type IconName } from '../design-preview/PreviewIcon';
import './sidebar-preview.css';

type Variant = 'rail-black' | 'sidebar-black';

/* ── Live-site rail glyphs, copied verbatim from web/src/layouts/MainLayout.tsx
   (solid fill language, 18px) so the preview bar uses the exact live icons. */
const LIVE = {
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
  invite: (
    <svg className="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="10" cy="8" r="3.2" />
      <path d="M4.5 19.5a5.5 5.5 0 0 1 11 0Z" />
      <path d="M18.5 9v6M15.5 12h6" fill="none" stroke="var(--ic-cut)" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  ),
} as const;

type RailItem = {
  label: string;
  icon: ReactNode;
  badge?: number;
};

type SidebarItem = {
  label: string;
  icon: IconName;
  meta?: string;
  accent?: 'mint' | 'amber';
  locked?: boolean;
};

const railItems: RailItem[] = [
  { label: 'Home', icon: LIVE.home, badge: 1 },
  { label: 'Inbox', icon: LIVE.inbox },
  { label: 'Tasks', icon: LIVE.tasks },
  { label: 'Docs', icon: LIVE.docs },
  { label: 'Cal', icon: LIVE.cal },
  { label: 'Apps', icon: LIVE.apps },
  { label: 'Res', icon: LIVE.learning },
  { label: 'Time', icon: LIVE.timesheet },
  { label: 'More', icon: LIVE.more },
];

const utilityItems: SidebarItem[] = [
  { label: 'Inbox', icon: 'inbox', meta: '1' },
  { label: 'Replies', icon: 'repeat' },
  { label: 'Assigned Comments', icon: 'chat' },
  { label: 'Skills', icon: 'spark' },
  { label: 'Meetings', icon: 'people' },
  { label: 'All Channels', icon: 'hash' },
  { label: 'All Spaces', icon: 'layers' },
  { label: 'More', icon: 'more' },
];

const favoriteItems: SidebarItem[] = [
  { label: 'My Dashboard – Jeff', icon: 'grid', accent: 'amber' },
  { label: 'Tasks – Squad Sub', icon: 'tasks', meta: '24', accent: 'amber' },
  { label: 'Sales & Marketing', icon: 'folder' },
  { label: 'Client Onboarding', icon: 'tasks', meta: '5', locked: true },
  { label: 'Partners Onboarding', icon: 'folder' },
  { label: 'Money tasks', icon: 'tasks' },
  { label: "S&P's", icon: 'folder' },
  { label: 'Onboarding – new clients', icon: 'hash', locked: true },
  { label: 'Sales Team', icon: 'folder', locked: true },
  { label: 'Leads Task – Content Squad', icon: 'circleCheck', meta: '15', accent: 'mint' },
  { label: 'EDB Business Lab', icon: 'folder' },
  { label: 'Tasks – in Sales Team', icon: 'tasks', locked: true, accent: 'amber' },
  { label: 'Send video ad to leads', icon: 'recording', accent: 'amber' },
  { label: 'Accountant', icon: 'document' },
  { label: 'Bill and Payments to clear', icon: 'tasks', locked: true },
  { label: 'Updated Working Model', icon: 'tasks', locked: true },
  { label: 'Websites', icon: 'folder' },
];

const variantLabels: Record<Variant, { eyebrow: string; title: string; description: string }> = {
  'rail-black': {
    eyebrow: 'Version 01',
    title: 'Black icon bar',
    description: 'A black utility rail paired with a warm, light-gray sidebar.',
  },
  'sidebar-black': {
    eyebrow: 'Version 02',
    title: 'Black sidebar',
    description: 'A deep teal icon bar paired with an onyx navigation sidebar.',
  },
};

function LockedMark() {
  return (
    <svg className="sbp-lock" viewBox="0 0 12 14" aria-label="Private">
      <path d="M3 6V4a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="1.5" y="5.5" width="9" height="7" rx="2" fill="currentColor" />
    </svg>
  );
}

function SidebarRow({ item, active, onClick }: { item: SidebarItem; active: boolean; onClick: () => void }) {
  return (
    <button className={`sbp-sidebar-row ${active ? 'is-active' : ''}`} onClick={onClick}>
      <span className={`sbp-row-icon ${item.accent ? `is-${item.accent}` : ''}`}>
        <Icon name={item.icon} size={17} />
      </span>
      <span className="sbp-row-label">{item.label}</span>
      {item.locked && <LockedMark />}
      {item.meta && <span className={`sbp-row-meta ${item.label === 'Inbox' ? 'is-badge' : ''}`}>{item.meta}</span>}
      {active && <span className="sbp-row-actions" aria-hidden="true">•••&nbsp;&nbsp;+</span>}
    </button>
  );
}

function DemoCanvas({ variant }: { variant: Variant }) {
  const content = variantLabels[variant];
  return (
    <main className="sbp-canvas">
      <header className="sbp-canvas-header">
        <div>
          <span>{content.eyebrow}</span>
          <strong>{content.title}</strong>
        </div>
        <button className="sbp-share-button"><Icon name="people" size={15} /> Share</button>
      </header>

      <section className="sbp-canvas-body">
        <div className="sbp-canvas-copy">
          <span className="sbp-kicker">Navigation concept</span>
          <h1>Compact where you navigate.<br />Quiet where you work.</h1>
          <p>{content.description} The workspace remains calm and neutral, so the navigation is easy to scan without competing with the work.</p>
        </div>

        <div className="sbp-demo-panel" aria-label="Example workspace content">
          <div className="sbp-demo-panel-head">
            <div><span>List</span><strong>Leads Task – Content Squad</strong></div>
            <button><Icon name="more" size={18} /></button>
          </div>
          <div className="sbp-filter-row">
            <button><Icon name="filter" size={14} /> Filter</button>
            <button><Icon name="people" size={14} /> Assignee</button>
            <button><Icon name="plus" size={14} /> Add task</button>
          </div>
          {['Confirm September campaign brief', 'Prepare social content calendar', 'Review landing page copy', 'Schedule weekly performance report'].map((task, index) => (
            <div className="sbp-task-row" key={task}>
              <span className={`sbp-task-check ${index === 0 ? 'is-done' : ''}`}><Icon name="check" size={11} /></span>
              <span>{task}</span>
              <small>{index < 2 ? 'Today' : index === 2 ? 'Tomorrow' : 'Sep 14'}</small>
              <span className={`sbp-assignee sbp-assignee-${index}`}>{['JZ', 'AM', 'SK', 'JZ'][index]}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export default function SidebarStylePreview() {
  const [variant, setVariant] = useState<Variant>('rail-black');
  const [activeRail, setActiveRail] = useState('Home');
  const [activeSidebar, setActiveSidebar] = useState('Money tasks');
  const [favoritesOpen, setFavoritesOpen] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get('version');
    if (selected === 'sidebar-black' || selected === 'rail-black') setVariant(selected);
  }, []);

  const selectVariant = (next: Variant) => {
    setVariant(next);
    const url = new URL(window.location.href);
    url.searchParams.set('version', next);
    window.history.replaceState({}, '', url);
  };

  const visibleFavorites = favoriteItems.filter(item => item.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className={`sbp-shell sbp-${variant}`}>
      <nav className="sbp-rail" aria-label="Primary navigation">
        <div className="sbp-rail-scroll">
          {railItems.map(item => (
            <button
              key={item.label}
              className={`sbp-rail-item ${activeRail === item.label ? 'is-active' : ''}`}
              onClick={() => setActiveRail(item.label)}
              aria-current={activeRail === item.label ? 'page' : undefined}
            >
              <span className="sbp-rail-icon">
                {item.icon}
                {item.badge && <span className="sbp-rail-badge">{item.badge}</span>}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <button className="sbp-invite"><span>{LIVE.invite}</span>Invite</button>
      </nav>

      <aside className="sbp-sidebar" aria-label="Home sidebar">
        <header className="sbp-sidebar-header">
          <h2>Home</h2>
          <div className="sbp-sidebar-tools">
            <button aria-label="Search" onClick={() => document.querySelector<HTMLInputElement>('.sbp-search-input')?.focus()}><Icon name="search" size={18} /></button>
            <button aria-label="Filter"><Icon name="filter" size={18} /></button>
            <button aria-label="Collapse"><Icon name="chevron" size={17} style={{ transform: 'rotate(180deg)' }} /></button>
            <button className="sbp-add-button" aria-label="Create"><Icon name="plus" size={18} /></button>
          </div>
        </header>

        <label className={`sbp-search ${query ? 'is-visible' : ''}`}>
          <Icon name="search" size={15} />
          <input className="sbp-search-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter sidebar..." />
          {query && <button aria-label="Clear filter" onClick={() => setQuery('')}><Icon name="close" size={13} /></button>}
        </label>

        <div className="sbp-sidebar-scroll">
          {!query && (
            <div className="sbp-sidebar-group sbp-utilities">
              {utilityItems.map(item => <SidebarRow key={item.label} item={item} active={activeSidebar === item.label} onClick={() => setActiveSidebar(item.label)} />)}
            </div>
          )}

          <div className="sbp-divider" />
          <button className="sbp-section-heading" onClick={() => setFavoritesOpen(open => !open)} aria-expanded={favoritesOpen}>
            <Icon name="down" size={12} className={favoritesOpen ? '' : 'is-collapsed'} />
            <span>Favorites</span>
            <Icon name="plus" size={14} />
          </button>

          {favoritesOpen && (
            <div className="sbp-sidebar-group">
              {visibleFavorites.map(item => <SidebarRow key={item.label} item={item} active={activeSidebar === item.label} onClick={() => setActiveSidebar(item.label)} />)}
              {visibleFavorites.length === 0 && <p className="sbp-no-results">No matching sidebar items</p>}
            </div>
          )}
        </div>
      </aside>

      <DemoCanvas variant={variant} />

      <div className="sbp-variant-switcher" role="group" aria-label="Choose a color version">
        <span className="sbp-switcher-label">Compare styles</span>
        <button className={variant === 'rail-black' ? 'is-selected' : ''} onClick={() => selectVariant('rail-black')}>
          <i className="sbp-palette sbp-palette-one"><span /></i>
          <span><small>Version 01</small>Black icon bar</span>
          {variant === 'rail-black' && <Icon name="check" size={15} />}
        </button>
        <button className={variant === 'sidebar-black' ? 'is-selected' : ''} onClick={() => selectVariant('sidebar-black')}>
          <i className="sbp-palette sbp-palette-two"><span /></i>
          <span><small>Version 02</small>Black sidebar</span>
          {variant === 'sidebar-black' && <Icon name="check" size={15} />}
        </button>
      </div>
    </div>
  );
}
