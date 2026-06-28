import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChatSidePanelStore } from '../../../stores/chatSidePanelStore';
import ChatPanel from './ChatPanel';

/**
 * Wide right-docked slide-over hosting the standard ChatPanel for a container's
 * linked channel. Mounted once, globally, in MainLayout. Wider than the task
 * detail panel (which is min(760px, 95vw)) — close to half the screen.
 */
export default function ChatSidePanel() {
  const { isOpen, channelId, containerLabel, close } = useChatSidePanelStore();
  const [shown, setShown] = useState(false);

  // Slide in after first paint whenever the panel opens.
  useEffect(() => {
    if (!isOpen) {
      setShown(false);
      return;
    }
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  // Close on Escape while open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  if (!isOpen || !channelId) return null;

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
            <div className="truncate text-sm font-semibold text-foreground">Chat</div>
            <div className="truncate text-[11px] text-foreground-dim">{containerLabel}</div>
          </div>
          <button
            onClick={close}
            aria-label="Close chat"
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
