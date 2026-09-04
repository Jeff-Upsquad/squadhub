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
function TalentMoreView({ onSelect }: { onSelect?: (label: string) => void }) {
  const [detail, setDetail] = useState<string | null>(null);
  if (detail) {
    const isBasic = detail === 'Basic Profile';
    const isJob = detail === 'Job Profiles';
    const isClients = detail === 'My Clients';
    const isTraining = detail === 'Training Program';
    const isContact = detail === 'Contact Support';
    const isSettings = detail === 'Settings';
    return (
      <div className="min-h-full bg-[#F5F5F6] p-4">
        <button type="button" onClick={() => setDetail(null)} className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-medium text-[#0a0a0a] shadow">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          Back
        </button>
        <div className="rounded-2xl border border-[#E7E7EA] bg-white p-5">
          <h2 className="text-lg font-semibold text-[#0a0a0a]">{detail}</h2>
          {isBasic && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3"><input placeholder="First name" className="rounded-xl border border-[#E7E7EA] bg-white px-3 py-2.5 text-sm" defaultValue="First" /><input placeholder="Last name" className="rounded-xl border border-[#E7E7EA] bg-white px-3 py-2.5 text-sm" defaultValue="Name" /></div>
              <input placeholder="Phone" className="w-full rounded-xl border border-[#E7E7EA] bg-white px-3 py-2.5 text-sm" defaultValue="+91 90000 00000" />
              <input placeholder="Email" className="w-full rounded-xl border border-[#E7E7EA] bg-white px-3 py-2.5 text-sm" defaultValue="you@example.com" />
              <textarea placeholder="Current address" rows={2} className="w-full rounded-xl border border-[#E7E7EA] bg-white px-3 py-2.5 text-sm" defaultValue="Your official and current address as on Aadhaar" />
              <button type="button" className="w-full rounded-full bg-[#0a0a0a] py-2.5 text-sm font-semibold text-white">Save</button>
            </div>
          )}
          {isJob && (
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-dashed border-[#E7E7EA] p-6 text-center"><p className="text-sm font-medium text-[#0a0a0a]">No job profiles yet</p><p className="mt-1 text-xs text-[#737373]">Create a role-specific profile businesses will discover.</p><button type="button" className="mt-3 rounded-full bg-[#0a0a0a] px-4 py-2 text-xs font-semibold text-white">Add profile</button></div>
            </div>
          )}
          {isClients && (
            <div className="mt-4 rounded-xl bg-[#F5F5F6] p-6 text-center"><p className="text-sm font-medium text-[#0a0a0a]">No clients yet</p><p className="mt-1 text-xs text-[#737373]">Businesses you work with will appear here.</p></div>
          )}
          {isSettings && (
            <div className="mt-4 divide-y divide-[#F0F0F0] rounded-xl border border-[#E7E7EA] overflow-hidden">{['Notifications','Privacy','Language','Logout'].map((s) => <div key={s} className="flex items-center justify-between px-4 py-3 text-sm"><span className="font-medium text-[#0a0a0a]">{s}</span><svg className="h-4 w-4 text-[#a3a3a3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg></div>)}</div>
          )}
          {isTraining && (
            <div className="mt-4 space-y-2">{['Onboarding Course','SOP Basics','Client Handling'].map((c) => <div key={c} className="flex items-center gap-3 rounded-xl border border-[#E7E7EA] p-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#F5F5F6] text-[#0a0a0a]">▶</span><span className="text-sm font-medium text-[#0a0a0a]">{c}</span></div>)}</div>
          )}
          {isContact && (
            <div className="mt-4 text-center"><p className="text-sm text-[#737373]">Chat with the UpSquad team</p><button type="button" className="mt-3 w-full rounded-full bg-[#0a0a0a] py-2.5 text-sm font-semibold text-white">Open chat</button></div>
          )}
          {!isBasic && !isJob && !isClients && !isSettings && !isTraining && !isContact && <p className="mt-2 text-sm text-[#737373]">Details for {detail}.</p>}
        </div>
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
    <div className="bg-[#F5F5F6] min-h-full p-4">
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[#0a0a0a]">Notifications</h1>
      <p className="mt-1 text-sm text-[#737373]">Updates on your applications and messages</p>
      <div className="mt-6 rounded-2xl border border-[#E7E7EA] bg-white p-8 text-center">
        <p className="text-sm text-[#737373]">No new notifications</p>
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
