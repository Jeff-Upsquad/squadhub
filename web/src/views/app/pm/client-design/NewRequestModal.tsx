import { useState } from 'react';
import { useCreateTask } from '../../../../hooks/useTasks';
import { IconClose, IconPaperclip } from './atoms/Icons';
import { PRIORITY_CHOICES } from './atoms/PriorityDot';
import type { TaskPriority } from '@squadhub/shared';

export const CATEGORIES = [
  'Poster',
  'Social media',
  'Ad banner',
  'Presentation',
  'Brand asset',
  'Web / landing',
  'Illustration',
  'Print collateral',
  'Motion / video',
  'Other',
];

export default function NewRequestModal({
  briefsListId,
  onClose,
  onSubmitted,
}: {
  briefsListId: string | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Poster');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [brief, setBrief] = useState('');
  const [format, setFormat] = useState('');
  const [audience, setAudience] = useState('');
  const [tone, setTone] = useState('');
  const [due, setDue] = useState('');
  const [links, setLinks] = useState('');
  const [files, setFiles] = useState<{ name: string; size: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createTask = useCreateTask(briefsListId);

  const estimate = priority === 'low' ? '~1h' : priority === 'high' ? '~4–6h' : '~2–3h';
  const canSubmit = title.trim().length > 2 && brief.trim().length > 8 && !!briefsListId;

  const handleSubmit = async () => {
    if (!canSubmit || !briefsListId) return;
    setSubmitting(true);
    setError(null);
    try {
      await createTask.mutateAsync({
        title: title.trim(),
        description: brief.trim(),
        priority,
        due_date: due || undefined,
        list_id: briefsListId,
        metadata: {
          category,
          format: format.trim() || undefined,
          audience: audience.trim() || undefined,
          tone: tone.trim() || undefined,
          references: links
            .split(/\n|,/)
            .map((s) => s.trim())
            .filter(Boolean),
          attachments: files,
        },
      });
      onSubmitted();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="cd-root" style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
      <div className="cd-modal-backdrop" onClick={onClose}>
        <div className="cd-modal" onClick={(e) => e.stopPropagation()}>
          <div className="cd-modal-head">
            <span className="tag">NEW REQUEST</span>
            <span className="cd-modal-title">Submit design work</span>
            <button className="cd-modal-close" onClick={onClose} aria-label="Close">
              <IconClose size={14} />
            </button>
          </div>

          <div className="cd-modal-body">
            <div className="cd-field">
              <input
                autoFocus
                className="cd-input cd-title-input"
                placeholder="What do you need designed?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="cd-field">
              <div className="cd-field-row">
                <div className="cd-field-label">
                  Type<span className="req">*</span>
                </div>
                <div className="cd-choice-row">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c}
                      className={`cd-choice${category === c ? ' active' : ''}`}
                      onClick={() => setCategory(c)}
                      type="button"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="cd-field">
              <div className="cd-field-row">
                <div className="cd-field-label">Priority</div>
                <div className="cd-prio-row">
                  {PRIORITY_CHOICES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      className={`cd-prio${priority === p.value ? ' active' : ''}`}
                      onClick={() => setPriority(p.value)}
                    >
                      <span className="dot" style={{ background: p.color }} />
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="cd-field">
              <div className="cd-field-row">
                <div className="cd-field-label">
                  Brief<span className="req">*</span>
                </div>
                <textarea
                  className="cd-textarea"
                  rows={4}
                  placeholder="Describe what you want. Goals, context, audience, what success looks like."
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                />
              </div>
            </div>

            <div className="cd-field">
              <div className="cd-field-row">
                <div className="cd-field-label">Format</div>
                <input
                  className="cd-input"
                  placeholder="e.g. 1080×1350 · 16:9 · A4 print"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                />
              </div>
            </div>

            <div className="cd-field">
              <div className="cd-field-row">
                <div className="cd-field-label">Audience</div>
                <input
                  className="cd-input"
                  placeholder="Who is this for?"
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                />
              </div>
            </div>

            <div className="cd-field">
              <div className="cd-field-row">
                <div className="cd-field-label">Tone / style</div>
                <input
                  className="cd-input"
                  placeholder="e.g. confident, editorial, playful"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                />
              </div>
            </div>

            <div className="cd-field">
              <div className="cd-field-row">
                <div className="cd-field-label">Due date</div>
                <input
                  className="cd-input"
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </div>
            </div>

            <div className="cd-field">
              <div className="cd-field-row">
                <div className="cd-field-label">Reference links</div>
                <textarea
                  className="cd-textarea"
                  rows={2}
                  placeholder="Paste inspiration URLs, one per line"
                  value={links}
                  onChange={(e) => setLinks(e.target.value)}
                />
              </div>
            </div>

            <div className="cd-field">
              <div className="cd-field-row">
                <div className="cd-field-label">Attachments</div>
                <div className={`cd-upload${files.length ? ' has-files' : ''}`}>
                  {files.length ? (
                    <div className="cd-upload-list">
                      {files.map((f, i) => (
                        <div key={i} className="cd-upload-item">
                          <IconPaperclip size={13} style={{ color: 'var(--cd-fg-2)' }} />
                          <span className="name">{f.name}</span>
                          <span className="size">{f.size}</span>
                          <button
                            type="button"
                            className="cd-modal-close"
                            onClick={() => setFiles(files.filter((_, j) => j !== i))}
                          >
                            <IconClose size={11} />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="cd-upload"
                        style={{ padding: 8, fontSize: 11 }}
                        onClick={() =>
                          setFiles([
                            ...files,
                            { name: `asset-${files.length + 1}.png`, size: '3.1 MB' },
                          ])
                        }
                      >
                        + Add another file
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="cd-upload"
                      style={{ width: '100%', padding: 14 }}
                      onClick={() =>
                        setFiles([{ name: 'reference-board.jpg', size: '2.4 MB' }])
                      }
                    >
                      <div>Drop files or click to upload</div>
                      <div className="mono" style={{ marginTop: 4 }}>
                        PNG · JPG · PDF · AI · PSD · ZIP · up to 200 MB
                      </div>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {error && (
              <div
                style={{
                  padding: 10,
                  color: 'var(--cd-danger)',
                  background: 'var(--cd-danger-soft)',
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: 'var(--cd-font-mono)',
                }}
              >
                {error}
              </div>
            )}
          </div>

          <div className="cd-modal-foot">
            <div className="estimate">
              Est. <b>{estimate}</b> · will consume from your daily allotment
            </div>
            <button className="cd-btn" onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className="cd-btn primary"
              disabled={!canSubmit || submitting}
              onClick={handleSubmit}
              type="button"
            >
              {submitting ? 'Submitting…' : 'Submit request'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
