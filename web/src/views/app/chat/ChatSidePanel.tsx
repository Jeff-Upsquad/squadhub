import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChatSidePanelStore } from '../../../stores/chatSidePanelStore';
import { useChannelMembers } from '../../../hooks/useChannelMembers';
import ChatPanel from './ChatPanel';

// Same gradient hash as MessageBubble / ChatPanel — stable color when no avatar.
function hashGradient(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 65% 45%))`;
}

/**
 * Wide right-docked slide-over hosting the standard ChatPanel for a container's
 * linked channel. Mounted once, globally, in MainLayout.
 */
export default function ChatSidePanel() {
  const { isOpen, channelId, containerLabel, close } = useChatSidePanelStore();
  const { data: members = [] } = useChannelMembers(isOpen ? channelId : null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!isOpen) {
      setShown(false);
      return;
    }
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [isOpen, channelId]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  if (!isOpen || !channelId) return null;

  const memberNames = members
    .map((m) => m.display_name || m.email || 'Unknown')
    .join(', ');

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-[88] bg-black/20 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
        onClick={close}
      />
      <div
        className={`fixed right-0 top-0 z-[89] flex h-full w-full flex-col border-l border-divider bg-surface shadow-2xl transition-transform duration-200 ${shown ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ maxWidth: 'min(48vw, 900px)' }}
      >
        <header className="flex items-center gap-3 border-b border-divider px-4 py-3">
          <svg className="h-4 w-4 shrink-0 text-foreground-muted" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.84L3 20l1.05-3.15A7.6 7.6 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">
              Chat
            </div>
            <div className="truncate text-[11px] text-foreground-dim">{containerLabel}</div>
          </div>

          {/* People in this chat — facepile + count */}
          {members.length > 0 && (
            <div
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--sh-hair)] px-2 py-1"
              title={memberNames}
            >
              <span className="flex">
                {members.slice(0, 4).map((m, i) => (
                  <span
                    key={m.id}
                    className="inline-flex h-[22px] w-[22px] items-center justify-center overflow-hidden rounded-[4px] border-2 border-surface text-[10px] font-extrabold text-white"
                    style={{
                      marginLeft: i === 0 ? 0 : -5,
                      background: m.avatar_url ? undefined : hashGradient(m.id),
                      zIndex: 4 - i,
                    }}
                  >
                    {m.avatar_url ? (
                      <img src={m.avatar_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      (m.display_name?.[0] || m.email?.[0] || '?').toUpperCase()
                    )}
                  </span>
                ))}
              </span>
              <span className="text-[12px] font-semibold tabular-nums text-foreground-muted">
                {members.length}
              </span>
            </div>
          )}

          <button
            onClick={close}
            aria-label="Close panel"
            className="rounded p-1 text-foreground-muted transition hover:bg-surface-alt hover:text-foreground"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="flex min-h-0 flex-1">
          <ChatPanel channelId={channelId} kind="channel" />
        </div>
      </div>
    </>,
    document.body,
  );
}
