import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { SpaceStatus, Task, TaskMetadata, TaskRecurrence, TaskTypeField } from '@squadhub/shared';
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
import BulkTaskDock from './BulkTaskDock';
import './bulk-tasks.css';

const FIELDS = [
  ['status', 'Stage / status'], ['priority', 'Priority'], ['task_type_id', 'Type'],
  ['assignee_ids', 'Assignees'], ['labels', 'Labels'], ['work_date', 'Work start date'],
  ['work_end_date', 'Work end date'], ['start_date', 'Start date'], ['due_date', 'Due date'],
  ['recurrence', 'Repeat'], ['time_estimate', 'Estimate (minutes)'], ['log_time', 'Log time (minutes per task)'],
  ['title', 'Title'], ['description', 'Description'],
];

type Patch = Omit<Parameters<ReturnType<typeof useUpdateTask>['mutateAsync']>[0], 'id'>;

export default function BulkTaskActions({ tasks, statuses, listId = null, scopeKey }: {
  tasks: Task[]; statuses: SpaceStatus[]; listId?: string | null; scopeKey: string;
}) {
  const qc = useQueryClient();
  const selectedIds = usePMStore((s) => s.selectedTasks);
  const selected = [...new Map(tasks.filter((t) => selectedIds.includes(t.id)).map((t) => [t.id, t])).values()];
  const update = useUpdateTask(listId);
  const remove = useDeleteTask(listId);
  const logTime = useCreateTaskTimeEntry();
  const startJob = useBulkTaskStore((s) => s.startJob);

  const [editing, setEditing] = useState(false);
  const [field, setField] = useState('status');
  const [value, setValue] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [labels, setLabels] = useState<{ id: string; name: string }[]>([]);
  const [labelMode, setLabelMode] = useState('add');
  const [repeat, setRepeat] = useState<TaskRecurrence | null>(null);
  const [picker, setPicker] = useState<{ kind: string; rect: DOMRect } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

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
  const statusOptions = statuses.length
    ? statuses.map((s) => ({ key: s.name, name: s.name, group: s.groupLabel || s.group || '', category: s.category }))
    : defs.map((d) => ({ key: d.key, name: d.label, group: d.groupLabel, category: d.category }));

  useEffect(() => {
    usePMStore.getState().clearSelection();
  }, [scopeKey]);

  useEffect(() => {
    if (editing) dialog.current?.showModal();
    else dialog.current?.close();
  }, [editing]);

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
      const match = statusOptions.find((s) => s.key === value);
      valueLabel = match ? (match.group ? `${match.group} · ${match.name}` : match.name) : value;
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

  const pickerButton = (kind: string, text: string) => (
    <button type="button" onClick={(e) => setPicker({ kind, rect: e.currentTarget.getBoundingClientRect() })}>
      {text}
    </button>
  );

  const valid = field === 'labels' ? labelMode === 'replace' || labels.length > 0
    : ['status', 'priority', 'task_type_id', 'title'].includes(field) ? !!value.trim()
    : ['time_estimate', 'log_time'].includes(field)
    ? (field === 'time_estimate' && value === '') || (Number.isFinite(Number(value)) && Number(value) >= (field === 'log_time' ? 1 : 0))
    : true;

  return (
    <>
      {/* Floating bulk selection toolbar */}
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

      {/* Edit details dialog — minimizes to the bottom immediately upon apply */}
      {editing &&
        createPortal(
          <dialog
            ref={dialog}
            className="bulk-details-dialog"
            aria-labelledby="bulk-title"
            onCancel={(e) => {
              e.preventDefault();
              close();
            }}
            onClose={close}
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
                    <select aria-label="New value" required value={value} onChange={(e) => setValue(e.target.value)}>
                      <option value="">Choose stage / status</option>
                      {statusOptions.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.group ? `${s.group} · ` : ''}
                          {s.name}
                        </option>
                      ))}
                    </select>
                  ) : field === 'priority' ? (
                    <select aria-label="New value" required value={value} onChange={(e) => setValue(e.target.value)}>
                      <option value="">Choose priority</option>
                      {['emergency', 'urgent', 'high', 'normal', 'low', 'none'].map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
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
                    pickerButton('people', people.length ? `${people.length} assignees selected` : 'Choose assignees (empty clears)')
                  ) : field === 'labels' ? (
                    pickerButton('labels', labels.length ? labels.map((l) => l.name).join(', ') : 'Choose labels')
                  ) : field === 'recurrence' ? (
                    pickerButton('repeat', repeat ? describeTaskRecurrence(repeat) : 'Does not repeat')
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
          </dialog>,
          document.body
        )}

      {/* Global docked progress bar for running and completed bulk jobs */}
      <BulkTaskDock />
    </>
  );
}
