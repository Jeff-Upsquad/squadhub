import { useMemo, useState } from 'react';
import { useCreateTask } from '../../../../hooks/useTasks';
import { useTaskTypes } from '../../../../hooks/useTaskTypes';
import { IconClose } from './atoms/Icons';
import { PRIORITY_CHOICES } from './atoms/PriorityDot';
import type { TaskPriority, TaskTypeField } from '@squadhub/shared';

const DESIGN_TASK_KEY = 'design_task';

export default function NewRequestModal({
  briefsListId,
  onClose,
  onSubmitted,
}: {
  briefsListId: string | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { data: taskTypes } = useTaskTypes();
  const designType = useMemo(
    () => taskTypes?.find((t) => t.key === DESIGN_TASK_KEY) || null,
    [taskTypes]
  );
  const fields: TaskTypeField[] = designType?.fields || [];

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('none');
  const [brief, setBrief] = useState('');
  const [due, setDue] = useState('');
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createTask = useCreateTask(briefsListId);

  const hasTitle = title.trim().length > 0;
  const hasBrief = brief.trim().length > 0;
  const canSubmit = hasTitle && hasBrief && !!briefsListId;
  const disabledReason = !hasTitle
    ? 'Enter a title'
    : !hasBrief
      ? 'Enter a brief'
      : !briefsListId
        ? 'No "Briefs" list found in this folder'
        : null;

  const setField = (key: string, v: unknown) =>
    setCustom((prev) => {
      const next = { ...prev };
      if (v == null || (Array.isArray(v) && v.length === 0) || v === '') delete next[key];
      else next[key] = v;
      return next;
    });

  const briefTypeField = fields.find((f) => f.key === 'brief_type');
  const handleSubmit = async () => {
    if (!canSubmit || !briefsListId) return;
    setSubmitting(true);
    setError(null);
    try {
      // Denormalize a `category` string for the request row / board / reports tag.
      const briefTypeArr = (custom['brief_type'] as string[] | undefined) || [];
      const categoryLabel = briefTypeArr
        .map((v) =>
          v === '__other__'
            ? (custom['brief_type_other'] as string) || 'Other'
            : briefTypeField?.options.find((o) => o.value === v)?.label || v
        )
        .filter(Boolean)[0];

      await createTask.mutateAsync({
        title: title.trim(),
        description: brief.trim(),
        priority,
        due_date: due || undefined,
        list_id: briefsListId,
        task_type_id: designType?.id,
        metadata: {
          custom,
          category: categoryLabel,
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
                  placeholder="Describe what you want. Goals, context, what success looks like."
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                />
              </div>
            </div>

            {fields.map((f) => (
              <BriefFieldInput
                key={f.id}
                field={f}
                value={custom[f.key]}
                otherValue={custom[f.key + '_other']}
                onChange={(v) => setField(f.key, v)}
                onOtherChange={(v) => setField(f.key + '_other', v)}
              />
            ))}

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
              {disabledReason ? (
                <span style={{ color: 'var(--cd-fg-2)' }}>{disabledReason}</span>
              ) : (
                <span style={{ color: 'var(--cd-fg-2)' }}>Ready to submit</span>
              )}
            </div>
            <button className="cd-btn" onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className="cd-btn primary"
              disabled={!canSubmit || submitting}
              onClick={handleSubmit}
              type="button"
              title={disabledReason || undefined}
            >
              {submitting ? 'Submitting…' : 'Submit request'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BriefFieldInput({
  field,
  value,
  otherValue,
  onChange,
  onOtherChange,
}: {
  field: TaskTypeField;
  value: unknown;
  otherValue: unknown;
  onChange: (v: unknown) => void;
  onOtherChange: (v: unknown) => void;
}) {
  const str = typeof value === 'string' ? value : value == null ? '' : String(value);
  const otherStr = typeof otherValue === 'string' ? otherValue : '';

  let control: React.ReactNode = null;

  switch (field.field_type) {
    case 'multi_select': {
      const arr: string[] = Array.isArray(value) ? (value as string[]) : [];
      const otherSelected = arr.includes('__other__') || (field.allow_other && !!otherStr);
      control = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="cd-choice-row">
            {field.options.map((o) => {
              const on = arr.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  className={`cd-choice${on ? ' active' : ''}`}
                  onClick={() => {
                    onChange(on ? arr.filter((v) => v !== o.value) : [...arr, o.value]);
                  }}
                >
                  {o.label}
                </button>
              );
            })}
            {field.allow_other && (
              <button
                type="button"
                className={`cd-choice${otherSelected ? ' active' : ''}`}
                onClick={() => {
                  if (otherSelected) {
                    onChange(arr.filter((v) => v !== '__other__'));
                    onOtherChange(null);
                  } else if (!arr.includes('__other__')) {
                    onChange([...arr, '__other__']);
                  }
                }}
              >
                Other
              </button>
            )}
          </div>
          {field.allow_other && otherSelected && (
            <input
              className="cd-input"
              type="text"
              value={otherStr}
              placeholder="Describe…"
              onChange={(e) => onOtherChange(e.target.value || null)}
            />
          )}
        </div>
      );
      break;
    }
    case 'select':
      control = (
        <select
          className="cd-input"
          value={str}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'textarea':
      control = (
        <textarea
          className="cd-textarea"
          rows={2}
          placeholder={field.placeholder || ''}
          value={str}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
      break;
    case 'number':
      control = (
        <input
          className="cd-input"
          type="number"
          placeholder={field.placeholder || ''}
          value={str}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
      break;
    case 'date':
      control = (
        <input
          className="cd-input"
          type="date"
          value={str}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
      break;
    case 'url':
      control = (
        <input
          className="cd-input"
          type="url"
          placeholder={field.placeholder || 'https://'}
          value={str}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
      break;
    case 'checkbox':
      control = (
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
      break;
    case 'text':
    default:
      control = (
        <input
          className="cd-input"
          type="text"
          placeholder={field.placeholder || ''}
          value={str}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
  }

  return (
    <div className="cd-field">
      <div className="cd-field-row">
        <div className="cd-field-label" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>
            {field.label}
            {field.is_required && <span className="req">*</span>}
          </span>
          {field.help_url && (
            <a
              href={field.help_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 10.5,
                color: 'var(--cd-fg-2)',
                textDecoration: 'underline',
              }}
            >
              View size chart ↗
            </a>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>{control}</div>
      </div>
    </div>
  );
}
