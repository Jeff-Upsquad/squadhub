import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTask, useTaskComments, useAddComment, useUpdateTask } from '../../../hooks/useTasks';
import api from '../../../services/api';
import ThreadComposer from './ThreadComposer';
import { linkifyText } from '../../../lib/linkify';
import type { Notification } from '../InboxView';

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
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export default function InboxTaskDetail({
  taskId,
  notificationId,
  onOpen,
}: {
  taskId: string;
  notificationId?: string;
  onOpen: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: task, isLoading } = useTask(taskId);
  const { data: comments } = useTaskComments(taskId);
  const addComment = useAddComment(taskId);
  const updateTask = useUpdateTask((task as any)?.list_id || null);

  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);

  // Commenting on a task notification is a deliberate action that counts as
  // reading it, so its unread state should clear instead of leaving the bell
  // badge nagging. Tasks have no read-conversation endpoint (unlike DMs), so
  // mark just this notification read. Mere preview must NOT mark read — the
  // inbox auto-selects the first unread item, so that would empty the list on
  // open; only this explicit comment triggers it.
  const markNotificationRead = () => {
    if (!notificationId) return;
    queryClient.setQueryData<Notification[]>(['notifications', 'list'], (old) =>
      (old || []).map((n) => (n.id === notificationId ? { ...n, is_read: true } : n)),
    );
    api
      .patch(`/notifications/${notificationId}/read`)
      .catch(() => {
        /* non-critical — the inbox can still be cleared manually */
      })
      .finally(() => {
        queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
        queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] });
      });
  };

  const handleSend = () => {
    if (!text.trim()) return;
    addComment.mutate(
      { content: text.trim(), mentions },
      { onSuccess: () => { setText(''); setMentions([]); markNotificationRead(); } },
    );
  };

  const handleMarkDone = () => {
    if (!task) return;
    updateTask.mutate({ id: task.id, status: 'done' } as any);
  };

  if (isLoading || !task) {
    return <div className="th-pane"><div className="th-scroll" style={{ fontSize: 13, color: 'var(--sh-ink-3)' }}>Loading task…</div></div>;
  }

  const t: any = task;
  const assignees: any[] = t.assignees || [];
  const status = t.status || 'todo';
  const isDone = ['done', 'closed', 'completed'].includes(String(status).toLowerCase());

  return (
    <div className="th-pane">
      <div className="th-head">
        <span className="th-glyph" aria-hidden>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="4" />
            <path d="m8.5 12.5 2.5 2.5 4.5-5" />
          </svg>
        </span>
        <div className="th-head-txt">
          <h1>{t.title}</h1>
          <div className="th-sub" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ textTransform: 'capitalize' }}>{status}</span>
            {t.due_date && <span>Due {new Date(t.due_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>}
            {t.priority && t.priority !== 'none' && <span style={{ textTransform: 'capitalize' }}>{t.priority}</span>}
          </div>
        </div>
        {!isDone && (
          <button
            type="button"
            className="top-btn ghost-border"
            onClick={handleMarkDone}
            disabled={updateTask.isPending}
            title="Mark task as done"
          >
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <path d="m8.5 12.5 2.5 2.5 4.5-5" />
            </svg>
            Mark done
          </button>
        )}
        <button type="button" className="top-btn ghost-border" onClick={onOpen}>
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
          Open
        </button>
      </div>

      <div className="th-scroll">
        {assignees.length > 0 && (
          <div className="th-assignees">
            <span>Assignees</span>
            <div className="th-assignee-stack">
              {assignees.map((a, i) => (
                <div
                  key={a.id || i}
                  title={a.display_name}
                  className="ava"
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: colorFor(a.id || a.display_name || String(i)),
                    fontSize: 8.5,
                    marginLeft: i === 0 ? 0 : -6,
                    border: '2px solid var(--surface)',
                  }}
                >
                  {initials(a.display_name)}
                </div>
              ))}
            </div>
          </div>
        )}

        {t.description && (
          <div className="th-msg" style={{ marginBottom: 18 }}>
            <div className="th-msg-body">
              <div className="th-msg-text">{linkifyText(t.description)}</div>
            </div>
          </div>
        )}

        <div className="th-replies-hd">
          <span>Comments {comments && comments.length > 0 ? `· ${comments.length}` : ''}</span>
        </div>

        {comments && comments.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {comments.map((c: any) => (
              <div key={c.id} className="th-msg">
                <div
                  className="ava"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: colorFor(c.user?.id || c.user?.email || ''),
                    fontSize: 11,
                  }}
                >
                  {initials(c.user?.display_name || c.user?.email)}
                </div>
                <div className="th-msg-body">
                  <div className="th-msg-hd">
                    <b>{c.user?.display_name || c.user?.email}</b>
                    <span>{formatTime(c.created_at)}</span>
                  </div>
                  <div className="th-msg-text">{c.content}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--sh-ink-3)', padding: '4px 0' }}>No comments yet.</div>
        )}
      </div>

      <div className="th-compose">
        <ThreadComposer
          value={text}
          mentions={mentions}
          onChange={(t2, m) => { setText(t2); setMentions(m); }}
          onSubmit={handleSend}
          pending={addComment.isPending}
          placeholder="Reply… use @ to mention"
        />
      </div>
    </div>
  );
}
