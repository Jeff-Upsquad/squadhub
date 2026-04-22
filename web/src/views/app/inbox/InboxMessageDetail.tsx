import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import api from '../../../services/api';
import MentionPicker from '../../../components/MentionPicker';

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

function MessageRowView({ m, dim }: { m: MessageRow; dim?: boolean }) {
  const name = m.sender?.display_name || 'Unknown';
  return (
    <div style={{ display: 'flex', gap: 10, opacity: dim ? 0.85 : 1 }}>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: '50%',
          background: colorFor(m.sender?.id || name),
          color: '#fff',
          fontSize: 10,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {initials(name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <b style={{ fontSize: 13, color: 'var(--sh-ink)' }}>{name}</b>
          <span style={{ fontSize: 11, color: 'var(--sh-ink-4)' }}>{formatTime(m.created_at)}</span>
        </div>
        {m.content && (
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--sh-ink-2)', marginTop: 2, whiteSpace: 'pre-wrap' }}>
            {m.content}
          </div>
        )}
        {m.file_url && m.type === 'image' && (
          <img src={m.file_url} alt="attachment" style={{ marginTop: 6, maxHeight: 240, borderRadius: 8 }} />
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
  onOpen: () => void;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);

  const { data, isLoading } = useQuery<ThreadResponse>({
    queryKey: ['message-thread', messageId],
    queryFn: async () => {
      const res = await api.get(`/messages/${messageId}/thread`);
      return res.data.data;
    },
  });

  const sendReply = useMutation({
    mutationFn: async () => {
      if (!data?.root) return null;
      const root = data.root;
      const res = await api.post('/messages', {
        channel_id: root.channel_id,
        dm_conversation_id: root.dm_conversation_id,
        parent_message_id: root.id,
        content: text.trim(),
        type: 'text',
        mentions,
      });
      return res.data.data;
    },
    onSuccess: () => {
      setText('');
      setMentions([]);
      queryClient.invalidateQueries({ queryKey: ['message-thread', messageId] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] });
    },
  });

  const handleSend = () => {
    if (!text.trim() || sendReply.isPending) return;
    sendReply.mutate();
  };

  if (isLoading) {
    return <div style={{ padding: 24, fontSize: 13, color: 'var(--sh-ink-3)' }}>Loading message…</div>;
  }
  if (!data?.root) {
    return <div style={{ padding: 24, fontSize: 13, color: 'var(--sh-ink-3)' }}>Message not found.</div>;
  }

  const { root, replies } = data;
  const isThreadReply = root.id !== messageId;
  const focusedMessage = isThreadReply ? replies.find((r) => r.id === messageId) || root : root;

  return (
    <div className="flex h-full flex-col">
      <div className="detail-head">
        <div
          className="ava"
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: colorFor(focusedMessage.sender?.id || focusedMessage.sender?.display_name || ''),
            fontWeight: 600,
            color: '#fff',
          }}
        >
          {initials(focusedMessage.sender?.display_name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 20, lineHeight: 1.25 }}>
            {isThreadReply ? 'Thread reply' : 'Message'}
          </h1>
          <div style={{ fontSize: 12, color: 'var(--sh-ink-3)', marginTop: 4 }}>
            From <b style={{ color: 'var(--sh-ink)' }}>{focusedMessage.sender?.display_name || 'Unknown'}</b>
            {' · '}
            {formatTime(focusedMessage.created_at)}
          </div>
        </div>
        <button type="button" className="top-btn ghost-border" onClick={onOpen}>
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
          Open in chat
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <MessageRowView m={root} />
        {replies.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--sh-ink-3)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
              <div style={{ flex: 1, height: 1, background: 'var(--sh-hair)' }} />
              <span>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
              <div style={{ flex: 1, height: 1, background: 'var(--sh-hair)' }} />
            </div>
            {replies.map((r) => (
              <MessageRowView key={r.id} m={r} dim={r.id !== messageId} />
            ))}
          </>
        )}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--sh-hair)',
          padding: '12px 24px 16px',
          background: 'var(--surface)',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-end',
            border: '1px solid var(--sh-hair)',
            borderRadius: 8,
            padding: '8px 12px',
            background: 'var(--surface-alt)',
          }}
        >
          <MentionPicker
            value={text}
            mentions={mentions}
            onChange={(t, m) => { setText(t); setMentions(m); }}
            onSubmit={handleSend}
            multiline
            rows={2}
            placeholder={`Reply in thread… use @ to mention`}
            className="w-full bg-transparent text-[13px] text-[color:var(--sh-ink)] placeholder:text-[color:var(--sh-ink-3)] focus:outline-none resize-none"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!text.trim() || sendReply.isPending}
            className="td-pill-btn"
            style={text.trim() ? { background: 'var(--sh-ink)', color: 'var(--surface)', borderColor: 'var(--sh-ink)' } : undefined}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
