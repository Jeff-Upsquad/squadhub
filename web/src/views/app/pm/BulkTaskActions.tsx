import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { SpaceStatus, Task, TaskMetadata, TaskPriority, TaskRecurrence, TaskTypeField } from '@squadhub/shared';
import { describeTaskRecurrence } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import { useBulkTaskStore } from '../../../stores/bulkTaskStore';
import { useDeleteTask, useUpdateTask } from '../../../hooks/useTasks';
import { useCreateTaskTimeEntry } from '../../../hooks/useTaskTimeEntries';
import { useTaskTypes } from '../../../hooks/useTaskTypes';
import { useTaskWorkflowCatalog } from '../../../hooks/useTaskWorkflowCatalog';
import api from '../../../services/api';
import AssigneePicker from './AssigneePicker';
import LabelPicker from './LabelPicker';
import RepeatPicker from './RepeatPicker';
import StatusPicker from './StatusPicker';
import PriorityPicker, { PRIORITY_META } from './PriorityPicker';
import BulkTaskDock from './BulkTaskDock';
import './bulk-tasks.css';

const FIELDS = [
  ['status', 'Stage / status'], ['priority', 'Priority'], ['task_type_id', 'Type'],
  ['assignee_ids', 'Assignees'], ['labels', 'Labels'], ['work_date', 'Work start date'],
  ['work_end_date', 'Work end date'], ['start_date', 'Start date'], ['due_date', 'Due date'],
  ['recurrence', 'Repeat'], ['time_estimate', 'Estimate (minutes)'], ['log_time', 'Log time (minutes per task)'],
  ['title', 'Title'], ['description', 'Description'],
];

export default function BulkTaskActions({ tasks, statuses, listId = null, scopeKey }: {
  tasks: Task[]; statuses: SpaceStatus[]; listId?: string | null; scopeKey: string;
}) {
  const qc = useQueryClient();
  const selectedIds = usePMStore((s) => s.selectedTasks);
  const selected = [...new Map(tasks.filter((t) => selectedIds.includes(t.id)).map((t) => [t.id, t])).values()];
  const update = useUpdateTask(listId);
  const remove = useDeleteTask(listId);
  const logTime = useCreateTaskTimeEntry();
  const jobs = useBulkTaskStore((s) => s.jobs);
  const startJob = useBulkTaskStore((s) => s.startJob);

  const [editing, setEditing] = useState(false);
  const [field, setField] = useState('status');
  const [value, setValue] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [labels, setLabels] = useState<{ id: string; name: string }[]>([]);
  const [labelMode, setLabelMode] = useState('add');
  const [repeat, setRepeat] = useState<TaskRecurrence | null>(null);
  const [picker, setPicker] = useState<{ kind: string; rect: DOMRect } | null>(null);

  const effectiveListId = listId || selected[0]?.list?.id || selected[0]?.list_id || null;
  const { defs } = useTaskWorkflowCatalog({ listId: effectiveListId });
  const { data: types = [] } = useTaskTypes({
    listId: effectiveListId,
    includeIds: selected.map((t) => t.task_type_id).filter(Boolean) as string[],
  });
  const commonType = selected[0]?.task_type_id;
  const customFields: TaskTypeField[] = selected.every((t) => t.task_type_id === commonType)
    ? types.find((t) => t.id === commonType)?.fields || []
    : [];
  const custom = customFields.find((f) => `custom:${f.key}` === field);

  // Status lookup with fallback to workflow defs
  const availableStatuses: SpaceStatus[] = statuses.length > 0
    ? statuses
    : (defs.map((d) => ({
        id: d.key,
        name: d.label,
        color: d.color,
        category: d.category,
        group: d.group,
        groupLabel: d.groupLabel,
        groupEmoji: d.groupEmoji,
      })) as unknown as SpaceStatus[]);

  const selectedStatusObj = availableStatuses.find(
    (s) => s.name === value || s.id === value || s.name.toLowerCase() === (value || '').toLowerCase()
  );
  const statusGroup = selectedStatusObj?.groupLabel || selectedStatusObj?.group || '';

  const priorityMeta = PRIORITY_META[(value as TaskPriority) || 'normal'];

  useEffect(() => {
    usePMStore.getState().clearSelection();
  }, [scopeKey]);

  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (picker) {
          setPicker(null);
        } else {
          setEditing(false);
          setPicker(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, picker]);

  const refreshQueries = () => {
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['new-tasks'] });
    void qc.invalidateQueries({ queryKey: ['label-picker'] });
  };

  const handleQuickAction = (actionType: 'complete' | 'archive' | 'delete') => {
    if (!selected.length) return;
    const snapshot = [...selected];
    usePMStore.getState().clearSelection();

    if (actionType === 'complete') {
      startJob({
        title: `Mark complete · ${snapshot.length} tasks`,
        tasks: snapshot,
        action: (t) => update.mutateAsync({ id: t.id, status: 'done' }),
        onSuccess: refreshQueries,
      });
    } else if (actionType === 'archive') {
      startJob({
        title: `Archive · ${snapshot.length} tasks`,
        tasks: snapshot,
        action: (t) => update.mutateAsync({ id: t.id, status: 'closed' }),
        onSuccess: refreshQueries,
      });
    } else if (actionType === 'delete') {
      if (window.confirm(`Delete ${snapshot.length} selected tasks? This cannot be undone.`)) {
        startJob({
          title: `Delete · ${snapshot.length} tasks`,
          tasks: snapshot,
          action: (t) => remove.mutateAsync(t.id),
          onSuccess: refreshQueries,
        });
      }
    }
  };

  const setFieldValue = (next: string) => {
    setField(next);
    setValue('');
    setPeople([]);
    setLabels([]);
    setRepeat(null);
    setPicker(null);
  };

  const apply = () => {
    if (!selected.length) return;
    const snapshot = [...selected];

    // Compute friendly title
    const fieldLabel = FIELDS.find(([k]) => k === field)?.[1] || custom?.label || field;
    let valueLabel = value;
    if (field === 'status') {
      valueLabel = selectedStatusObj
        ? statusGroup
          ? `${statusGroup} · ${selectedStatusObj.name}`
          : selectedStatusObj.name
        : value;
    } else if (field === 'priority') {
      valueLabel = priorityMeta?.label || value;
    } else if (field === 'task_type_id') {
      valueLabel = types.find((t) => t.id === value)?.name || value;
    } else if (field === 'assignee_ids') {
      valueLabel = people.length ? `${people.length} assignees` : 'Cleared';
    } else if (field === 'labels') {
      valueLabel = labels.length ? `${labelMode}: ${labels.map((l) => l.name).join(', ')}` : `${labelMode} labels`;
    } else if (field === 'recurrence') {
      valueLabel = repeat ? describeTaskRecurrence(repeat) : 'None';
    } else if (field === 'log_time') {
      valueLabel = `${value} min`;
    } else if (!value) {
      valueLabel = 'Cleared';
    }
    const jobTitle = `${fieldLabel} → ${valueLabel} (${snapshot.length} tasks)`;

    let action: (task: Task) => Promise<unknown>;

    if (field === 'labels') {
      const chosenLabels = [...labels];
      const mode = labelMode;
      action = async (t) => {
        if (mode === 'replace') {
          const fresh: Task = (await api.get(`/pm/tasks/${t.id}`)).data.data;
          for (const tag of fresh.tags || []) {
            if (!chosenLabels.some((l) => l.id === tag.id)) await api.delete(`/pm/tasks/${t.id}/labels/${tag.id}`);
          }
        }
        for (const label of chosenLabels) {
          if (mode === 'remove') await api.delete(`/pm/tasks/${t.id}/labels/${label.id}`);
          else await api.post(`/pm/tasks/${t.id}/labels`, { tag_id: label.id });
        }
        await update.mutateAsync({ id: t.id });
      };
    } else if (field === 'log_time') {
      const minutes = Number(value);
      action = (t) =>
        logTime.mutateAsync({
          taskId: t.id,
          durationSeconds: minutes * 60,
          startedAt: new Date(Date.now() - minutes * 60000).toISOString(),
          source: 'manual',
        });
    } else if (field === 'work_end_date' || custom) {
      const targetCustom = custom;
      const targetValue = value;
      action = async (t) => {
        const fresh: Task = (await api.get(`/pm/tasks/${t.id}`)).data.data;
        const metadata: TaskMetadata = { ...fresh.metadata };
        if (targetCustom) {
          const v = targetCustom.field_type === 'number' ? (targetValue === '' ? null : Number(targetValue))
            : targetCustom.field_type === 'checkbox' ? targetValue === 'true'
            : targetCustom.field_type === 'multi_select' ? (targetValue ? targetValue.split(',') : []) : targetValue || null;
          metadata.custom = { ...metadata.custom, [targetCustom.key]: v };
        } else {
          metadata.work_end_date = targetValue ? new Date(targetValue).toISOString() : null;
        }
        await update.mutateAsync({ id: t.id, metadata });
      };
    } else if (field === 'assignee_ids') {
      const assigned = [...people];
      action = (t) => update.mutateAsync({ id: t.id, assignee_ids: assigned });
    } else if (field === 'recurrence') {
      const rec = repeat;
      action = (t) => update.mutateAsync({ id: t.id, recurrence: rec });
    } else {
      const v = ['work_date', 'start_date', 'due_date'].includes(field)
        ? (value ? new Date(value).toISOString() : null)
        : field === 'time_estimate'
        ? (value === '' ? null : Number(value))
        : value || null;
      action = (t) => update.mutateAsync({ id: t.id, [field]: v } as Parameters<ReturnType<typeof useUpdateTask>['mutateAsync']>[0]);
    }

    // Minimize modal dialog immediately to the bottom and clear selection!
    setEditing(false);
    setPicker(null);
    usePMStore.getState().clearSelection();

    // Start background job with progress bar!
    startJob({
      title: jobTitle,
      tasks: snapshot,
      action,
      onSuccess: refreshQueries,
    });
  };

  const close = () => {
    setEditing(false);
    setPicker(null);
  };

  const valid = field === 'labels' ? labelMode === 'replace' || labels.length > 0
    : ['status', 'priority', 'task_type_id', 'title'].includes(field) ? !!value.trim()
    : ['time_estimate', 'log_time'].includes(field)
    ? (field === 'time_estimate' && value === '') || (Number.isFinite(Number(value)) && Number(value) >= (field === 'log_time' ? 1 : 0))
    : true;

  return (
    <>
      {/* Unified floating dock for active progress cards and selection toolbar.
          The progress stack sits cleanly ABOVE the selection toolbar so they never overlap! */}
      {(jobs.length > 0 || selected.length > 0) &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="bulk-floating-dock" role="region" aria-label="Bulk task actions and progress">
            {/* Background progress cards stack */}
            <BulkTaskDock />

            {/* Floating selection toolbar */}
            {selected.length > 0 && (
              <div className="lv-bulk-bar task-bulk-bar" role="toolbar" aria-label="Selected task actions">
                <span className="count">{selected.length} selected</span>
                <button
                  className="lv-bulk-btn"
                  onClick={() => {
                    setFieldValue('status');
                    setLabelMode('add');
                    setEditing(true);
                  }}
                >
                  Edit details
                </button>
                <button className="lv-bulk-btn" onClick={() => handleQuickAction('complete')}>
                  Mark complete
                </button>
                <button
                  className="lv-bulk-btn"
                  title="Move tasks to Closed (completed and archived)"
                  onClick={() => handleQuickAction('archive')}
                >
                  Archive
                </button>
                <button className="lv-bulk-btn danger" onClick={() => handleQuickAction('delete')}>
                  Delete
                </button>
                <button
                  className="lv-bulk-btn"
                  aria-label="Clear selection"
                  onClick={() => {
                    usePMStore.getState().clearSelection();
                    setEditing(false);
                  }}
                >
                  ×
                </button>
              </div>
            )}
          </div>,
          document.body
        )}

      {/* Edit details modal dialog — closes/minimizes to the bottom immediately upon apply */}
      {editing &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="bulk-modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget && !picker) close();
            }}
          >
            <div
              className="bulk-details-dialog"
              role="dialog"
              aria-labelledby="bulk-title"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  apply();
                }}
              >
                <h2 id="bulk-title">Edit details · {selected.length} tasks</h2>
                <p>Choose a field and apply the same value to all selected tasks. Other fields stay as they are.</p>
                <fieldset>
                  <label>
                    Field
                    <select aria-label="Field" value={field} onChange={(e) => setFieldValue(e.target.value)}>
                      {FIELDS.map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                      {customFields.map((f) => (
                        <option key={f.key} value={`custom:${f.key}`}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {field === 'labels' && (
                    <label>
                      Label action
                      <select value={labelMode} onChange={(e) => setLabelMode(e.target.value)}>
                        <option value="add">Add labels</option>
                        <option value="remove">Remove labels</option>
                        <option value="replace">Replace all labels (empty clears)</option>
                      </select>
                    </label>
                  )}
                  <label>
                    New value
                    {field === 'status' ? (
                      /* Actual SquadHub Stage & Status design */
                      <button
                        type="button"
                        className="bulk-picker-trigger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPicker({ kind: 'status', rect: e.currentTarget.getBoundingClientRect() });
                        }}
                      >
                        {selectedStatusObj ? (
                          <span className="bulk-picker-value">
                            <span
                              className="bulk-status-dot"
                              style={{
                                background: selectedStatusObj.color || '#3b82f6',
                                boxShadow: `0 0 0 2px color-mix(in srgb, ${selectedStatusObj.color || '#3b82f6'} 25%, transparent)`,
                              }}
                            />
                            {statusGroup && <span className="bulk-picker-group">{statusGroup} · </span>}
                            <span className="bulk-picker-name">{selectedStatusObj.name}</span>
                          </span>
                        ) : (
                          <span className="bulk-picker-placeholder">Choose stage / status</span>
                        )}
                        <svg className="bulk-picker-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                    ) : field === 'priority' ? (
                      /* Actual SquadHub Priority design */
                      <button
                        type="button"
                        className="bulk-picker-trigger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPicker({ kind: 'priority', rect: e.currentTarget.getBoundingClientRect() });
                        }}
                      >
                        {value ? (
                          <span className="bulk-picker-value">
                            <span
                              className="bulk-status-dot"
                              style={{
                                background: priorityMeta?.color || '#3b82f6',
                                boxShadow: `0 0 0 2px color-mix(in srgb, ${priorityMeta?.color || '#3b82f6'} 25%, transparent)`,
                              }}
                            />
                            <span className="bulk-picker-name">{priorityMeta?.label || value}</span>
                          </span>
                        ) : (
                          <span className="bulk-picker-placeholder">Choose priority</span>
                        )}
                        <svg className="bulk-picker-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                    ) : field === 'task_type_id' ? (
                      <select aria-label="New value" required value={value} onChange={(e) => setValue(e.target.value)}>
                        <option value="">Choose type</option>
                        {types.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    ) : field === 'assignee_ids' ? (
                      <button
                        type="button"
                        className="bulk-picker-trigger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPicker({ kind: 'people', rect: e.currentTarget.getBoundingClientRect() });
                        }}
                      >
                        {people.length > 0 ? (
                          <span className="bulk-picker-value">
                            <span className="bulk-picker-name">{people.length} assignees selected</span>
                          </span>
                        ) : (
                          <span className="bulk-picker-placeholder">Choose assignees (empty clears)</span>
                        )}
                        <svg className="bulk-picker-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                    ) : field === 'labels' ? (
                      <button
                        type="button"
                        className="bulk-picker-trigger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPicker({ kind: 'labels', rect: e.currentTarget.getBoundingClientRect() });
                        }}
                      >
                        {labels.length > 0 ? (
                          <span className="bulk-picker-value">
                            <span className="bulk-picker-name">{labels.map((l) => l.name).join(', ')}</span>
                          </span>
                        ) : (
                          <span className="bulk-picker-placeholder">Choose labels</span>
                        )}
                        <svg className="bulk-picker-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                    ) : field === 'recurrence' ? (
                      <button
                        type="button"
                        className="bulk-picker-trigger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPicker({ kind: 'repeat', rect: e.currentTarget.getBoundingClientRect() });
                        }}
                      >
                        {repeat ? (
                          <span className="bulk-picker-value">
                            <span className="bulk-picker-name">{describeTaskRecurrence(repeat)}</span>
                          </span>
                        ) : (
                          <span className="bulk-picker-placeholder">Does not repeat</span>
                        )}
                        <svg className="bulk-picker-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                    ) : custom?.field_type === 'checkbox' ? (
                      <select aria-label="New value" value={value} onChange={(e) => setValue(e.target.value)}>
                        <option value="">Unchecked</option>
                        <option value="true">Checked</option>
                      </select>
                    ) : custom && ['select', 'multi_select'].includes(custom.field_type) ? (
                      <select
                        aria-label="New value"
                        multiple={custom.field_type === 'multi_select'}
                        value={custom.field_type === 'multi_select' ? value.split(',').filter(Boolean) : value}
                        onChange={(e) =>
                          setValue(
                            custom.field_type === 'multi_select'
                              ? Array.from(e.target.selectedOptions)
                                  .map((o) => o.value)
                                  .join(',')
                              : e.target.value
                          )
                        }
                      >
                        {custom.field_type === 'select' && <option value="">Clear value</option>}
                        {custom.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : field === 'description' || custom?.field_type === 'textarea' ? (
                      <textarea aria-label="New value" value={value} onChange={(e) => setValue(e.target.value)} />
                    ) : (
                      <input
                        aria-label="New value"
                        type={
                          field.endsWith('_date')
                            ? 'datetime-local'
                            : ['time_estimate', 'log_time'].includes(field) || custom?.field_type === 'number'
                            ? 'number'
                            : custom?.field_type === 'date'
                            ? 'date'
                            : 'text'
                        }
                        min={field === 'log_time' ? 1 : 0}
                        maxLength={field === 'title' ? 500 : undefined}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                      />
                    )}
                  </label>
                  {['work_date', 'work_end_date', 'start_date', 'due_date', 'time_estimate', 'description'].includes(field) && (
                    <small>Leave empty to clear this field on every selected task.</small>
                  )}
                  {field === 'recurrence' && (
                    <small>Repeating tasks become routine templates, just as in task details.</small>
                  )}
                </fieldset>
                <div className="bulk-dialog-actions">
                  <button type="button" onClick={close}>
                    Cancel
                  </button>
                  <button type="submit" disabled={!valid}>
                    Apply to {selected.length} tasks
                  </button>
                </div>
              </form>

              {/* Rich popovers mounted with higher z-index over the modal */}
              {picker?.kind === 'status' && (
                <StatusPicker
                  anchorRect={picker.rect}
                  statuses={availableStatuses}
                  currentStatus={value}
                  onChange={(statusName) => {
                    setValue(statusName);
                    setPicker(null);
                  }}
                  onClose={() => setPicker(null)}
                />
              )}
              {picker?.kind === 'priority' && (
                <PriorityPicker
                  anchorRect={picker.rect}
                  value={(value as TaskPriority) || 'normal'}
                  onChange={(p) => {
                    setValue(p);
                    setPicker(null);
                  }}
                  onClose={() => setPicker(null)}
                />
              )}
              {picker?.kind === 'people' && (
                <AssigneePicker
                  listId={effectiveListId || undefined}
                  currentAssigneeIds={people}
                  anchorRect={picker.rect}
                  onChange={setPeople}
                  onClose={() => setPicker(null)}
                />
              )}
              {picker?.kind === 'labels' && (
                <LabelPicker
                  listId={effectiveListId || undefined}
                  attachedTagIds={labels.map((l) => l.id)}
                  anchorRect={picker.rect}
                  onDraftToggle={(tag) =>
                    setLabels((prev) =>
                      prev.some((l) => l.id === tag.id) ? prev.filter((l) => l.id !== tag.id) : [...prev, tag]
                    )
                  }
                  onClose={() => setPicker(null)}
                />
              )}
              {picker?.kind === 'repeat' && (
                <RepeatPicker
                  anchorRect={picker.rect}
                  value={repeat}
                  onChange={(r) => {
                    setRepeat(r);
                    setPicker(null);
                  }}
                  onClose={() => setPicker(null)}
                />
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
