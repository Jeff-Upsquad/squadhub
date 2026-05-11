import { useState } from 'react';
import { useTask, useTaskComments, useAddComment, useUpdateTask } from '../../../hooks/useTasks';
import MentionPicker from '../../../components/MentionPicker';
import { linkifyText } from '../../../lib/linkify';

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
  onOpen,
}: {
  taskId: string;
  onOpen: () => void;
}) {
  const { data: task, isLoading } = useTask(taskId);
  const { data: comments } = useTaskComments(taskId);
  const addComment = useAddComment(taskId);
  const updateTask = useUpdateTask((task as any)?.list_id || null);

  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);

  const handleSend = () => {
    if (!text.trim()) return;
    addComment.mutate(
      { content: text.trim(), mentions },
      { onSuccess: () => { setText(''); setMentions([]); } },
    );
  };

  const handleMarkDone = () => {
    if (!task) return;
    updateTask.mutate({ id: task.id, status: 'done' } as any);
  };

  if (isLoading || !task) {
    return <div style={{ padding: 24, fontSize: 13, color: 'var(--sh-ink-3)' }}>Loading task…</div>;
  }

  const t: any = task;
  const assignees: any[] = t.assignees || [];
  const status = t.status || 'todo';
  const isDone = ['done', 'closed', 'completed'].includes(String(status).toLowerCase());

  return (
    <div className="flex h-full flex-col">
      <div className="detail-head">
        <div
          className="ava"
          style={{ width: 40, height: 40, borderRadius: 8, background: colorFor(t.id), fontWeight: 600, fontSize: 14 }}
        >
          {initials(t.title)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 20, lineHeight: 1.25 }}>{t.title}</h1>
          <div style={{ fontSize: 12, color: 'var(--sh-ink-3)', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span>
              Status ·{' '}
              <b style={{ color: 'var(--sh-ink)', textTransform: 'capitalize' }}>{status}</b>
            </span>
            {t.due_date && <span>Due · {new Date(t.due_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>}
            {t.priority && t.priority !== 'none' && (
              <span style={{ textTransform: 'capitalize' }}>Priority · {t.priority}</span>
            )}
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

      {assignees.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 24px 8px', fontSize: 12, color: 'var(--sh-ink-3)' }}>
          <span>Assignees</span>
          <div style={{ display: 'flex', gap: -4 }}>
            {assignees.map((a, i) => (
              <div
                key={a.id || i}
                title={a.display_name}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: colorFor(a.id || a.display_name || String(i)),
                  color: '#fff',
                  fontSize: 9,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginLeft: i === 0 ? 0 : -6,
                  border: '2px solid var(--surface, #fff)',
                }}
              >
                {initials(a.display_name)}
              </div>
            ))}
          </div>
        </div>
      )}

      {t.description && (
        <div style={{ padding: '0 24px 12px', fontSize: 13.5, lineHeight: 1.55, color: 'var(--sh-ink-2)', whiteSpace: 'pre-wrap' }}>
          {linkifyText(t.description)}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--sh-hair)', margin: '4px 24px 12px' }} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 12px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--sh-ink-3)', letterSpacing: 0.5, margin: '4px 0 12px' }}>
          Comments {comments && comments.length > 0 ? `· ${comments.length}` : ''}
        </div>
        {comments && comments.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {comments.map((c: any) => (
              <div key={c.id} style={{ display: 'flex', gap: 10 }}>
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: colorFor(c.user?.id || c.user?.email || ''),
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {initials(c.user?.display_name || c.user?.email)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <b style={{ fontSize: 13, color: 'var(--sh-ink)' }}>
                      {c.user?.display_name || c.user?.email}
                    </b>
                    <span style={{ fontSize: 11, color: 'var(--sh-ink-4)' }}>{formatTime(c.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--sh-ink-2)', marginTop: 2, whiteSpace: 'pre-wrap' }}>
                    {c.content}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--sh-ink-3)', padding: '4px 0' }}>No comments yet.</div>
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
            placeholder="Reply… use @ to mention"
            className="w-full bg-transparent text-[13px] text-[color:var(--sh-ink)] placeholder:text-[color:var(--sh-ink-3)] focus:outline-none resize-none"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!text.trim() || addComment.isPending}
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
