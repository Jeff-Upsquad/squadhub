'use client';

import { useState, ReactNode } from 'react';
import MobileChat from './MobileChat';
import TalentHomeView from './TalentHomeView';
import type { Channel, DmConversation } from '@squadhub/shared';

// ── Icons (copied from TalentBottomNav) ──────────────────────────────────
function HomeIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}
function GridIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  );
}
function SquadHubIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h4v6H4V6zM14 4h4a2 2 0 012 2v4h-6V4zM4 12h6v6H6a2 2 0 01-2-2v-4zM14 12h6v4a2 2 0 01-2 2h-4v-6z" />
    </svg>
  );
}

type TalentTab = 'home' | 'chatroom' | 'notifications' | 'more' | 'squadhub';

function TalentBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-1.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0a0a0a] px-1 text-[9px] font-bold text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

interface TalentBottomNavProps {
  active: TalentTab;
  onChange: (t: TalentTab) => void;
  unreadMessages?: number;
  unreadNotifications?: number;
  incompleteTraining?: number;
  hasAssignedCard?: boolean;
}

export function TalentBottomNav({ active, onChange, unreadMessages = 0, unreadNotifications = 0, incompleteTraining = 0, hasAssignedCard = false }: TalentBottomNavProps) {
  const items: Array<{ key: TalentTab; label: string; icon: ReactNode; badge?: number }> = [
    { key: 'home', label: 'Home', icon: <HomeIcon /> },
    { key: 'chatroom', label: 'Chatroom', icon: <ChatIcon />, badge: unreadMessages },
    { key: 'notifications', label: 'Notifications', icon: <BellIcon />, badge: unreadNotifications },
    { key: 'more', label: 'More', icon: <GridIcon />, badge: incompleteTraining },
  ];
  if (hasAssignedCard) items.push({ key: 'squadhub', label: 'SquadHub', icon: <SquadHubIcon /> });

  return (
    <>
      <div className="h-[64px] shrink-0" />
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <nav className="mx-auto flex max-w-lg items-center justify-around py-2">
          {items.map((item) => {
            const isActive = active === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onChange(item.key)}
                className={`flex flex-col items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ${isActive ? 'text-[#0a0a0a]' : 'text-zinc-500'}`}
              >
                <span className="relative">
                  {item.icon}
                  <TalentBadge count={item.badge ?? 0} />
                </span>
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>
    </>
  );
}

// ── TalentMore (ported from Profiles/frontend/src/views/talent/TalentMore.tsx) ──
const TALENT_WEB_BASE = 'https://squadhire.upsquadconnect.com';
const MORE_ROUTE: Record<string, string> = {
  'Basic Profile': '/talent/basic-profile',
  'Job Profiles': '/talent/profiles',
  'My Clients': '/talent/my-clients',
  Settings: '/talent/settings',
  'Training Program': '/talent/training',
  'Contact Support': '/talent/contact-support',
};

function TalentMoreView({ onSelect }: { onSelect?: (label: string) => void }) {
  const [detail, setDetail] = useState<string | null>(null);
  if (detail) {
    const route = MORE_ROUTE[detail] ? `${TALENT_WEB_BASE}${MORE_ROUTE[detail]}?in_app=1` : null;
    return (
      <div className="flex min-h-full flex-col bg-[#F5F5F6]">
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-white px-3 py-2 shadow-sm">
          <button type="button" onClick={() => setDetail(null)} className="inline-flex items-center gap-1.5 rounded-full bg-[#F5F5F6] px-3 py-1.5 text-sm font-medium text-[#0a0a0a]">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            Back
          </button>
          <span className="text-sm font-semibold text-[#0a0a0a]">{detail}</span>
          <a href={route ?? '#'} target="_blank" rel="noreferrer" className="ml-auto text-xs font-medium text-[#525252] hover:text-[#0a0a0a]">Open</a>
        </div>
        {route ? (
          <iframe src={route} title={detail} className="h-[calc(100dvh-220px)] w-full flex-1 border-0 bg-white" loading="lazy" />
        ) : (
          <div className="p-4"><div className="rounded-2xl border border-[#E7E7EA] bg-white p-6 text-center text-sm text-[#737373]">Not available</div></div>
        )}
      </div>
    );
  }
  const handle = (label: string) => {
    setDetail(label);
    if (onSelect) onSelect(label);
  };
  return (
    <div className="space-y-6 bg-[#F5F5F6] p-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[#0a0a0a]">More</h1>
        <p className="mt-1 text-sm text-[#737373]">Profile, training, and account</p>
      </div>
      {[
        { title: 'Profile', items: [
          { label: 'Basic Profile', desc: 'Your personal details and job preferences' },
          { label: 'Job Profiles', desc: 'Role-specific profiles businesses discover' },
          { label: 'My Clients', desc: 'Businesses you are working with' },
        ]},
        { title: 'Account', items: [
          { label: 'Settings', desc: 'Login details and account preferences' },
          { label: 'Training Program', desc: 'Courses, SOPs, and assigned lessons' },
          { label: 'Contact Support', desc: 'Chat with the UpSquad team' },
        ]},
      ].map((group) => (
        <section key={group.title} className="overflow-hidden rounded-2xl border border-[#E7E7EA] bg-white">
          <div className="border-b border-[#E7E7EA] px-5 py-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[#a3a3a3]">{group.title}</h2>
          </div>
          <ul className="divide-y divide-[#E7E7EA]">
            {group.items.map((it) => (
              <li key={it.label}>
                <button type="button" onClick={() => handle(it.label)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[#F5F5F6] active:bg-[#EFEFEF]">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5F5F6] text-[#525252]">
                    <GridIcon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-[#0a0a0a]">{it.label}</span>
                    <span className="mt-0.5 block truncate text-xs text-[#737373]">{it.desc}</span>
                  </span>
                  <svg className="h-4 w-4 shrink-0 text-[#a3a3a3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TalentChatView({ channels, dms, meId, supportChannelId, supportUnread, onOpenChannel }: { channels: Channel[]; dms: DmConversation[]; meId?: string; supportChannelId: string | null; supportUnread: number; onOpenChannel: (id: string, kind: 'channel' | 'dm', title: string) => void }) {
  const hasChats = (channels.length + dms.length) > 0;
  if (!hasChats) {
    return (
      <div className="flex min-h-full flex-col bg-white">
        <div className="border-b border-[#E7E7EA] px-4 py-3">
          <h1 className="text-[18px] font-semibold tracking-[-0.36px] text-[#0a0a0a]">Chatroom</h1>
        </div>
        <div className="h-px bg-[#E7E7EA]" />
        <div className="flex flex-1 flex-col items-center justify-center px-8 py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F5F5F6]"><svg className="h-7 w-7 text-[#a3a3a3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg></div>
          <p className="mt-4 text-[15px] font-semibold text-[#0a0a0a]">No chatrooms yet</p>
          <p className="mt-1 max-w-[28ch] text-sm leading-relaxed text-[#737373]">A business will open one after they shortlist you. An UpSquad teammate is always in the room.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-full flex-col bg-white">
      <div className="border-b border-[#E7E7EA] px-4 py-3">
        <h1 className="text-[18px] font-semibold tracking-[-0.36px] text-[#0a0a0a]">Chatroom</h1>
      </div>
      <div className="h-px bg-[#E7E7EA]" />
      <div className="flex-1">
        <MobileChat
          channels={channels}
          dms={dms}
          meId={meId}
          supportChannelId={supportChannelId}
          supportUnread={supportUnread}
          query=""
          onOpenChannel={(id, t) => onOpenChannel(id, 'channel', t)}
          onOpenDm={(id, t) => onOpenChannel(id, 'dm', t)}
        />
      </div>
    </div>
  );
}

function TalentNotificationsView() {
  return (
    <div className="space-y-4 bg-[#F5F5F6] min-h-full p-3">
      <section className="relative overflow-hidden rounded-2xl border border-[#E7E7EA] bg-white px-5 py-6">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(600px 200px at 70% 100%, rgba(255,250,194,0.7), transparent 60%)' }} />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-[#0a0a0a] bg-white px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] shadow-sm">
            <span className="h-2.5 w-2.5 rounded-full bg-[#FFFAC2] border border-[#E7E7EA]" />
            All caught up
          </span>
          <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.02em] text-[#0a0a0a]"> <span className="bg-[#FFFAC2] px-1">Notifications</span>.</h1>
          <p className="mt-1 text-sm text-[#737373]">Announcements and profile updates from UpSquad.</p>
        </div>
      </section>

      <div className="flex items-center gap-1 rounded-2xl border border-[#E7E7EA] bg-white p-1.5">
        <button className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0a0a0a] px-3 py-2 text-sm font-semibold text-white">Unread <span className="text-[#a3a3a3]">0</span></button>
        <button className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-[#525252]">All <span className="text-[#a3a3a3]">21</span></button>
        <button className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-[#525252]">Read <span className="text-[#a3a3a3]">21</span></button>
      </div>

      <div className="rounded-2xl border border-[#E7E7EA] bg-white p-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#FFFAC2]/60"><svg className="h-6 w-6 text-[#0a0a0a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg></div>
        <p className="mt-4 text-[16px] font-semibold text-[#0a0a0a]">No unread notifications</p>
        <p className="mt-1 text-sm text-[#737373]">You&apos;re all caught up.</p>
      </div>
    </div>
  );
}

interface TalentShellProps {
  channels: Channel[];
  dms: DmConversation[];
  meId?: string;
  supportChannelId: string | null;
  supportUnread: number;
  onOpenChannel: (id: string, kind: 'channel' | 'dm', title: string) => void;
}

export default function TalentShell({ channels, dms, meId, supportChannelId, supportUnread, onOpenChannel }: TalentShellProps) {
  const [tab, setTab] = useState<TalentTab>('home');

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-[#F5F5F6]">
      <div className="flex-1 overflow-y-auto min-h-0">
        {tab === 'home' && <TalentHomeView />}
        {tab === 'chatroom' && (
          <TalentChatView
            channels={channels}
            dms={dms}
            meId={meId}
            supportChannelId={supportChannelId}
            supportUnread={supportUnread}
            onOpenChannel={onOpenChannel}
          />
        )}
        {tab === 'notifications' && <TalentNotificationsView />}
        {tab === 'more' && <TalentMoreView onSelect={(label) => { /* keep in More for now; toast */ if (typeof window !== 'undefined') console.log('[talent more]', label); }} />}
        {tab === 'squadhub' && (
          <div className="bg-[#F5F5F6] p-6 text-center">
            <p className="text-sm text-[#737373]">SquadHub gateway — switch back to Work to continue.</p>
          </div>
        )}
      </div>
      <TalentBottomNav active={tab} onChange={setTab} />
    </div>
  );
}
