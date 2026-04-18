import type { RequestRowData } from './atoms/RequestRow';
import Avatar from './atoms/Avatar';
import StatusPill from './atoms/StatusPill';
import PriorityDot from './atoms/PriorityDot';
import LiveTimer, { formatHours } from './atoms/LiveTimer';
import { coverFor, seedFromId, shortRequestId } from './atoms/CoverArt';
import { dueLabel } from './atoms/RequestRow';
import { IconClose, IconLink, IconArrowUpRight, IconPaperclip, IconDownload, IconMore } from './atoms/Icons';
import { useTaskComments } from '../../../../hooks/useTasks';
import { usePMStore } from '../../../../stores/pmStore';

export default function RequestDetailDrawer({
  request,
  onClose,
}: {
  request: RequestRowData;
  onClose: () => void;
}) {
  const { data: comments = [] } = useTaskComments(request.id);
  const timerState = usePMStore((s) => s.timer);
  const isTicking = timerState?.taskId === request.id;
  const assignee = request.assignees?.[0];
  const meta = (request.metadata as any) || {};

  const submittedLabel = request.created_at
    ? new Date(request.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '—';

  return (
    <div className="cd-root" style={{ position: 'fixed', inset: 0, zIndex: 90 }}>
      <div className="cd-drawer-backdrop" onClick={onClose} />
      <div className="cd-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="cd-drawer-head">
          <span className="id">{shortRequestId(request)}</span>
          <StatusPill status={request._derivedStatus} />
          <div className="spacer" />
          <button className="cd-topbar-btn" aria-label="Link">
            <IconLink size={13} />
          </button>
          <button className="cd-topbar-btn" aria-label="More">
            <IconMore size={13} />
          </button>
          <button className="cd-modal-close" onClick={onClose} aria-label="Close">
            <IconClose size={14} />
          </button>
        </div>

        {request._derivedStatus !== 'queued' && (
          <div
            style={{
              height: 150,
              backgroundImage: coverFor(seedFromId(request.id), meta.category || 'artwork'),
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
        )}

        <div className="cd-drawer-body">
          <h2 className="cd-drawer-title">{request.title}</h2>

          <div className="cd-prop-grid">
            <div className="cd-prop-label">Status</div>
            <div className="cd-prop-value">
              <StatusPill status={request._derivedStatus} />
            </div>
            <div className="cd-prop-label">Priority</div>
            <div className="cd-prop-value">
              <PriorityDot priority={request.priority} />
            </div>
            {meta.category && (
              <>
                <div className="cd-prop-label">Type</div>
                <div
                  className="cd-prop-value mono"
                  style={{ fontSize: 12, color: 'var(--cd-fg-1)' }}
                >
                  {meta.category}
                </div>
              </>
            )}
            <div className="cd-prop-label">Assigned</div>
            <div className="cd-prop-value">
              {assignee ? (
                <Avatar person={assignee} size="xs" showName />
              ) : (
                <span className="muted mono" style={{ fontSize: 11 }}>
                  unassigned
                </span>
              )}
            </div>
            <div className="cd-prop-label">Submitted</div>
            <div className="cd-prop-value mono" style={{ fontSize: 12 }}>
              {submittedLabel}
            </div>
            <div className="cd-prop-label">Due</div>
            <div className="cd-prop-value mono" style={{ fontSize: 12 }}>
              {dueLabel(request.due_date)}
            </div>
            <div className="cd-prop-label">Logged time</div>
            <div className="cd-prop-value">
              {isTicking ? (
                <LiveTimer
                  ticking
                  startedAt={timerState.startedAt}
                  baseTracked={timerState.baseTracked}
                />
              ) : (
                <span className="mono">
                  {formatHours((request.time_tracked || 0) / 3600)}
                  {request.time_estimate != null && (
                    <span style={{ color: 'var(--cd-fg-2)', marginLeft: 6 }}>
                      / est {formatHours((request.time_estimate || 0) / 3600)}
                    </span>
                  )}
                </span>
              )}
            </div>
            {meta.format && (
              <>
                <div className="cd-prop-label">Format</div>
                <div className="cd-prop-value" style={{ fontSize: 12.5 }}>
                  {meta.format}
                </div>
              </>
            )}
            {meta.audience && (
              <>
                <div className="cd-prop-label">Audience</div>
                <div className="cd-prop-value" style={{ fontSize: 12.5 }}>
                  {meta.audience}
                </div>
              </>
            )}
            {meta.tone && (
              <>
                <div className="cd-prop-label">Tone</div>
                <div className="cd-prop-value" style={{ fontSize: 12.5 }}>
                  {meta.tone}
                </div>
              </>
            )}
          </div>

          {request.description && (
            <>
              <div className="cd-sub-head">Brief</div>
              <div className="cd-brief">{request.description}</div>
            </>
          )}

          {Array.isArray(meta.references) && meta.references.length > 0 && (
            <>
              <div className="cd-sub-head">References</div>
              {meta.references.map((r: string) => (
                <div
                  key={r}
                  className="hstack"
                  style={{ padding: '6px 0', fontSize: 12, gap: 8 }}
                >
                  <IconLink size={12} style={{ color: 'var(--cd-fg-2)' }} />
                  <span className="mono" style={{ color: 'var(--cd-fg-1)' }}>
                    {r}
                  </span>
                  <span style={{ flex: 1 }} />
                  <IconArrowUpRight size={12} style={{ color: 'var(--cd-fg-3)' }} />
                </div>
              ))}
            </>
          )}

          {Array.isArray(meta.attachments) && meta.attachments.length > 0 && (
            <>
              <div className="cd-sub-head">Attachments</div>
              <div className="cd-upload-list">
                {meta.attachments.map((a: { name: string; size: string }) => (
                  <div key={a.name} className="cd-upload-item">
                    <IconPaperclip size={13} style={{ color: 'var(--cd-fg-2)' }} />
                    <span className="name">{a.name}</span>
                    <span className="size">{a.size}</span>
                    <button className="cd-modal-close">
                      <IconDownload size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="cd-sub-head">Activity</div>
          {comments.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--cd-fg-3)', padding: '8px 0' }}>
              No comments yet.
            </div>
          )}
          {comments.map((c) => (
            <div key={c.id} className="cd-comment">
              <Avatar person={c.user || { initials: '?' }} size="md" />
              <div>
                <div className="cd-comment-head">
                  <span className="cd-comment-name">
                    {c.user?.display_name || c.user?.email || 'Someone'}
                  </span>
                  <span className="cd-comment-time">
                    {new Date(c.created_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
                <div className="cd-comment-body">{c.content}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
