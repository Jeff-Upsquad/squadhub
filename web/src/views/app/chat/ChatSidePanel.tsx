import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChatSidePanelStore } from '../../../stores/chatSidePanelStore';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { useCloseCrmChat, useReopenCrmChat } from '../../../hooks/useCrmChats';
import ChatPanel from './ChatPanel';

/**
 * Wide right-docked slide-over hosting the standard ChatPanel for a container's
 * linked channel or a CRM entity chat. Mounted once, globally, in MainLayout.
 */
export default function ChatSidePanel() {
  const { isOpen, channelId, containerLabel, isCrmChat, close } = useChatSidePanelStore();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id ?? null);
  const closeCrm = useCloseCrmChat(workspaceId);
  const reopenCrm = useReopenCrmChat(workspaceId);
  const [shown, setShown] = useState(false);
  const [crmClosed, setCrmClosed] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setShown(false);
      setCrmClosed(false);
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
              {isCrmChat ? 'CRM Chat' : 'Chat'}
            </div>
            <div className="truncate text-[11px] text-foreground-dim">{containerLabel}</div>
          </div>
          {isCrmChat && (
            <button
              type="button"
              onClick={async () => {
                if (crmClosed) {
                  await reopenCrm.mutateAsync(channelId);
                  setCrmClosed(false);
                } else {
                  await closeCrm.mutateAsync(channelId);
                  setCrmClosed(true);
                }
              }}
              className={`rounded-md border px-2.5 py-1 text-[12px] font-medium transition ${
                crmClosed
                  ? 'border-[rgba(0,122,90,0.25)] bg-[rgba(0,122,90,0.08)] text-[#007A5A]'
                  : 'border-[var(--sh-hair)] text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
              }`}
            >
              {crmClosed ? 'Closed' : 'Close chat'}
            </button>
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
        {isCrmChat && crmClosed && (
          <div className="flex items-center gap-2 border-b border-[rgba(0,122,90,0.15)] bg-[rgba(0,122,90,0.06)] px-4 py-2 text-[12px] text-[#007A5A]">
            This chat is closed. It stays hidden under CRM Chats until someone sends a new message.
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <ChatPanel channelId={channelId} kind="channel" />
        </div>
      </div>
    </>,
    document.body,
  );
}
