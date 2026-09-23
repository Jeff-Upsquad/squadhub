'use client';

/**
 * Desktop/tablet view for a partner who hasn't got their first project yet.
 *
 * A talent can now sign in to SquadHub straight after signing up on SquadHire,
 * before any work exists for them. Everything the desktop chrome is made of —
 * the icon rail, the module sidebar, the tab strip — is Work, and Work is what
 * they don't have yet, so it's replaced by this page rather than shown empty:
 * a plain explanation of what unlocks when, with the Discover feed (the same
 * one the phone shell renders) right underneath so they can go and get it.
 */

import type { Channel, DmConversation, User } from '@squadhub/shared';
import TalentShell from '../../../mobile/TalentShell';

interface PartnerWorkLockedPageProps {
  user: User | null;
  channels: Channel[];
  dms: DmConversation[];
  supportChannelId: string | null;
  supportUnread: number;
  onLogout: () => void;
}

export default function PartnerWorkLockedPage({
  user,
  channels,
  dms,
  supportChannelId,
  supportUnread,
  onLogout,
}: PartnerWorkLockedPageProps) {
  const firstName = user?.display_name?.split(' ')[0] || 'there';

  return (
    <div className="flex h-screen flex-col bg-[#F5F5F6]">
      <header className="flex flex-none items-center gap-3 border-b border-[#E7E7EA] bg-white px-5 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0A0A0A] text-[13px] font-extrabold text-white">
          S
        </div>
        <div className="min-w-0">
          <div className="text-[14px] font-extrabold leading-none tracking-[-0.01em] text-[#0A0A0A]">SquadHub</div>
          <div className="text-[11px] leading-none text-[#A1A1AA]">powered by UpSquad</div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-[13px] text-[#52525B] sm:block">{user?.email}</span>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-lg border border-[#E4E4E7] px-3 py-1.5 text-[12.5px] font-semibold text-[#3F3F46] hover:bg-[#F4F4F5]"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[560px] px-4 py-6">
          <div className="rounded-2xl border border-[#E7E7EA] bg-white p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-[#F4F4F5] text-[#52525B]">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16 11V8a4 4 0 10-8 0v3m-1 0h10a2 2 0 012 2v6a2 2 0 01-2 2H7a2 2 0 01-2-2v-6a2 2 0 012-2z"
                  />
                </svg>
              </div>
              <div className="min-w-0">
                <h1 className="text-[18px] font-extrabold tracking-[-0.01em] text-[#0A0A0A]">
                  Welcome, {firstName} — your work space is locked
                </h1>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#71717A]">
                  Tasks, chats and project updates open up the moment a client assigns you. Until
                  then, everything you need is in Discover below: browse opportunities matched to
                  your profile and accept the ones you want.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-[#E7E7EA] bg-white">
            {/* The phone Discover surface, unchanged — one implementation of the
                feed, so this page can't drift behind the app. Conversations
                aren't openable here: a pre-work partner has none. */}
            <TalentShell
              channels={channels}
              dms={dms}
              meId={user?.id}
              supportChannelId={supportChannelId}
              supportUnread={supportUnread}
              onOpenChannel={() => undefined}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
