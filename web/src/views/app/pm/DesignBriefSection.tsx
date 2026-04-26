import { useState } from 'react';
import type { Task, TaskMetadata } from '@squadhub/shared';

type BriefField = 'format' | 'audience' | 'tone' | 'references';

const TEXT_FIELDS: { key: Exclude<BriefField, 'references'>; label: string; placeholder: string }[] = [
  { key: 'format', label: 'Format', placeholder: 'e.g. 1080×1080 square' },
  { key: 'audience', label: 'Audience', placeholder: 'Who is this for?' },
  { key: 'tone', label: 'Tone', placeholder: 'e.g. Playful, professional' },
];

function parseReferences(input: string): string[] {
  return input
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function DesignBriefSection({
  task,
  canEdit,
  onSave,
}: {
  task: Task;
  canEdit: boolean;
  onSave: (metadata: TaskMetadata) => void;
}) {
  const meta = (task.metadata as TaskMetadata | undefined) || {};
  const refs = Array.isArray(meta.references) ? meta.references : [];
  const hasAny = !!(meta.format || meta.audience || meta.tone || refs.length);

  const [editing, setEditing] = useState<BriefField | null>(null);
  const [draft, setDraft] = useState('');

  if (!hasAny && !canEdit) return null;

  const beginEdit = (field: BriefField) => {
    if (!canEdit) return;
    if (field === 'references') {
      setDraft(refs.join('\n'));
    } else {
      setDraft((meta[field] as string) || '');
    }
    setEditing(field);
  };

  const commit = (field: BriefField) => {
    const next: TaskMetadata = { ...meta };
    if (field === 'references') {
      const parsed = parseReferences(draft);
      if (parsed.length) next.references = parsed;
      else delete next.references;
    } else {
      const value = draft.trim();
      if (value) next[field] = value;
      else delete next[field];
    }
    onSave(next);
    setEditing(null);
  };

  const cancel = () => setEditing(null);

  return (
    <>
      <div className="td-eyebrow">Design brief</div>
      <div className="td-settings-card" style={{ marginBottom: 16 }}>
        {TEXT_FIELDS.map(({ key, label, placeholder }) => (
          <div key={key} className="td-settings-row">
            <span className="k">{label}</span>
            <span className="v">
              {editing === key ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit(key);
                    if (e.key === 'Escape') cancel();
                  }}
                  onBlur={() => commit(key)}
                  placeholder={placeholder}
                  className="text-[13.5px] bg-transparent border-b outline-none w-full"
                  style={{ borderColor: 'var(--sh-ink)' }}
                />
              ) : (
                <span
                  onClick={canEdit ? () => beginEdit(key) : undefined}
                  className={canEdit ? 'cursor-text' : ''}
                >
                  {meta[key] ? (
                    String(meta[key])
                  ) : canEdit ? (
                    <span className="muted">Add {label.toLowerCase()}…</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </span>
              )}
            </span>
          </div>
        ))}

        <div className="td-settings-row" style={{ alignItems: 'flex-start' }}>
          <span className="k" style={{ paddingTop: 4 }}>References</span>
          <span className="v">
            {editing === 'references' ? (
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') cancel();
                }}
                onBlur={() => commit('references')}
                placeholder={'One link per line'}
                rows={Math.max(3, draft.split('\n').length)}
                className="text-[13.5px] bg-transparent border outline-none w-full p-2 rounded"
                style={{ borderColor: 'var(--sh-hair)' }}
              />
            ) : refs.length ? (
              <div
                className="flex flex-col gap-1"
                onClick={canEdit ? () => beginEdit('references') : undefined}
                style={{ cursor: canEdit ? 'text' : 'default' }}
              >
                {refs.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-[13px] underline truncate"
                    style={{ color: 'var(--sh-ink)' }}
                  >
                    {url}
                  </a>
                ))}
              </div>
            ) : (
              <span
                onClick={canEdit ? () => beginEdit('references') : undefined}
                className={canEdit ? 'cursor-text muted' : 'muted'}
              >
                {canEdit ? 'Add reference links…' : '—'}
              </span>
            )}
          </span>
        </div>
      </div>
    </>
  );
}
