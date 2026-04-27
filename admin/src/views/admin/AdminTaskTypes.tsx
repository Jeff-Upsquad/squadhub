'use client';
import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { TaskType, TaskTypeField, TaskFieldType, TaskTypeFieldOption, Role, User } from '@squadhub/shared';

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
  const systemTypes = useMemo(() => types.filter((t) => t.is_system), [types]);
  const customTypes = useMemo(() => types.filter((t) => !t.is_system), [types]);
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

  const toggleEnabled = useMutation({
    mutationFn: ({ id, is_enabled }: { id: string; is_enabled: boolean }) =>
      api.put(`/admin/task-types/${id}/enabled`, { is_enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-task-types'] }),
  });

  const deleteType = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/task-types/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-task-types'] });
      setSelectedId(null);
    },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to delete'),
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
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to create field'),
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

  const addRoleAccess = useMutation({
    mutationFn: ({ typeId, role_id }: { typeId: string; role_id: string }) =>
      api.post(`/admin/task-types/${typeId}/roles`, { role_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-task-types'] }),
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to add role'),
  });

  const removeRoleAccess = useMutation({
    mutationFn: ({ typeId, roleId }: { typeId: string; roleId: string }) =>
      api.delete(`/admin/task-types/${typeId}/roles/${roleId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-task-types'] }),
  });

  const addUserAccess = useMutation({
    mutationFn: ({ typeId, user_id }: { typeId: string; user_id: string }) =>
      api.post(`/admin/task-types/${typeId}/users`, { user_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-task-types'] }),
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to add user'),
  });

  const removeUserAccess = useMutation({
    mutationFn: ({ typeId, userId }: { typeId: string; userId: string }) =>
      api.delete(`/admin/task-types/${typeId}/users/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-task-types'] }),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">Task Types</h1>
          <p className="mt-1 text-sm text-[#62748E]">
            Enable or disable hard-coded types. Create custom types and share them with specific roles or users.
          </p>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Left: split sections */}
        <div className="w-72 shrink-0 space-y-5">
          <TypeSection
            title="Hard-coded"
            items={systemTypes}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onToggle={(id, v) => toggleEnabled.mutate({ id, is_enabled: v })}
          />
          <TypeSection
            title="Custom"
            items={customTypes}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onToggle={(id, v) => toggleEnabled.mutate({ id, is_enabled: v })}
            onAdd={() => setShowTypeForm(true)}
            emptyText="No custom types yet"
          />
        </div>

        {/* Right: detail pane */}
        <div className="flex-1 min-w-0 space-y-6">
          {!selected && (
            <div className="rounded-xl border border-dashed border-[#E2E8F0] bg-white p-10 text-center text-sm text-[#90A1B9]">
              Select a task type to view details
            </div>
          )}

          {selected && selected.is_system && (
            <SystemTypeDetail
              type={selected}
              onToggle={(v) => toggleEnabled.mutate({ id: selected.id, is_enabled: v })}
            />
          )}

          {selected && !selected.is_system && (
            <>
              <CustomTypeForm
                key={selected.id}
                type={selected}
                onSave={(patch) => updateType.mutate({ id: selected.id, ...patch })}
                onToggle={(v) => toggleEnabled.mutate({ id: selected.id, is_enabled: v })}
                onDelete={() => {
                  if (confirm(`Delete "${selected.name}"? Tasks using this type will need to be reassigned.`)) {
                    deleteType.mutate(selected.id);
                  }
                }}
                onSetDefault={() => setDefault.mutate(selected.id)}
              />

              <CustomFieldsCard
                type={selected}
                onAddField={() => { setEditingField(null); setShowFieldForm(true); }}
                onEditField={(f) => { setEditingField(f); setShowFieldForm(true); }}
                onDeleteField={(fieldId, label) => {
                  if (confirm(`Delete field "${label}"?`)) deleteField.mutate({ typeId: selected.id, fieldId });
                }}
              />

              <AccessCard
                type={selected}
                onAddRole={(role_id) => addRoleAccess.mutate({ typeId: selected.id, role_id })}
                onRemoveRole={(roleId) => removeRoleAccess.mutate({ typeId: selected.id, roleId })}
                onAddUser={(user_id) => addUserAccess.mutate({ typeId: selected.id, user_id })}
                onRemoveUser={(userId) => removeUserAccess.mutate({ typeId: selected.id, userId })}
              />
            </>
          )}
        </div>
      </div>

      {showTypeForm && (
        <TypeCreateModal
          onCancel={() => setShowTypeForm(false)}
          onSubmit={(body) => createType.mutate(body)}
        />
      )}

      {showFieldForm && selected && !selected.is_system && (
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
// Left section (hard-coded / custom)
// ----------------------------------------------------------------
function TypeSection({
  title, items, selectedId, onSelect, onToggle, onAdd, emptyText,
}: {
  title: string;
  items: TaskType[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string, v: boolean) => void;
  onAdd?: () => void;
  emptyText?: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[#90A1B9]">{title}</h3>
        {onAdd && (
          <button onClick={onAdd} className="text-xs font-medium text-[#0F172B] hover:underline">
            + Add
          </button>
        )}
      </div>
      <div className="rounded-xl border border-[#E2E8F0] bg-white">
        {items.length === 0 ? (
          <div className="p-4 text-center text-xs text-[#90A1B9]">{emptyText || 'None'}</div>
        ) : (
          <ul className="p-2">
            {items.map((t) => (
              <li key={t.id}>
                <div
                  className={`flex items-center gap-2 rounded-md px-2 py-2 transition ${
                    selectedId === t.id ? 'bg-[#F1F5F9]' : 'hover:bg-[#F8FAFC]'
                  }`}
                >
                  <button
                    onClick={() => onSelect(t.id)}
                    className="flex flex-1 items-center gap-2 text-left text-sm"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                    <span className={`flex-1 truncate font-medium ${t.is_enabled ? 'text-[#0F172B]' : 'text-[#90A1B9]'}`}>
                      {t.name}
                    </span>
                    {t.is_default && (
                      <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700">Default</span>
                    )}
                  </button>
                  <Toggle value={t.is_enabled} onChange={(v) => onToggle(t.id, v)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Toggle switch
// ----------------------------------------------------------------
function Toggle({ value, onChange, size = 'sm' }: { value: boolean; onChange: (v: boolean) => void; size?: 'sm' | 'md' }) {
  const w = size === 'md' ? 'w-10 h-5' : 'w-8 h-4';
  const knob = size === 'md' ? 'h-4 w-4' : 'h-3 w-3';
  const offset = size === 'md' ? (value ? 'translate-x-5' : 'translate-x-0.5') : (value ? 'translate-x-4' : 'translate-x-0.5');
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onChange(!value); }}
      className={`relative ${w} shrink-0 rounded-full transition ${value ? 'bg-emerald-500' : 'bg-[#CBD5E1]'}`}
      aria-label={value ? 'Enabled' : 'Disabled'}
    >
      <span className={`absolute top-0.5 ${offset} ${knob} rounded-full bg-white shadow transition`} />
    </button>
  );
}

// ----------------------------------------------------------------
// System (hard-coded) type detail — read-only + enable toggle
// ----------------------------------------------------------------
function SystemTypeDetail({ type, onToggle }: { type: TaskType; onToggle: (v: boolean) => void }) {
  return (
    <>
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: type.color }} />
              <h3 className="text-base font-semibold text-[#0F172B]">{type.name}</h3>
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Hard-coded</span>
              {type.is_default && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Default</span>
              )}
            </div>
            {type.description && <p className="text-sm text-[#62748E]">{type.description}</p>}
            <p className="mt-1 font-[family-name:var(--font-mono)] text-[10px] text-[#90A1B9]">{type.key}</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
            <span className="text-xs font-medium text-[#0F172B]">{type.is_enabled ? 'Enabled' : 'Disabled'}</span>
            <Toggle value={type.is_enabled} onChange={onToggle} size="md" />
          </div>
        </div>
        <p className="text-xs text-[#90A1B9]">
          This is a hard-coded type shipped with the app. Name, icon, color, and fields are locked. Only the enable toggle is editable.
        </p>
      </div>

      <div className="rounded-xl border border-[#E2E8F0] bg-white p-6">
        <h3 className="mb-1 text-sm font-semibold text-[#0F172B]">Built-in Fields</h3>
        <p className="mb-4 text-xs text-[#62748E]">Locked — part of the hardcoded definition.</p>
        {type.fields && type.fields.length > 0 ? (
          <ul className="space-y-2">
            {type.fields.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded-lg border border-[#E2E8F0] bg-[#FAFBFC] px-4 py-2.5 opacity-80">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#0F172B]">{f.label}</span>
                    <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-[#62748E]">{FIELD_TYPE_LABELS[f.field_type]}</span>
                    {f.is_required && <span className="text-[10px] font-medium text-red-500">Required</span>}
                  </div>
                  <div className="mt-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[#90A1B9]">{f.key}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-[#E2E8F0] py-6 text-center text-xs text-[#90A1B9]">
            No extra fields — only the standard task fields.
          </div>
        )}
      </div>
    </>
  );
}

// ----------------------------------------------------------------
// Custom type form — editable details + enable toggle
// ----------------------------------------------------------------
function CustomTypeForm({
  type, onSave, onToggle, onDelete, onSetDefault,
}: {
  type: TaskType;
  onSave: (patch: Partial<TaskType>) => void;
  onToggle: (v: boolean) => void;
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
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[#0F172B]">Type Details</h3>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5">
            <span className="text-xs font-medium text-[#0F172B]">{type.is_enabled ? 'Enabled' : 'Disabled'}</span>
            <Toggle value={type.is_enabled} onChange={onToggle} />
          </div>
          {!type.is_default && (
            <button
              onClick={onSetDefault}
              className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172B] hover:bg-[#F8FAFC]"
            >
              Set as default
            </button>
          )}
          <button
            onClick={onDelete}
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-[#62748E]">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[#62748E]">Key</label>
          <input value={type.key} disabled
            className="w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 font-[family-name:var(--font-mono)] text-sm text-[#90A1B9]" />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-medium text-[#62748E]">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
            className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[#62748E]">Icon</label>
          <input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="lucide icon name"
            className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[#62748E]">Color</label>
          <div className="flex gap-2">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-[#E2E8F0]" />
            <input value={color} onChange={(e) => setColor(e.target.value)}
              className="flex-1 rounded-lg border border-[#E2E8F0] px-3 py-2 font-[family-name:var(--font-mono)] text-sm focus:border-[#0F172B] focus:outline-none" />
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
// Custom fields card (same behaviour as before, only for custom types)
// ----------------------------------------------------------------
function CustomFieldsCard({
  type, onAddField, onEditField, onDeleteField,
}: {
  type: TaskType;
  onAddField: () => void;
  onEditField: (f: TaskTypeField) => void;
  onDeleteField: (fieldId: string, label: string) => void;
}) {
  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[#0F172B]">Custom Fields</h3>
          <p className="text-xs text-[#62748E]">Extra fields shown when this type of task is opened.</p>
        </div>
        <button
          onClick={onAddField}
          className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172B] hover:bg-[#F8FAFC]"
        >
          + Add Field
        </button>
      </div>
      {type.fields && type.fields.length > 0 ? (
        <ul className="space-y-2">
          {type.fields.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded-lg border border-[#E2E8F0] bg-[#FAFBFC] px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[#0F172B]">{f.label}</span>
                  <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-[#62748E]">{FIELD_TYPE_LABELS[f.field_type]}</span>
                  {f.is_required && <span className="text-[10px] font-medium text-red-500">Required</span>}
                </div>
                <div className="mt-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[#90A1B9]">{f.key}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => onEditField(f)} className="text-xs text-[#62748E] hover:text-[#0F172B]">Edit</button>
                <button onClick={() => onDeleteField(f.id, f.label)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
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
  );
}

// ----------------------------------------------------------------
// Access card (custom types only): roles + users sharing
// ----------------------------------------------------------------
function AccessCard({
  type, onAddRole, onRemoveRole, onAddUser, onRemoveUser,
}: {
  type: TaskType;
  onAddRole: (roleId: string) => void;
  onRemoveRole: (roleId: string) => void;
  onAddUser: (userId: string) => void;
  onRemoveUser: (userId: string) => void;
}) {
  const roleAccess = type.role_access || [];
  const userAccess = type.user_access || [];
  const hasShares = roleAccess.length + userAccess.length > 0;

  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-white p-6">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[#0F172B]">Access</h3>
        <p className="text-xs text-[#62748E]">
          Who can create tasks with this type. If empty, only admins can use it.
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-[#62748E]">Roles</span>
            <RolePicker
              excludeIds={new Set(roleAccess.map((r) => r.role_id))}
              onPick={(id) => onAddRole(id)}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {roleAccess.length === 0 && (
              <span className="text-xs text-[#90A1B9]">No roles shared</span>
            )}
            {roleAccess.map((ra) => (
              <Chip
                key={ra.id}
                color={ra.role?.color || '#6b7280'}
                label={ra.role?.name || ra.role_id.slice(0, 6)}
                onRemove={() => onRemoveRole(ra.role_id)}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-[#62748E]">Users</span>
            <UserPicker
              excludeIds={new Set(userAccess.map((u) => u.user_id))}
              onPick={(id) => onAddUser(id)}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {userAccess.length === 0 && (
              <span className="text-xs text-[#90A1B9]">No users shared</span>
            )}
            {userAccess.map((ua) => (
              <Chip
                key={ua.id}
                label={ua.user?.display_name || ua.user?.email || ua.user_id.slice(0, 6)}
                onRemove={() => onRemoveUser(ua.user_id)}
              />
            ))}
          </div>
        </div>
      </div>

      {!hasShares && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Not shared with anyone yet — only admins can use this type.
        </p>
      )}
    </div>
  );
}

function Chip({ color, label, onRemove }: { color?: string; label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs text-[#0F172B]">
      {color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
      <span>{label}</span>
      <button onClick={onRemove} className="text-[#CAD5E2] hover:text-red-500" aria-label="Remove">×</button>
    </span>
  );
}

// ----------------------------------------------------------------
// Role picker — popover
// ----------------------------------------------------------------
function RolePicker({ excludeIds, onPick }: { excludeIds: Set<string>; onPick: (roleId: string) => void }) {
  const [open, setOpen] = useState(false);
  const { data: rolesRes } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api.get('/admin/roles').then((r) => r.data),
    enabled: open,
  });
  const roles: Role[] = rolesRes?.data || [];
  const available = roles.filter((r) => !excludeIds.has(r.id));

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-medium text-[#0F172B] hover:bg-[#F8FAFC]"
      >
        + Add role
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-lg border border-[#E2E8F0] bg-white shadow-lg">
            <div className="max-h-64 overflow-y-auto p-1">
              {available.length === 0 && (
                <div className="px-3 py-2 text-xs text-[#90A1B9]">All roles already added</div>
              )}
              {available.map((r) => (
                <button
                  key={r.id}
                  onClick={() => { onPick(r.id); setOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[#F8FAFC]"
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
                  <span className="flex-1 truncate text-[#0F172B]">{r.name}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// User picker — popover with search
// ----------------------------------------------------------------
function UserPicker({ excludeIds, onPick }: { excludeIds: Set<string>; onPick: (userId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const { data: usersRes } = useQuery({
    queryKey: ['admin-users-search', query],
    queryFn: () => api.get(`/admin/users?search=${encodeURIComponent(query)}&limit=20`).then((r) => r.data),
    enabled: open,
  });
  const users: User[] = usersRes?.data || [];
  const available = users.filter((u) => !excludeIds.has(u.id));

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-medium text-[#0F172B] hover:bg-[#F8FAFC]"
      >
        + Add user
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-72 overflow-hidden rounded-lg border border-[#E2E8F0] bg-white shadow-lg">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users…"
              className="w-full border-b border-[#E2E8F0] px-3 py-2 text-xs outline-none"
            />
            <div className="max-h-64 overflow-y-auto p-1">
              {available.length === 0 && (
                <div className="px-3 py-2 text-xs text-[#90A1B9]">{query ? 'No matches' : 'Start typing to search'}</div>
              )}
              {available.map((u) => (
                <button
                  key={u.id}
                  onClick={() => { onPick(u.id); setOpen(false); setQuery(''); }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[#F8FAFC]"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#0F172B]">
                    {(u.display_name || u.email)?.[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-[#0F172B]">{u.display_name || u.email}</div>
                    {u.display_name && <div className="truncate text-[10px] text-[#90A1B9]">{u.email}</div>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Create custom type modal
// ----------------------------------------------------------------
function TypeCreateModal({
  onCancel, onSubmit,
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
        <h3 className="mb-4 text-base font-semibold text-[#0F172B]">Add Custom Task Type</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Name</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Legal Review" required
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Key</label>
            <input value={key} onChange={(e) => { setKey(e.target.value); setKeyDirty(true); }} placeholder="legal_review" required
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 font-[family-name:var(--font-mono)] text-sm focus:border-[#0F172B] focus:outline-none" />
            <p className="mt-1 text-[10px] text-[#90A1B9]">Lowercase letters, numbers, and underscores. Cannot be changed later.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[#62748E]">Icon</label>
              <input value={icon} onChange={(e) => setIcon(e.target.value)}
                className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[#62748E]">Color</label>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                className="h-10 w-full cursor-pointer rounded-lg border border-[#E2E8F0]" />
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
// Field create/edit modal (unchanged)
// ----------------------------------------------------------------
function FieldFormModal({
  field, onCancel, onSubmit,
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
  const [helpUrl, setHelpUrl] = useState(field?.help_url || '');
  const [allowOther, setAllowOther] = useState(field?.allow_other ?? false);
  const [placeholder, setPlaceholder] = useState(field?.placeholder || '');

  useEffect(() => {
    if (!keyDirty) setKey(slugify(label));
  }, [label, keyDirty]);

  const showOptions = fieldType === 'select' || fieldType === 'multi_select';
  const keyError = RESERVED_KEYS.has(key) ? `"${key}" is a reserved key` : null;

  function addOption() { setOptions((prev) => [...prev, { label: '', value: '' }]); }
  function updateOption(idx: number, patch: Partial<TaskTypeFieldOption>) {
    setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  }
  function removeOption(idx: number) { setOptions((prev) => prev.filter((_, i) => i !== idx)); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (keyError) return;
    const cleanOptions = showOptions
      ? options.filter((o) => o.label.trim() && o.value.trim()).map((o) => ({ label: o.label.trim(), value: o.value.trim() }))
      : [];
    const payload: any = {
      label: label.trim(), field_type: fieldType, options: cleanOptions,
      is_required: isRequired, help_text: helpText.trim() || null,
      help_url: helpUrl.trim() || null,
      allow_other: showOptions ? allowOther : false,
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
              <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} required
                className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[#62748E]">Key {field && <span className="text-[10px] text-[#90A1B9]">(read-only)</span>}</label>
              <input value={key} onChange={(e) => { setKey(e.target.value); setKeyDirty(true); }} disabled={!!field} required
                className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 font-[family-name:var(--font-mono)] text-sm focus:border-[#0F172B] focus:outline-none disabled:bg-[#F8FAFC] disabled:text-[#90A1B9]" />
              {keyError && <p className="mt-1 text-[10px] text-red-500">{keyError}</p>}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Type</label>
            <select value={fieldType} onChange={(e) => setFieldType(e.target.value as TaskFieldType)}
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none">
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
                    <input placeholder="Label" value={o.label}
                      onChange={(e) => updateOption(i, { label: e.target.value, value: o.value || slugify(e.target.value) })}
                      className="flex-1 rounded-lg border border-[#E2E8F0] px-2 py-1.5 text-xs focus:border-[#0F172B] focus:outline-none" />
                    <input placeholder="value" value={o.value} onChange={(e) => updateOption(i, { value: e.target.value })}
                      className="w-28 rounded-lg border border-[#E2E8F0] px-2 py-1.5 font-[family-name:var(--font-mono)] text-xs focus:border-[#0F172B] focus:outline-none" />
                    <button type="button" onClick={() => removeOption(i)} className="text-xs text-red-400 hover:text-red-600">×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[#62748E]">Placeholder</label>
              <input value={placeholder} onChange={(e) => setPlaceholder(e.target.value)}
                className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[#62748E]">Help text</label>
              <input value={helpText} onChange={(e) => setHelpText(e.target.value)}
                className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Help link URL <span className="text-[10px] text-[#90A1B9]">(opens in new tab next to the field)</span></label>
            <input value={helpUrl} onChange={(e) => setHelpUrl(e.target.value)} placeholder="/help/social-sizes or https://…"
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none" />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} className="rounded border-[#CBD5E1]" />
            <span className="text-sm text-[#0F172B]">Required field</span>
          </label>
          {showOptions && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={allowOther} onChange={(e) => setAllowOther(e.target.checked)} className="rounded border-[#CBD5E1]" />
              <span className="text-sm text-[#0F172B]">Allow &quot;Other&quot; (reveals a free-text input when selected)</span>
            </label>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onCancel} className="flex-1 rounded-lg border border-[#E2E8F0] py-2 text-sm text-[#62748E] hover:bg-[#F8FAFC]">Cancel</button>
            <button type="submit" disabled={!!keyError} className="flex-1 rounded-lg bg-[#0F172B] py-2 text-sm font-medium text-white hover:bg-[#1D293D] disabled:opacity-40">{field ? 'Save' : 'Add Field'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
