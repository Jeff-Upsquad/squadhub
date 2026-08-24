import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import { getSocket } from '../../../services/socket';
import MessageComposer from '../chat/MessageComposer';
import ImageLightbox from '../chat/ImageLightbox';
import type { Notification, ChatJump } from '../InboxView';

function initials(name?: string | null) {
  if (!name) return '?';
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function colorFor(seed: string) {
  const hue = Array.from(seed).reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return `oklch(0.6 0.13 ${hue})`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

type MessageRow = {
  id: string;
  channel_id: string | null;
  dm_conversation_id: string | null;
  parent_message_id: string | null;
  content: string | null;
  type: string;
  file_url: string | null;
  created_at: string;
  sender: { id: string; display_name: string; avatar_url: string | null } | null;
};

type ThreadResponse = { root: MessageRow | null; replies: MessageRow[] };

// Same click-to-view behaviour as chat: the inline preview opens the shared
// full-screen ImageLightbox (Esc / backdrop / × to close).
function ImageAttachment({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Click to view"
        style={{ display: 'block', maxWidth: 480, marginTop: 6, padding: 0, border: 'none', background: 'none', cursor: 'zoom-in' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          style={{ maxHeight: 360, width: 'auto', maxWidth: '100%', borderRadius: 8, border: '1px solid var(--sh-hair)', objectFit: 'contain', display: 'block' }}
        />
      </button>
      {open && <ImageLightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

function MessageRowView({ m, dim }: { m: MessageRow; dim?: boolean }) {
  const name = m.sender?.display_name || 'Unknown';
  return (
    <div className="th-msg" style={{ opacity: dim ? 0.75 : 1 }}>
      <div
        className="ava"
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: colorFor(m.sender?.id || name),
          fontSize: 11,
        }}
      >
        {initials(name)}
      </div>
      <div className="th-msg-body">
        <div className="th-msg-hd">
          <b>{name}</b>
          <span>{formatTime(m.created_at)}</span>
        </div>
        {m.content && (
          <div className="th-msg-text">{m.content}</div>
        )}
        {m.file_url && m.type === 'image' && (
          <ImageAttachment src={m.file_url} alt="attachment" />
        )}
        {m.file_url && m.type === 'audio' && (
          <audio controls src={m.file_url} style={{ marginTop: 6 }} />
        )}
      </div>
    </div>
  );
}

export default function InboxMessageDetail({
  messageId,
  onOpen,
}: {
  messageId: string;
  onOpen: (jump?: ChatJump) => void;
}) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<ThreadResponse>({
    queryKey: ['message-thread', messageId],
    queryFn: async () => {
      const res = await api.get(`/messages/${messageId}/thread`);
      return res.data.data;
    },
  });

  const rootId = data?.root?.id ?? null;
  const convId = data?.root?.channel_id || data?.root?.dm_conversation_id || null;

  // Live replies while the detail pane is open — same wiring as ThreadPanel,
  // scoped to this thread's cache key. The inbox detail renders standalone
  // (no ChatPanel mounted to join rooms for it), so it joins the conversation
  // room itself once the fetch resolves the channel/DM id.
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !convId) return;
    socket.emit('join_channel', convId);

    const handleReply = (message?: { id?: string; parent_message_id?: string | null }) => {
      if (message?.id && message.parent_message_id === rootId) {
        queryClient.setQueryData<ThreadResponse>(['message-thread', messageId], (old) => {
          if (!old) return old;
          if (old.replies?.some((m) => m.id === message.id)) return old;
          return { ...old, replies: [...(old.replies || []), message as MessageRow] };
        });
      }
      // Reconcile in the background regardless — covers edits/deletes/reactions.
      queryClient.invalidateQueries({ queryKey: ['message-thread', messageId] });
    };
    const handleMutated = () =>
      queryClient.invalidateQueries({ queryKey: ['message-thread', messageId] });

    socket.on('new_message', handleReply);
    socket.on('thread_reply', handleReply);
    socket.on('new_reaction', handleMutated);
    socket.on('message_updated', handleMutated);
    socket.on('message_deleted', handleMutated);
    return () => {
      socket.emit('leave_channel', convId);
      socket.off('new_message', handleReply);
      socket.off('thread_reply', handleReply);
      socket.off('new_reaction', handleMutated);
      socket.off('message_updated', handleMutated);
      socket.off('message_deleted', handleMutated);
    };
  }, [convId, rootId, messageId, queryClient]);

  // After the chat composer posts a reply: refresh the thread and treat the
  // conversation as read — replying is deliberate, so its unread inbox rows
  // should clear instead of leaving the bell badge nagging. Optimistically
  // drop the matching rows, persist via read-conversation, then refresh the
  // badge (mirrors the old inline send path + ChatPanel's behaviour).
  const handleSent = () => {
    queryClient.invalidateQueries({ queryKey: ['message-thread', messageId] });

    const root = data?.root;
    const sentConvId = root?.dm_conversation_id || root?.channel_id || null;
    const body = root?.dm_conversation_id
      ? { dm_conversation_id: root.dm_conversation_id }
      : root?.channel_id
        ? { channel_id: root.channel_id }
        : null;

    if (sentConvId) {
      queryClient.setQueryData<Notification[]>(['notifications', 'list'], (old) =>
        (old || []).map((n) =>
          !n.is_read &&
          (n.metadata?.dm_conversation_id === sentConvId || n.metadata?.channel_id === sentConvId)
            ? { ...n, is_read: true }
            : n,
        ),
      );
    }

    const refreshBadge = () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] });
    };

    if (body) {
      api
        .post('/notifications/read-conversation', body)
        .catch(() => {
          /* non-critical — the inbox can still be cleared manually */
        })
        .finally(refreshBadge);
    } else {
      refreshBadge();
    }
  };

  if (isLoading) {
    return <div className="th-pane"><div className="th-scroll" style={{ fontSize: 13, color: 'var(--sh-ink-3)' }}>Loading message…</div></div>;
  }
  if (!data?.root || !convId) {
    return <div className="th-pane"><div className="th-scroll" style={{ fontSize: 13, color: 'var(--sh-ink-3)' }}>Message not found.</div></div>;
  }

  const { root, replies } = data;
  const isThreadReply = root.id !== messageId;
  const focusedMessage = isThreadReply ? replies.find((r) => r.id === messageId) || root : root;
  const rootName = root.sender?.display_name || 'Unknown';

  // Where "Open in chat" should land: a reply (or a root that has a thread)
  // opens its thread panel; a standalone message is highlighted in place.
  const openInChat = () => {
    if (root.id !== focusedMessage.id) {
      onOpen({ messageId: focusedMessage.id, parentId: root.id });
    } else if (replies.length > 0) {
      onOpen({ messageId: root.id, parentId: root.id });
    } else {
      onOpen({ messageId: root.id, parentId: null });
    }
  };

  return (
    <div className="th-pane">
      <div className="th-head">
        <span className="th-glyph" aria-hidden>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-9 8.36 8.5 8.5 0 0 1-3.4-.7L3 20l.84-5.6A8.38 8.38 0 0 1 12 3.14a8.38 8.38 0 0 1 9 8.36z" />
          </svg>
        </span>
        <div className="th-head-txt">
          <h1>Thread</h1>
          <div className="th-sub">
            {focusedMessage.sender?.display_name || rootName} · {formatTime(focusedMessage.created_at)}
          </div>
        </div>
        <button type="button" className="top-btn ghost-border" onClick={openInChat}>
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
          Open in chat
        </button>
      </div>

      <div className="th-scroll">
        <MessageRowView m={root} />
        {replies.length > 0 && (
          <>
            <div className="th-replies-hd">
              <span>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
            </div>
            {replies.map((r) => (
              <MessageRowView key={r.id} m={r} dim={r.id !== messageId} />
            ))}
          </>
        )}
      </div>

      {/* Same composer as normal chat (rich text, attachments, emoji, voice,
          mentions) — posts into this thread via parentMessageId. */}
      <div className="th-compose th-compose--chat">
        <MessageComposer
          channelId={convId}
          kind={root.channel_id ? 'channel' : 'dm'}
          parentMessageId={root.id}
          placeholder="Reply…"
          onSend={handleSent}
        />
      </div>
    </div>
  );
}
