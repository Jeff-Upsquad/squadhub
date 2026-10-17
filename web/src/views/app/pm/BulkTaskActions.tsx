import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { SpaceStatus, Task, TaskMetadata, TaskRecurrence, TaskTypeField } from '@squadhub/shared';
import { describeTaskRecurrence } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import { useDeleteTask, useUpdateTask } from '../../../hooks/useTasks';
import { useCreateTaskTimeEntry } from '../../../hooks/useTaskTimeEntries';
import { useTaskTypes } from '../../../hooks/useTaskTypes';
import { useTaskWorkflowCatalog } from '../../../hooks/useTaskWorkflowCatalog';
import { runBulkTasks } from '../../../lib/bulkTasks';
import api from '../../../services/api';
import AssigneePicker from './AssigneePicker';
import LabelPicker from './LabelPicker';
import RepeatPicker from './RepeatPicker';
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
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [field, setField] = useState('priority');
  const [value, setValue] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [labels, setLabels] = useState<{ id: string; name: string }[]>([]);
  const [labelMode, setLabelMode] = useState('add');
  const [repeat, setRepeat] = useState<TaskRecurrence | null>(null);
  const [picker, setPicker] = useState<{ kind: string; rect: DOMRect } | null>(null);
  const [failures, setFailures] = useState<{ id: string; title: string; message: string }[]>([]);
  const [notice, setNotice] = useState('');
  const running = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const effectiveListId = listId || selected[0]?.list?.id || selected[0]?.list_id || null;
  const { defs } = useTaskWorkflowCatalog({ listId: effectiveListId });
  const { data: types = [] } = useTaskTypes({ listId: effectiveListId, includeIds: selected.map((t) => t.task_type_id).filter(Boolean) as string[] });
  const commonType = selected[0]?.task_type_id;
  const customFields: TaskTypeField[] = selected.every((t) => t.task_type_id === commonType)
    ? types.find((t) => t.id === commonType)?.fields || [] : [];
  const custom = customFields.find((f) => `custom:${f.key}` === field);
  const statusOptions = statuses.length ? statuses.map((s) => ({ key: s.name, name: s.name, group: s.groupLabel || s.group || '', category: s.category }))
    : defs.map((d) => ({ key: d.key, name: d.label, group: d.groupLabel, category: d.category }));

  useEffect(() => {
    usePMStore.getState().clearSelection();
    return () => { if (!running.current) usePMStore.getState().clearSelection(); };
  }, [scopeKey]);
  useEffect(() => {
    if (editing) dialog.current?.showModal();
  }, [editing]);

  const perform = async (action: (task: Task) => Promise<unknown>) => {
    if (running.current || !selected.length) return;
    running.current = true; setBusy(true); setFailures([]); setNotice('');
    const snapshot = selected;
    try {
      const failed = await runBulkTasks(snapshot, action);
      const succeeded = new Set(snapshot.filter((t) => !failed.some((f) => f.id === t.id)).map((t) => t.id));
      const state = usePMStore.getState();
      state.selectAllTasks(state.selectedTasks.filter((id) => !succeeded.has(id)));
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['new-tasks'] });
      void qc.invalidateQueries({ queryKey: ['label-picker'] });
      setFailures(failed);
      setNotice(`${snapshot.length - failed.length} of ${snapshot.length} tasks updated.`);
      if (!failed.length) { setEditing(false); setPicker(null); }
    } finally { running.current = false; setBusy(false); }
  };
  const applyPatch = (patch: Patch) => perform((t) => update.mutateAsync({ id: t.id, ...patch }));
  const setFieldValue = (next: string) => { setField(next); setValue(''); setPeople([]); setLabels([]); setRepeat(null); setPicker(null); };
  const apply = () => {
    if (field === 'labels') return perform(async (t) => {
      if (labelMode === 'replace') {
        const fresh: Task = (await api.get(`/pm/tasks/${t.id}`)).data.data;
        for (const tag of fresh.tags || []) {
          if (!labels.some((l) => l.id === tag.id)) await api.delete(`/pm/tasks/${t.id}/labels/${tag.id}`);
        }
      }
      for (const label of labels) {
        if (labelMode === 'remove') await api.delete(`/pm/tasks/${t.id}/labels/${label.id}`);
        else await api.post(`/pm/tasks/${t.id}/labels`, { tag_id: label.id });
      }
      await update.mutateAsync({ id: t.id });
    });
    if (field === 'log_time') return perform((t) => logTime.mutateAsync({ taskId: t.id, durationSeconds: Number(value) * 60, startedAt: new Date(Date.now() - Number(value) * 60000).toISOString(), source: 'manual' }));
    if (field === 'work_end_date' || custom) return perform(async (t) => {
      // Fetch current metadata before merging so each task retains its own details.
      const fresh: Task = (await api.get(`/pm/tasks/${t.id}`)).data.data;
      const metadata: TaskMetadata = { ...fresh.metadata };
      if (custom) {
        const v = custom.field_type === 'number' ? (value === '' ? null : Number(value))
          : custom.field_type === 'checkbox' ? value === 'true'
          : custom.field_type === 'multi_select' ? (value ? value.split(',') : []) : value || null;
        metadata.custom = { ...metadata.custom, [custom.key]: v };
      } else metadata.work_end_date = value ? new Date(value).toISOString() : null;
      await update.mutateAsync({ id: t.id, metadata });
    });
    if (field === 'assignee_ids') return applyPatch({ assignee_ids: people });
    if (field === 'recurrence') return applyPatch({ recurrence: repeat });
    const v = ['work_date', 'start_date', 'due_date'].includes(field) ? (value ? new Date(value).toISOString() : null)
      : field === 'time_estimate' ? (value === '' ? null : Number(value)) : value || null;
    return applyPatch({ [field]: v } as Patch);
  };
  const close = () => { if (!busy) { setEditing(false); setPicker(null); } };
  const pickerButton = (kind: string, text: string) => <button type="button" onClick={(e) => setPicker({ kind, rect: e.currentTarget.getBoundingClientRect() })}>{text}</button>;
  const valid = field === 'labels' ? labelMode === 'replace' || labels.length > 0
    : ['status', 'priority', 'task_type_id', 'title'].includes(field) ? !!value.trim()
    : ['time_estimate', 'log_time'].includes(field) ? (field === 'time_estimate' && value === '') || (Number.isFinite(Number(value)) && Number(value) >= (field === 'log_time' ? 1 : 0))
    : true;

  if (!selected.length && !notice && !failures.length && !busy) return null;
  return <>
    {(notice || failures.length > 0) && <div className="bulk-result" role="status">
      {notice} {failures.length > 0 && <span>Failed tasks remain selected. Review the errors and retry.</span>}
      {failures.length > 0 && <ul>{failures.map((f) => <li key={f.id}>{f.title}: {f.message}</li>)}</ul>}
      <button type="button" onClick={() => { setNotice(''); setFailures([]); }}>Dismiss</button>
    </div>}
    {(selected.length > 0 || busy) && <div className="lv-bulk-bar task-bulk-bar" role="toolbar" aria-label="Selected task actions" aria-busy={busy}>
      <span className="count">{busy ? 'Updating…' : `${selected.length} selected`}</span>
      <button className="lv-bulk-btn" disabled={busy} onClick={() => { setFieldValue('priority'); setLabelMode('add'); setEditing(true); }}>Edit details</button>
      <button className="lv-bulk-btn" disabled={busy} onClick={() => applyPatch({ status: 'done' })}>Mark complete</button>
      <button className="lv-bulk-btn" disabled={busy} title="Move tasks to Closed (completed and archived)" onClick={() => applyPatch({ status: 'closed' })}>Archive</button>
      <button className="lv-bulk-btn danger" disabled={busy} onClick={() => { if (window.confirm(`Delete ${selected.length} selected tasks? This cannot be undone.`)) void perform((t) => remove.mutateAsync(t.id)); }}>Delete</button>
      <button className="lv-bulk-btn" disabled={busy} aria-label="Clear selection" onClick={() => { usePMStore.getState().clearSelection(); setEditing(false); }}>×</button>
    </div>}
    {editing && createPortal(<dialog ref={dialog} className="bulk-details-dialog" aria-labelledby="bulk-title" onCancel={(e) => { e.preventDefault(); close(); }} onClose={close}>
      <form onSubmit={(e) => { e.preventDefault(); void apply(); }}>
        <h2 id="bulk-title">Edit details · {selected.length} tasks</h2>
        <p>Choose a field and apply the same value to all selected tasks. Other fields stay as they are.</p>
        {failures.length > 0 && <div role="alert">{failures.map((f) => <p key={f.id}>{f.title}: {f.message}</p>)}</div>}
        <fieldset disabled={busy}>
          <label>Field<select aria-label="Field" value={field} onChange={(e) => setFieldValue(e.target.value)}>{FIELDS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}{customFields.map((f) => <option key={f.key} value={`custom:${f.key}`}>{f.label}</option>)}</select></label>
          {field === 'labels' && <label>Label action<select value={labelMode} onChange={(e) => setLabelMode(e.target.value)}><option value="add">Add labels</option><option value="remove">Remove labels</option><option value="replace">Replace all labels (empty clears)</option></select></label>}
          <label>New value
            {field === 'status' ? <select aria-label="New value" required value={value} onChange={(e) => setValue(e.target.value)}><option value="">Choose stage / status</option>{statusOptions.map((s) => <option key={s.key} value={s.key}>{s.group ? `${s.group} · ` : ''}{s.name}</option>)}</select>
            : field === 'priority' ? <select aria-label="New value" required value={value} onChange={(e) => setValue(e.target.value)}><option value="">Choose priority</option>{['emergency', 'urgent', 'high', 'normal', 'low', 'none'].map((p) => <option key={p} value={p}>{p}</option>)}</select>
            : field === 'task_type_id' ? <select aria-label="New value" required value={value} onChange={(e) => setValue(e.target.value)}><option value="">Choose type</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            : field === 'assignee_ids' ? pickerButton('people', people.length ? `${people.length} assignees selected` : 'Choose assignees (empty clears)')
            : field === 'labels' ? pickerButton('labels', labels.length ? labels.map((l) => l.name).join(', ') : 'Choose labels')
            : field === 'recurrence' ? pickerButton('repeat', repeat ? describeTaskRecurrence(repeat) : 'Does not repeat')
            : custom?.field_type === 'checkbox' ? <select aria-label="New value" value={value} onChange={(e) => setValue(e.target.value)}><option value="">Unchecked</option><option value="true">Checked</option></select>
            : custom && ['select', 'multi_select'].includes(custom.field_type) ? <select aria-label="New value" multiple={custom.field_type === 'multi_select'} value={custom.field_type === 'multi_select' ? value.split(',').filter(Boolean) : value} onChange={(e) => setValue(custom.field_type === 'multi_select' ? Array.from(e.target.selectedOptions).map((o) => o.value).join(',') : e.target.value)}>{custom.field_type === 'select' && <option value="">Clear value</option>}{custom.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            : field === 'description' || custom?.field_type === 'textarea' ? <textarea aria-label="New value" value={value} onChange={(e) => setValue(e.target.value)} />
            : <input aria-label="New value" type={field.endsWith('_date') ? 'datetime-local' : ['time_estimate', 'log_time'].includes(field) || custom?.field_type === 'number' ? 'number' : custom?.field_type === 'date' ? 'date' : 'text'} min={field === 'log_time' ? 1 : 0} maxLength={field === 'title' ? 500 : undefined} value={value} onChange={(e) => setValue(e.target.value)} />}
          </label>
          {['work_date', 'work_end_date', 'start_date', 'due_date', 'time_estimate', 'description'].includes(field) && <small>Leave empty to clear this field on every selected task.</small>}
          {field === 'recurrence' && <small>Repeating tasks become routine templates, just as in task details.</small>}
        </fieldset>
        <div className="bulk-dialog-actions"><button type="button" disabled={busy} onClick={close}>Cancel</button><button type="submit" disabled={busy || !valid}>{busy ? 'Applying…' : `Apply to ${selected.length} tasks`}</button></div>
      </form>
      {picker?.kind === 'people' && <AssigneePicker listId={effectiveListId || undefined} currentAssigneeIds={people} anchorRect={picker.rect} onChange={setPeople} onClose={() => setPicker(null)} />}
      {picker?.kind === 'labels' && <LabelPicker listId={effectiveListId || undefined} attachedTagIds={labels.map((l) => l.id)} anchorRect={picker.rect} onDraftToggle={(tag) => setLabels((prev) => prev.some((l) => l.id === tag.id) ? prev.filter((l) => l.id !== tag.id) : [...prev, tag])} onClose={() => setPicker(null)} />}
      {picker?.kind === 'repeat' && <RepeatPicker anchorRect={picker.rect} value={repeat} onChange={(r) => { setRepeat(r); setPicker(null); }} onClose={() => setPicker(null)} />}
    </dialog>, document.body)}
  </>;
}
