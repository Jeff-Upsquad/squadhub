'use client';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { TaskType, TaskTypeField, TaskFieldType, TaskTypeFieldOption } from '@squadhub/shared';

const FIELD_TYPE_LABELS: Record<TaskFieldType, string> = {
  text: 'Short text',
  textarea: 'Long text',
  select: 'Single-select',
  multi_select: 'Multi-select',
  number: 'Number',
  date: 'Date',
  url: 'URL',
  checkbox: 'Checkbox',
};

const RESERVED_KEYS = new Set(['format', 'audience', 'tone', 'references', 'attachments', 'custom']);

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9_\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/^[^a-z]+/, '');
}

export default function AdminTaskTypes() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showTypeForm, setShowTypeForm] = useState(false);
  const [showFieldForm, setShowFieldForm] = useState(false);
  const [editingField, setEditingField] = useState<TaskTypeField | null>(null);

  const { data: typesRes } = useQuery({
    queryKey: ['admin-task-types'],
    queryFn: () => api.get('/admin/task-types').then((r) => r.data),
  });
  const types: TaskType[] = typesRes?.data || [];
  const selected = types.find((t) => t.id === selectedId) || null;

  useEffect(() => {
    if (!selectedId && types.length > 0) setSelectedId(types[0].id);
  }, [types, selectedId]);

  const createType = useMutation({
    mutationFn: (body: any) => api.post('/admin/task-types', body).then((r) => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin-task-types'] });
      setShowTypeForm(false);
      if (res?.data?.id) setSelectedId(res.data.id);
    },
  });

  const updateType = useMutation({
    mutationFn: ({ id, ...body }: any) => api.put(`/admin/task-types/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-task-types'] }),
  });

  const deleteType = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/task-types/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-task-types'] });
      setSelectedId(null);
    },
    onError: (err: any) => {
      alert(err?.response?.data?.error || 'Failed to delete');
    },
  });

  const setDefault = useMutation({
    mutationFn: (id: string) => api.put(`/admin/task-types/${id}/default`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-task-types'] }),
  });

  const createField = useMutation({
    mutationFn: ({ typeId, ...body }: any) => api.post(`/admin/task-types/${typeId}/fields`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-task-types'] });
      setShowFieldForm(false);
      setEditingField(null);
    },
    onError: (err: any) => {
      alert(err?.response?.data?.error || 'Failed to create field');
    },
  });

  const updateField = useMutation({
    mutationFn: ({ typeId, fieldId, ...body }: any) => api.put(`/admin/task-types/${typeId}/fields/${fieldId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-task-types'] });
      setShowFieldForm(false);
      setEditingField(null);
    },
  });

  const deleteField = useMutation({
    mutationFn: ({ typeId, fieldId }: any) => api.delete(`/admin/task-types/${typeId}/fields/${fieldId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-task-types'] }),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">Task Types</h1>
          <p className="mt-1 text-sm text-[#62748E]">Define the types of tasks teams can create and the custom fields each type exposes.</p>
        </div>
        <button
          onClick={() => setShowTypeForm(true)}
          className="rounded-lg bg-[#0F172B] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D293D]"
        >
          Add Type
        </button>
      </div>

      <div className="flex gap-6">
        {/* Left: types list */}
        <div className="w-72 shrink-0">
          <div className="rounded-xl border border-[#E2E8F0] bg-white">
            {types.length === 0 ? (
              <div className="p-6 text-center text-sm text-[#90A1B9]">No task types yet</div>
            ) : (
              <ul className="p-2">
                {types.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => setSelectedId(t.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition ${
                        selectedId === t.id ? 'bg-[#F1F5F9] text-[#0F172B]' : 'text-[#62748E] hover:bg-[#F8FAFC]'
                      }`}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                      <span className="flex-1 truncate font-medium">{t.name}</span>
                      {t.is_default && (
                        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700">Default</span>
                      )}
                      {t.is_system && (
                        <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">System</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: detail pane */}
        <div className="flex-1 min-w-0 space-y-6">
          {selected ? (
            <>
              <TypeForm
                key={selected.id}
                type={selected}
                onSave={(patch) => updateType.mutate({ id: selected.id, ...patch })}
                onDelete={() => {
                  if (confirm(`Delete "${selected.name}"? Tasks using this type will need to be reassigned.`)) {
                    deleteType.mutate(selected.id);
                  }
                }}
                onSetDefault={() => setDefault.mutate(selected.id)}
              />

              <div className="rounded-xl border border-[#E2E8F0] bg-white p-6">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-[#0F172B]">Custom Fields</h3>
                    <p className="text-xs text-[#62748E]">Extra fields shown when this type of task is opened.</p>
                  </div>
                  <button
                    onClick={() => { setEditingField(null); setShowFieldForm(true); }}
                    className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172B] hover:bg-[#F8FAFC]"
                  >
                    + Add Field
                  </button>
                </div>
                {selected.fields && selected.fields.length > 0 ? (
                  <ul className="space-y-2">
                    {selected.fields.map((f) => (
                      <li
                        key={f.id}
                        className="flex items-center justify-between rounded-lg border border-[#E2E8F0] bg-[#FAFBFC] px-4 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[#0F172B]">{f.label}</span>
                            <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-[#62748E]">{FIELD_TYPE_LABELS[f.field_type]}</span>
                            {f.is_required && <span className="text-[10px] font-medium text-red-500">Required</span>}
                          </div>
                          <div className="mt-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[#90A1B9]">{f.key}</div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setEditingField(f); setShowFieldForm(true); }}
                            className="text-xs text-[#62748E] hover:text-[#0F172B]"
                          >Edit</button>
                          <button
                            onClick={() => { if (confirm(`Delete field "${f.label}"?`)) deleteField.mutate({ typeId: selected.id, fieldId: f.id }); }}
                            className="text-xs text-red-400 hover:text-red-600"
                          >Delete</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="rounded-lg border border-dashed border-[#E2E8F0] py-8 text-center text-xs text-[#90A1B9]">
                    No custom fields yet
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-[#E2E8F0] bg-white p-10 text-center text-sm text-[#90A1B9]">
              Select a task type to edit
            </div>
          )}
        </div>
      </div>

      {showTypeForm && (
        <TypeCreateModal
          onCancel={() => setShowTypeForm(false)}
          onSubmit={(body) => createType.mutate(body)}
        />
      )}

      {showFieldForm && selected && (
        <FieldFormModal
          field={editingField}
          onCancel={() => { setShowFieldForm(false); setEditingField(null); }}
          onSubmit={(body) => {
            if (editingField) {
              updateField.mutate({ typeId: selected.id, fieldId: editingField.id, ...body });
            } else {
              createField.mutate({ typeId: selected.id, ...body });
            }
          }}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Type edit pane
// ----------------------------------------------------------------
function TypeForm({
  type,
  onSave,
  onDelete,
  onSetDefault,
}: {
  type: TaskType;
  onSave: (patch: Partial<TaskType>) => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  const [name, setName] = useState(type.name);
  const [description, setDescription] = useState(type.description || '');
  const [icon, setIcon] = useState(type.icon);
  const [color, setColor] = useState(type.color);

  useEffect(() => {
    setName(type.name);
    setDescription(type.description || '');
    setIcon(type.icon);
    setColor(type.color);
  }, [type.id]);

  const dirty = name !== type.name || description !== (type.description || '') || icon !== type.icon || color !== type.color;

  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#0F172B]">Type Details</h3>
        <div className="flex gap-2">
          {!type.is_default && (
            <button
              onClick={onSetDefault}
              className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172B] hover:bg-[#F8FAFC]"
            >
              Set as default
            </button>
          )}
          {!type.is_system && (
            <button
              onClick={onDelete}
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-[#62748E]">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[#62748E]">Key</label>
          <input
            value={type.key}
            disabled
            className="w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 font-[family-name:var(--font-mono)] text-sm text-[#90A1B9]"
          />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-medium text-[#62748E]">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[#62748E]">Icon</label>
          <input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="lucide icon name"
            className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[#62748E]">Color</label>
          <div className="flex gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-[#E2E8F0]"
            />
            <input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="flex-1 rounded-lg border border-[#E2E8F0] px-3 py-2 font-[family-name:var(--font-mono)] text-sm focus:border-[#0F172B] focus:outline-none"
            />
          </div>
        </div>
      </div>

      {dirty && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => onSave({ name, description: description || null, icon, color })}
            className="rounded-lg bg-[#0F172B] px-4 py-2 text-xs font-medium text-white hover:bg-[#1D293D]"
          >
            Save changes
          </button>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Create type modal
// ----------------------------------------------------------------
function TypeCreateModal({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (body: any) => void;
}) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyDirty, setKeyDirty] = useState(false);
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('check-square');
  const [color, setColor] = useState('#6b7280');

  useEffect(() => {
    if (!keyDirty) setKey(slugify(name));
  }, [name, keyDirty]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ name: name.trim(), key: key.trim(), description: description.trim() || null, icon, color });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-base font-semibold text-[#0F172B]">Add Task Type</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Design Task"
              required
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Key</label>
            <input
              value={key}
              onChange={(e) => { setKey(e.target.value); setKeyDirty(true); }}
              placeholder="design_task"
              required
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 font-[family-name:var(--font-mono)] text-sm focus:border-[#0F172B] focus:outline-none"
            />
            <p className="mt-1 text-[10px] text-[#90A1B9]">Lowercase letters, numbers, and underscores. Cannot be changed later.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[#62748E]">Icon</label>
              <input
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[#62748E]">Color</label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-full cursor-pointer rounded-lg border border-[#E2E8F0]"
              />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onCancel} className="flex-1 rounded-lg border border-[#E2E8F0] py-2 text-sm text-[#62748E] hover:bg-[#F8FAFC]">Cancel</button>
            <button type="submit" className="flex-1 rounded-lg bg-[#0F172B] py-2 text-sm font-medium text-white hover:bg-[#1D293D]">Create</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Field create/edit modal
// ----------------------------------------------------------------
function FieldFormModal({
  field,
  onCancel,
  onSubmit,
}: {
  field: TaskTypeField | null;
  onCancel: () => void;
  onSubmit: (body: any) => void;
}) {
  const [label, setLabel] = useState(field?.label || '');
  const [key, setKey] = useState(field?.key || '');
  const [keyDirty, setKeyDirty] = useState(!!field);
  const [fieldType, setFieldType] = useState<TaskFieldType>(field?.field_type || 'text');
  const [options, setOptions] = useState<TaskTypeFieldOption[]>(field?.options || []);
  const [isRequired, setIsRequired] = useState(field?.is_required ?? false);
  const [helpText, setHelpText] = useState(field?.help_text || '');
  const [placeholder, setPlaceholder] = useState(field?.placeholder || '');

  useEffect(() => {
    if (!keyDirty) setKey(slugify(label));
  }, [label, keyDirty]);

  const showOptions = fieldType === 'select' || fieldType === 'multi_select';
  const keyError = RESERVED_KEYS.has(key) ? `"${key}" is a reserved key` : null;

  function addOption() {
    setOptions((prev) => [...prev, { label: '', value: '' }]);
  }

  function updateOption(idx: number, patch: Partial<TaskTypeFieldOption>) {
    setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  }

  function removeOption(idx: number) {
    setOptions((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (keyError) return;
    const cleanOptions = showOptions
      ? options.filter((o) => o.label.trim() && o.value.trim()).map((o) => ({ label: o.label.trim(), value: o.value.trim() }))
      : [];
    const payload: any = {
      label: label.trim(),
      field_type: fieldType,
      options: cleanOptions,
      is_required: isRequired,
      help_text: helpText.trim() || null,
      placeholder: placeholder.trim() || null,
    };
    if (!field) payload.key = key.trim();
    onSubmit(payload);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-base font-semibold text-[#0F172B]">{field ? 'Edit Field' : 'Add Custom Field'}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[#62748E]">Label</label>
              <input
                autoFocus
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
                className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[#62748E]">Key {field && <span className="text-[10px] text-[#90A1B9]">(read-only)</span>}</label>
              <input
                value={key}
                onChange={(e) => { setKey(e.target.value); setKeyDirty(true); }}
                disabled={!!field}
                required
                className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 font-[family-name:var(--font-mono)] text-sm focus:border-[#0F172B] focus:outline-none disabled:bg-[#F8FAFC] disabled:text-[#90A1B9]"
              />
              {keyError && <p className="mt-1 text-[10px] text-red-500">{keyError}</p>}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Type</label>
            <select
              value={fieldType}
              onChange={(e) => setFieldType(e.target.value as TaskFieldType)}
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
            >
              {(Object.keys(FIELD_TYPE_LABELS) as TaskFieldType[]).map((k) => (
                <option key={k} value={k}>{FIELD_TYPE_LABELS[k]}</option>
              ))}
            </select>
          </div>

          {showOptions && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="block text-xs font-medium text-[#62748E]">Options</label>
                <button type="button" onClick={addOption} className="text-xs text-[#0F172B] hover:underline">+ Add option</button>
              </div>
              <div className="space-y-2">
                {options.length === 0 && <p className="text-xs text-[#90A1B9]">No options yet</p>}
                {options.map((o, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      placeholder="Label"
                      value={o.label}
                      onChange={(e) => updateOption(i, { label: e.target.value, value: o.value || slugify(e.target.value) })}
                      className="flex-1 rounded-lg border border-[#E2E8F0] px-2 py-1.5 text-xs focus:border-[#0F172B] focus:outline-none"
                    />
                    <input
                      placeholder="value"
                      value={o.value}
                      onChange={(e) => updateOption(i, { value: e.target.value })}
                      className="w-28 rounded-lg border border-[#E2E8F0] px-2 py-1.5 font-[family-name:var(--font-mono)] text-xs focus:border-[#0F172B] focus:outline-none"
                    />
                    <button type="button" onClick={() => removeOption(i)} className="text-xs text-red-400 hover:text-red-600">×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[#62748E]">Placeholder</label>
              <input
                value={placeholder}
                onChange={(e) => setPlaceholder(e.target.value)}
                className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[#62748E]">Help text</label>
              <input
                value={helpText}
                onChange={(e) => setHelpText(e.target.value)}
                className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
              />
            </div>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isRequired}
              onChange={(e) => setIsRequired(e.target.checked)}
              className="rounded border-[#CBD5E1]"
            />
            <span className="text-sm text-[#0F172B]">Required field</span>
          </label>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onCancel} className="flex-1 rounded-lg border border-[#E2E8F0] py-2 text-sm text-[#62748E] hover:bg-[#F8FAFC]">Cancel</button>
            <button type="submit" disabled={!!keyError} className="flex-1 rounded-lg bg-[#0F172B] py-2 text-sm font-medium text-white hover:bg-[#1D293D] disabled:opacity-40">{field ? 'Save' : 'Add Field'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
