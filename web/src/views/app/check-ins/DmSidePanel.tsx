import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { useCreateDm } from '../../../hooks/useDms';
import ChatPanel from '../chat/ChatPanel';

export interface DmTarget {
  id: string;
  display_name: string;
  avatar_url?: string | null;
}

interface Props {
  user: DmTarget;
  onClose: () => void;
}

/**
 * Left-docked slide-over that opens (or finds) a DM with `user` and renders the
 * standard ChatPanel inside it. Mounted via portal so it overlays the whole
 * viewport; it does NOT touch the workspace's active channel, so the user's
 * main chat selection is preserved.
 */
export default function DmSidePanel({ user, onClose }: Props) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id ?? null);
  const create = useCreateDm(workspaceId);
  const [dmId, setDmId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(false);
  const startedRef = useRef(false);

  // Open/find the DM exactly once (the component is keyed by user.id upstream).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const conv = await create.mutateAsync([user.id]);
        if (conv?.id) setDmId(conv.id);
        else setFailed(true);
      } catch {
        setFailed(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger the slide-in after first paint.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-[60] bg-black/20 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div
        className={`fixed right-0 top-0 z-[61] flex h-full w-full max-w-[400px] flex-col border-l border-divider bg-surface shadow-2xl transition-transform duration-200 ${shown ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <header className="flex items-center gap-3 border-b border-divider px-4 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-alt text-xs font-bold text-foreground">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              user.display_name?.[0]?.toUpperCase() || '?'
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">{user.display_name}</div>
            <div className="text-[11px] text-foreground-dim">Direct message</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close chat"
            className="rounded p-1 text-foreground-muted transition hover:bg-surface-alt hover:text-foreground"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="flex min-h-0 flex-1">
          {dmId ? (
            <ChatPanel channelId={dmId} kind="dm" />
          ) : failed ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-foreground-dim">
              Couldn’t open this conversation. You can only message people you share a space or channel with.
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-foreground-dim">Opening chat…</div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
