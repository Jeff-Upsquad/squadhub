'use client';

import { useState, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isWorkLocked } from '@squadhub/shared';
import { useAuthStore } from '../stores/authStore';
import api from '../services/api';
import MobileChat from './MobileChat';
import TalentHomeView from './TalentHomeView';
import TalentNotificationsView, { TalentNotificationPrompts, useOpportunityNotifications } from './TalentNotifications';
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
      <circle cx="9" cy="9" r="2.2" />
      <circle cx="15.5" cy="9" r="2.2" />
      <circle cx="9" cy="15.5" r="2.2" />
      <circle cx="15.5" cy="15.5" r="2.2" />
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
    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0a0a0a] px-1 text-[9px] font-bold text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function TalentDot() {
  return (
    <span className="absolute -right-1 -top-0.5 flex h-2.5 w-2.5">
      <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500" />
    </span>
  );
}

interface TalentBottomNavProps {
  active: TalentTab;
  onChange: (t: TalentTab) => void;
  unreadMessages?: number;
  unreadNotifications?: number;
  /** Orange attention dot on More — mirrors the SquadHire talent app. */
  hasMoreAttention?: boolean;
  hasAssignedCard?: boolean;
}

export function TalentBottomNav({ active, onChange, unreadMessages = 0, unreadNotifications = 0, hasMoreAttention = false, hasAssignedCard = false }: TalentBottomNavProps) {
  const items: Array<{ key: TalentTab; label: string; icon: ReactNode; badge?: number; dot?: boolean }> = [
    { key: 'home', label: 'Home', icon: <HomeIcon /> },
    { key: 'chatroom', label: 'Chatroom', icon: <ChatIcon />, badge: unreadMessages },
    { key: 'notifications', label: 'Notifications', icon: <BellIcon />, badge: unreadNotifications },
    { key: 'more', label: 'More', icon: <GridIcon />, dot: hasMoreAttention },
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
                  {item.dot && !(item.badge && item.badge > 0) && <TalentDot />}
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

// ── TalentMore — SquadHire's real More page, embedded ───────────────────────
// The list (Basic Profile / Job Profiles / My Clients / Settings / Training /
// Contact Support) with its Pending pills lives in the SquadHire talent app
// (Profiles `TalentMore`). We iframe it so badges can never drift behind
// again, instead of maintaining a static copy here.
const TALENT_WEB_BASE = 'https://squadhire.upsquadconnect.com';
const TALENT_MORE_PATH = '/talent/more';

function useSquadhireAppToken() {
  return useQuery({
    queryKey: ['squadhire-app-token'],
    queryFn: async () => {
      const res = await api.get('/partner/talent/squadhire-token');
      return (res.data?.data?.token ?? null) as string | null;
    },
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

function TalentMoreView() {
  const tokenQuery = useSquadhireAppToken();
  const token = tokenQuery.data ?? null;
  const src = token
    ? `${TALENT_WEB_BASE}${TALENT_MORE_PATH}?in_app=1&app_token=${encodeURIComponent(token)}`
    : `${TALENT_WEB_BASE}${TALENT_MORE_PATH}?in_app=1`;
  const browserSrc = `${TALENT_WEB_BASE}${TALENT_MORE_PATH}`;

  if (tokenQuery.isLoading) {
    return (
      <div className="space-y-3 bg-[#F5F5F6] p-4">
        <div className="h-7 w-24 animate-pulse rounded-lg bg-[#E7E7EA]" />
        <div className="h-4 w-48 animate-pulse rounded bg-[#E7E7EA]" />
        <div className="h-64 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-[#F5F5F6]">
      {tokenQuery.isError && (
        <div className="mx-3 mt-3 flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs text-amber-800">Couldn&apos;t sign you into SquadHire — showing the public view.</p>
          <button type="button" onClick={() => tokenQuery.refetch()} className="shrink-0 rounded-full bg-[#0a0a0a] px-3 py-1 text-xs font-semibold text-white">Retry</button>
        </div>
      )}
      <iframe
        key={src}
        src={src}
        title="More — profile, training, and account"
        className="h-[calc(100dvh-220px)] w-full flex-1 border-0 bg-white"
        loading="lazy"
        allow="clipboard-write"
      />
      <div className="flex justify-center bg-[#F5F5F6] px-4 py-2">
        <a href={browserSrc} target="_blank" rel="noreferrer" className="text-xs font-medium text-[#525252] hover:text-[#0a0a0a]">
          Open in browser
        </a>
      </div>
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
  const user = useAuthStore((s) => s.user);
  const opportunityNotifications = useOpportunityNotifications();
  // SquadHire's bell counts everything awaiting the talent — pending matches
  // plus unanswered shortlists/selections — so the badge mirrors that, not
  // just untouched matches.
  const notificationBadge = (opportunityNotifications.data || []).filter((item) => item.status === 'pending').length;
  // The real Pending pills live inside the embedded SquadHire More page. The
  // nav dot is a fallback mirror: pre-assignment talents (Work locked) almost
  // always have profile work outstanding.
  const hasMoreAttention = isWorkLocked(user);

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-[#F5F5F6]">
      <TalentNotificationPrompts />
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
        {tab === 'more' && <TalentMoreView />}
        {tab === 'squadhub' && (
          <div className="bg-[#F5F5F6] p-6 text-center">
            <p className="text-sm text-[#737373]">SquadHub gateway — switch back to Work to continue.</p>
          </div>
        )}
      </div>
      <TalentBottomNav active={tab} onChange={setTab} unreadMessages={supportUnread} unreadNotifications={notificationBadge} hasMoreAttention={hasMoreAttention} />
    </div>
  );
}
