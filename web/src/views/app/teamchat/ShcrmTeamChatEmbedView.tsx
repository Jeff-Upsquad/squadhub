'use client';

import { useEffect, useState } from 'react';
import { useTeamChatEmbedStore } from '../../../stores/teamchatEmbedStore';
import { openExternalUrl } from '../../../lib/openExternal';
import { CRM_TEAMCHAT_META } from './CrmTeamChatView';

const SHCRM_URL =
  process.env.NEXT_PUBLIC_SHCRM_URL ||
  (process.env.NODE_ENV === 'production' ? 'https://shcrm.squadhub.in' : 'http://localhost:3101');

function shcrmOrigin(): string {
  try {
    return new URL(SHCRM_URL).origin;
  } catch {
    return SHCRM_URL;
  }
}

/**
 * SquadHireCRM TeamChat embedded via iframe. Unlike SquadCRM (which shares
 * SquadHub's database), SquadHire CRM owns its own Supabase project, so the
 * SquadHub session can't query its API — instead we embed its own TeamChat
 * module chromeless at /embed/team-chat. Auth comes from the SquadHire
 * session in this browser: log into SquadHire CRM once and the embed works.
 * Unread badges arrive via the `shcrm-teamchat:unread` postMessage bridge.
 */
export default function ShcrmTeamChatEmbedView() {
  const meta = CRM_TEAMCHAT_META.shcrm;
  const setShcrmUnread = useTeamChatEmbedStore((s) => s.setShcrmUnread);
  const [frameError, setFrameError] = useState(false);

  useEffect(() => {
    const origin = shcrmOrigin();
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin) return;
      if (e.data?.type === 'shcrm-teamchat:unread') {
        setShcrmUnread(Number(e.data.total) || 0);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [setShcrmUnread]);

  // Clear a stale badge when leaving; it repopulates on the next bridge post.
  useEffect(() => () => setShcrmUnread(0), [setShcrmUnread]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--sh-hair)] px-4 py-2">
        <span
          className="grid h-6 w-6 place-items-center rounded-[7px] text-white"
          style={{ background: meta.accent }}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.84L3 20l1.05-3.15A7.6 7.6 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-[var(--sh-ink)]">
            {meta.title}
          </span>
          <span className="block truncate text-[11px] text-[var(--sh-ink-4)]">
            Live from SquadHire CRM — uses your SquadHire login
          </span>
        </div>
        <button
          type="button"
          onClick={() => openExternalUrl(`${shcrmOrigin()}/app/chat`)}
          title="Open in SquadHire CRM"
          className="flex shrink-0 items-center gap-1 rounded-[6px] border border-[var(--sh-hair)] px-2 py-1 text-[11.5px] font-medium text-[var(--sh-ink-2)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
        >
          Open in SquadHire
          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M7 17L17 7M9 7h8v8" />
          </svg>
        </button>
      </div>
      <div className="relative min-h-0 flex-1 bg-[var(--surface)]">
        {frameError && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-[var(--surface)] px-6 text-center">
            <div>
              <div className="text-[14px] font-semibold text-[var(--sh-ink)]">
                Couldn&apos;t reach SquadHire CRM
              </div>
              <p className="mt-1.5 text-[12.5px] text-[var(--sh-ink-3)]">
                Start the SquadHire web app (port 3101) and reload.
              </p>
            </div>
          </div>
        )}
        <iframe
          title="SquadHireCRM TeamChat"
          src={`${shcrmOrigin()}/embed/team-chat`}
          className="h-full w-full border-0"
          allow="clipboard-write; microphone"
          onLoad={() => setFrameError(false)}
          onError={() => setFrameError(true)}
        />
      </div>
    </div>
  );
}
