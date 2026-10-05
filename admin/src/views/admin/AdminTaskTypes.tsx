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

const COMMON_ICONS = [
  'check-square', 'check-circle-2', 'code', 'test-tube', 'bug', 'layout',
  'clock', 'target', 'calendar-range', 'repeat', 'compass', 'car', 'plane',
  'briefcase', 'users', 'phone', 'video', 'calendar', 'lightbulb',
  'book-open', 'search', 'palette', 'zap', 'trophy', 'home', 'sparkles',
  'clipboard-check', 'pause-circle', 'archive',
];

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
  const [search, setSearch] = useState('');
  const [showTypeForm, setShowTypeForm] = useState(false);
  const [preselectedGroup, setPreselectedGroup] = useState<string | null>(null);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [movingToGroup, setMovingToGroup] = useState<string | null>(null);
  const [showFieldForm, setShowFieldForm] = useState(false);
  const [editingField, setEditingField] = useState<TaskTypeField | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const { data: typesRes } = useQuery({
    queryKey: ['admin-task-types'],
    queryFn: () => api.get('/admin/task-types').then((r) => r.data),
  });
  const types: TaskType[] = typesRes?.data || [];
  const selected = types.find((t) => t.id === selectedId) || null;

  const existingGroups = useMemo(() => {
    const set = new Set<string>();
    for (const t of types) {
      if (t.group_name && t.group_name.trim()) set.add(t.group_name.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [types]);

  useEffect(() => {
    if (!selectedId && types.length > 0) setSelectedId(types[0].id);
  }, [types, selectedId]);

  const createType = useMutation({
    mutationFn: (body: any) => api.post('/admin/task-types', body).then((r) => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin-task-types'] });
      setShowTypeForm(false);
      setPreselectedGroup(null);
      if (res?.data?.id) setSelectedId(res.data.id);
    },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to create task type'),
  });

  const updateType = useMutation({
    mutationFn: ({ id, ...body }: any) => api.put(`/admin/task-types/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-task-types'] }),
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to update task type'),
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
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to delete task type'),
  });

  const setDefault = useMutation({
    mutationFn: (id: string) => api.put(`/admin/task-types/${id}/default`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-task-types'] }),
  });

  const renameGroup = useMutation({
    mutationFn: ({ old_name, new_name }: { old_name: string; new_name: string }) =>
      api.put('/admin/task-types/groups/rename', { old_name, new_name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-task-types'] });
      setRenamingGroup(null);
    },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to rename group'),
  });

  const assignGroup = useMutation({
    mutationFn: ({ group_name, task_type_ids }: { group_name: string; task_type_ids: string[] }) =>
      api.put('/admin/task-types/groups/assign', { group_name, task_type_ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-task-types'] });
      setMovingToGroup(null);
      setShowGroupForm(false);
    },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to update group'),
  });

  const toggleGroupEnabled = useMutation({
    mutationFn: ({
      group_name,
      task_type_ids,
      is_enabled,
    }: {
      group_name?: string;
      task_type_ids: string[];
      is_enabled: boolean;
    }) =>
      api.put('/admin/task-types/groups/enabled', { group_name, task_type_ids, is_enabled }),
    onMutate: async ({ task_type_ids, is_enabled }) => {
      await qc.cancelQueries({ queryKey: ['admin-task-types'] });
      const previousData = qc.getQueryData(['admin-task-types']);
      qc.setQueryData(['admin-task-types'], (old: any) => {
        if (!old?.data) return old;
        const targetIds = new Set(task_type_ids);
        return {
          ...old,
          data: old.data.map((t: TaskType) =>
            targetIds.has(t.id) ? { ...t, is_enabled } : t
          ),
        };
      });
      return { previousData };
    },
    onError: (err: any, _vars, context: any) => {
      if (context?.previousData) {
        qc.setQueryData(['admin-task-types'], context.previousData);
      }
      alert(err?.response?.data?.error || 'Failed to toggle group');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['admin-task-types'] });
    },
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

  // Filtered task types
  const filteredTypes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return types;
    return types.filter((t) =>
      (t.name || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (t.group_name || '').toLowerCase().includes(q) ||
      (t.key || '').toLowerCase().includes(q)
    );
  }, [types, search]);

  // Grouped task types
  const groupedData = useMemo(() => {
    const map = new Map<string, TaskType[]>();
    for (const t of filteredTypes) {
      const g = (t.group_name && t.group_name.trim()) || 'Other';
      const list = map.get(g) || [];
      list.push(t);
      map.set(g, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Task Types') return -1;
      if (b === 'Task Types') return 1;
      if (a === 'Software Development') return -1;
      if (b === 'Software Development') return 1;
      return a.localeCompare(b);
    });
  }, [filteredTypes]);

  const toggleGroupCollapse = (gName: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [gName]: !prev[gName] }));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-divider pb-5">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">
            Task Types & Groups
          </h1>
          <p className="mt-1 text-sm text-foreground-muted">
            Manage task types, organize them into groups, and configure fields and access permissions.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowGroupForm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-divider bg-surface px-3.5 py-2 text-xs font-semibold text-foreground shadow-sm hover:bg-surface-alt transition"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            + New Group
          </button>
          <button
            onClick={() => { setPreselectedGroup(null); setShowTypeForm(true); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-ink-hover transition"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            + Add Task Type
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Left Column: Grouped Task Types Directory */}
        <div className="w-full lg:w-80 shrink-0 space-y-4">
          <div className="rounded-xl border border-divider bg-surface overflow-hidden shadow-sm">
            {/* Search */}
            <div className="p-3 border-b border-divider bg-surface-alt/40">
              <div className="relative">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search types, keys, or groups..."
                  className="w-full rounded-lg border border-divider bg-surface px-3 py-1.5 text-xs text-foreground placeholder:text-foreground-dim outline-none focus:border-ink transition"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-2.5 top-2 text-xs text-foreground-dim hover:text-foreground"
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-foreground-dim">
                <span>{filteredTypes.length} types in {groupedData.length} groups</span>
                <span className="text-[10px]">Click any type to edit</span>
              </div>
            </div>

            {/* Groups list */}
            {groupedData.length === 0 ? (
              <div className="p-8 text-center text-xs text-foreground-dim">
                No task types found matching &quot;{search}&quot;
              </div>
            ) : (
              <div className="max-h-[calc(100vh-280px)] overflow-y-auto divide-y divide-divider/50">
                {groupedData.map(([groupName, groupItems]) => {
                  const isCollapsed = collapsedGroups[groupName];
                  const fullGroupTypes = types.filter(
                    (t) => ((t.group_name && t.group_name.trim()) || 'Other') === groupName
                  );
                  const groupTypesToToggle = fullGroupTypes.length > 0 ? fullGroupTypes : groupItems;
                  const allGroupEnabled =
                    groupTypesToToggle.length > 0 && groupTypesToToggle.every((t) => t.is_enabled);
                  const someGroupEnabled = groupTypesToToggle.some((t) => t.is_enabled);
                  const isIndeterminate = someGroupEnabled && !allGroupEnabled;
                  const enabledCount = groupTypesToToggle.filter((t) => t.is_enabled).length;

                  const groupToggleTitle = allGroupEnabled
                    ? `Disable all ${groupTypesToToggle.length} task types in ${groupName}`
                    : isIndeterminate
                    ? `${enabledCount} of ${groupTypesToToggle.length} enabled — click to enable all (Alt-click to disable all) in ${groupName}`
                    : `Enable all ${groupTypesToToggle.length} task types in ${groupName}`;

                  const handleToggleGroup = (nextVal: boolean) => {
                    toggleGroupEnabled.mutate({
                      group_name: groupName,
                      task_type_ids: groupTypesToToggle.map((t) => t.id),
                      is_enabled: nextVal,
                    });
                  };

                  const handleGroupToggleClick = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    const nextVal = e.altKey || e.shiftKey ? false : !allGroupEnabled;
                    handleToggleGroup(nextVal);
                  };

                  return (
                    <div key={groupName} className="group/section">
                      {/* Group Header */}
                      <div className="flex items-center justify-between px-3 py-2 bg-surface-alt/60 hover:bg-surface-alt transition">
                        <button
                          onClick={() => toggleGroupCollapse(groupName)}
                          className="flex items-center gap-1.5 text-left text-xs font-semibold text-foreground min-w-0"
                        >
                          <svg
                            className={`h-3 w-3 text-foreground-muted transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                          <span className="truncate">{groupName}</span>
                          <span className="rounded-full bg-surface px-1.5 py-0.2 text-[10px] text-foreground-dim">
                            {groupItems.length}
                          </span>
                        </button>
                        <div className="flex items-center gap-1 shrink-0 opacity-80 hover:opacity-100">
                          <button
                            onClick={() => { setPreselectedGroup(groupName); setShowTypeForm(true); }}
                            title={`Add task type to ${groupName}`}
                            className="rounded p-1 text-[11px] font-medium text-foreground-muted hover:bg-surface hover:text-foreground"
                          >
                            + Add
                          </button>
                          <button
                            onClick={() => setMovingToGroup(groupName)}
                            title={`Add existing task types into ${groupName}`}
                            className="rounded p-1 text-[11px] font-medium text-foreground-muted hover:bg-surface hover:text-foreground"
                          >
                            + Move
                          </button>
                          <button
                            onClick={() => setRenamingGroup(groupName)}
                            title={`Rename ${groupName}`}
                            className="rounded p-1 text-[11px] font-medium text-foreground-dim hover:bg-surface hover:text-foreground"
                          >
                            ✎
                          </button>
                          <div className="mx-0.5 h-3.5 w-px bg-divider" />
                          <Toggle
                            value={allGroupEnabled}
                            indeterminate={isIndeterminate}
                            title={groupToggleTitle}
                            onToggleClick={handleGroupToggleClick}
                            onChange={handleToggleGroup}
                            disabled={groupTypesToToggle.length === 0}
                          />
                        </div>
                      </div>

                      {/* Group Items */}
                      {!isCollapsed && (
                        <ul className="p-1 space-y-0.5">
                          {groupItems.map((t) => {
                            const isSelected = selectedId === t.id;
                            return (
                              <li key={t.id}>
                                <div
                                  className={`flex items-center gap-2 rounded-lg px-2.5 py-2 transition ${
                                    isSelected
                                      ? 'bg-blue-50/70 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200 border border-blue-200/60 dark:border-blue-800/40'
                                      : 'hover:bg-surface-alt/70 text-foreground'
                                  }`}
                                >
                                  <button
                                    onClick={() => setSelectedId(t.id)}
                                    className="flex flex-1 items-center gap-2.5 text-left text-xs min-w-0"
                                  >
                                    <span
                                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                                      style={{ backgroundColor: t.color || '#6b7280' }}
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        <span className={`block truncate font-medium ${t.is_enabled ? '' : 'line-through opacity-50'}`}>
                                          {t.name}
                                        </span>
                                        {t.is_default && (
                                          <span className="rounded bg-emerald-100 dark:bg-emerald-950 px-1 py-0.2 text-[9px] font-medium text-emerald-800 dark:text-emerald-300">
                                            Default
                                          </span>
                                        )}
                                      </div>
                                      <span className="block truncate text-[10px] text-foreground-dim">
                                        {t.key}
                                      </span>
                                    </div>
                                    {!t.is_system && (
                                      <span className="rounded bg-purple-50 dark:bg-purple-950 px-1 py-0.2 text-[9px] font-medium text-purple-700 dark:text-purple-300">
                                        Custom
                                      </span>
                                    )}
                                  </button>
                                  <Toggle
                                    value={t.is_enabled}
                                    onChange={(v) => toggleEnabled.mutate({ id: t.id, is_enabled: v })}
                                  />
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Editable Details & Configuration */}
        <div className="flex-1 min-w-0 space-y-6 w-full">
          {!selected ? (
            <div className="rounded-xl border border-dashed border-divider bg-surface p-12 text-center text-sm text-foreground-dim">
              Select a task type from the list to view and edit its details.
            </div>
          ) : (
            <>
              {/* Type Details Editor (Works for BOTH System & Custom Types) */}
              <TypeDetailForm
                key={selected.id}
                type={selected}
                existingGroups={existingGroups}
                onSave={(patch) => updateType.mutate({ id: selected.id, ...patch })}
                onToggle={(v) => toggleEnabled.mutate({ id: selected.id, is_enabled: v })}
                onDelete={() => {
                  if (confirm(`Delete "${selected.name}"? Tasks currently using this type will need to be reassigned.`)) {
                    deleteType.mutate(selected.id);
                  }
                }}
                onSetDefault={() => setDefault.mutate(selected.id)}
              />

              {/* Built-in Fields or Custom Fields Card */}
              {selected.is_system && selected.fields && selected.fields.length > 0 && (
                <div className="rounded-xl border border-divider bg-surface p-6 shadow-sm">
                  <h3 className="mb-1 text-sm font-semibold text-foreground">Built-in Fields</h3>
                  <p className="mb-4 text-xs text-foreground-muted">Standard fields defined for this system task type.</p>
                  <ul className="space-y-2">
                    {selected.fields.map((f) => (
                      <li key={f.id} className="flex items-center justify-between rounded-lg border border-divider bg-surface-alt px-4 py-2.5">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground">{f.label}</span>
                            <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-foreground-muted">
                              {FIELD_TYPE_LABELS[f.field_type]}
                            </span>
                            {f.is_required && <span className="text-[10px] font-medium text-red-500">Required</span>}
                          </div>
                          <div className="mt-0.5 font-[family-name:var(--font-mono)] text-[10px] text-foreground-dim">{f.key}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Custom Fields Card for custom types */}
              {!selected.is_system && (
                <CustomFieldsCard
                  type={selected}
                  onAddField={() => { setEditingField(null); setShowFieldForm(true); }}
                  onEditField={(f) => { setEditingField(f); setShowFieldForm(true); }}
                  onDeleteField={(fieldId, label) => {
                    if (confirm(`Delete field "${label}"?`)) deleteField.mutate({ typeId: selected.id, fieldId });
                  }}
                />
              )}

              {/* Access Sharing for custom types */}
              {!selected.is_system && (
                <AccessCard
                  type={selected}
                  onAddRole={(role_id) => addRoleAccess.mutate({ typeId: selected.id, role_id })}
                  onRemoveRole={(roleId) => removeRoleAccess.mutate({ typeId: selected.id, roleId })}
                  onAddUser={(user_id) => addUserAccess.mutate({ typeId: selected.id, user_id })}
                  onRemoveUser={(userId) => removeUserAccess.mutate({ typeId: selected.id, userId })}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Modal: Create Task Type */}
      {showTypeForm && (
        <TypeCreateModal
          initialGroup={preselectedGroup}
          existingGroups={existingGroups}
          onCancel={() => { setShowTypeForm(false); setPreselectedGroup(null); }}
          onSubmit={(body) => createType.mutate(body)}
        />
      )}

      {/* Modal: Create New Task Group */}
      {showGroupForm && (
        <GroupCreateModal
          allTypes={types}
          onCancel={() => setShowGroupForm(false)}
          onSubmit={({ groupName, selectedTypeIds }) => {
            if (selectedTypeIds.length > 0) {
              assignGroup.mutate({ group_name: groupName, task_type_ids: selectedTypeIds });
            } else {
              // Open type create modal pre-filled with this group so they can add the first type
              setShowGroupForm(false);
              setPreselectedGroup(groupName);
              setShowTypeForm(true);
            }
          }}
        />
      )}

      {/* Modal: Rename Group */}
      {renamingGroup && (
        <GroupRenameModal
          currentName={renamingGroup}
          onCancel={() => setRenamingGroup(null)}
          onSubmit={(newName) => renameGroup.mutate({ old_name: renamingGroup, new_name: newName })}
        />
      )}

      {/* Modal: Move Existing Types to Group */}
      {movingToGroup && (
        <AddExistingToGroupModal
          targetGroup={movingToGroup}
          allTypes={types}
          onCancel={() => setMovingToGroup(null)}
          onSubmit={(selectedIds) => assignGroup.mutate({ group_name: movingToGroup, task_type_ids: selectedIds })}
        />
      )}

      {/* Modal: Custom Field Form */}
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
// Universal Type Detail Form (Edits Both System & Custom Types)
// ----------------------------------------------------------------
function TypeDetailForm({
  type, existingGroups, onSave, onToggle, onDelete, onSetDefault,
}: {
  type: TaskType;
  existingGroups: string[];
  onSave: (patch: Partial<TaskType>) => void;
  onToggle: (v: boolean) => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  const [name, setName] = useState(type.name);
  const [groupName, setGroupName] = useState(type.group_name || '');
  const [description, setDescription] = useState(type.description || '');
  const [icon, setIcon] = useState(type.icon || 'check-square');
  const [color, setColor] = useState(type.color || '#6b7280');
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    setName(type.name);
    setGroupName(type.group_name || '');
    setDescription(type.description || '');
    setIcon(type.icon || 'check-square');
    setColor(type.color || '#6b7280');
    setIsSaved(false);
  }, [type.id]);

  const dirty =
    name !== type.name ||
    groupName !== (type.group_name || '') ||
    description !== (type.description || '') ||
    icon !== (type.icon || 'check-square') ||
    color !== (type.color || '#6b7280');

  function handleSave() {
    onSave({
      name: name.trim(),
      group_name: groupName.trim() || null,
      description: description.trim() || null,
      icon: icon.trim() || 'check-square',
      color: color.trim() || '#6b7280',
    });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  }

  return (
    <div className="rounded-xl border border-divider bg-surface p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-divider pb-4">
        <div className="flex items-center gap-2.5">
          <span className="h-3.5 w-3.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-foreground">{type.name}</h2>
              {type.is_system ? (
                <span className="rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                  Built-in System Type
                </span>
              ) : (
                <span className="rounded-full bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/50 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:text-purple-400">
                  Custom Type
                </span>
              )}
              {type.is_default && (
                <span className="rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                  Default
                </span>
              )}
            </div>
            <p className="font-[family-name:var(--font-mono)] text-[11px] text-foreground-dim mt-0.5">
              key: {type.key}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-divider bg-surface-alt px-3 py-1.5">
            <span className="text-xs font-medium text-foreground">{type.is_enabled ? 'Enabled' : 'Disabled'}</span>
            <Toggle value={type.is_enabled} onChange={onToggle} />
          </div>
          {!type.is_default && (
            <button
              onClick={onSetDefault}
              className="rounded-lg border border-divider bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-alt transition"
            >
              Set Default
            </button>
          )}
          {!type.is_system && (
            <button
              onClick={onDelete}
              className="rounded-lg border border-red-200 bg-surface px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Name */}
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground-muted">Display Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-foreground focus:border-ink focus:outline-none transition"
          />
        </div>

        {/* Task Group */}
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground-muted">Task Group / Category</label>
          <div className="relative">
            <input
              list="group-datalist-edit"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Software Development"
              className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-foreground focus:border-ink focus:outline-none transition"
            />
            <datalist id="group-datalist-edit">
              {existingGroups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </div>
          <p className="mt-1 text-[10px] text-foreground-dim">
            Assign to an existing group or type a new group name.
          </p>
        </div>

        {/* Description */}
        <div className="col-span-1 md:col-span-2">
          <label className="mb-1 block text-xs font-medium text-foreground-muted">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Helpful guidance shown to users in dropdowns and tooltips"
            className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-foreground focus:border-ink focus:outline-none transition"
          />
        </div>

        {/* Icon */}
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground-muted">Icon Name</label>
          <input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="e.g. code, test-tube, layout, check-square"
            className="w-full rounded-lg border border-divider px-3 py-2 text-sm font-[family-name:var(--font-mono)] text-foreground focus:border-ink focus:outline-none transition"
          />
          <div className="mt-2 flex flex-wrap gap-1">
            {COMMON_ICONS.slice(0, 10).map((ic) => (
              <button
                key={ic}
                type="button"
                onClick={() => setIcon(ic)}
                className={`rounded px-1.5 py-0.5 text-[10px] border transition ${
                  icon === ic
                    ? 'border-ink bg-ink text-white'
                    : 'border-divider bg-surface-alt text-foreground-muted hover:text-foreground'
                }`}
              >
                {ic}
              </button>
            ))}
          </div>
        </div>

        {/* Color */}
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground-muted">Color</label>
          <div className="flex gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-divider"
            />
            <input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="flex-1 rounded-lg border border-divider px-3 py-2 font-[family-name:var(--font-mono)] text-sm text-foreground focus:border-ink focus:outline-none transition"
            />
          </div>
          <div className="mt-2 flex gap-1.5">
            {['#3b82f6', '#0ea5e9', '#10b981', '#8b5cf6', '#ec4899', '#f97316', '#eab308', '#64748b'].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="h-5 w-5 rounded-full border border-black/10 dark:border-white/10 transition hover:scale-110"
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-divider pt-4">
        <p className="text-[11px] text-foreground-dim">
          {type.is_system
            ? 'Admins can customize name, group, description, icon, and color. Core behavior is preserved.'
            : 'Custom task type can be shared with specific roles and users.'}
        </p>
        <div className="flex items-center gap-2">
          {isSaved && (
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              ✓ Saved successfully!
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={!dirty}
            className="rounded-lg bg-ink px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-ink-hover disabled:opacity-40 transition"
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Modal: Create New Task Group
// ----------------------------------------------------------------
function GroupCreateModal({
  allTypes, onCancel, onSubmit,
}: {
  allTypes: TaskType[];
  onCancel: () => void;
  onSubmit: (data: { groupName: string; selectedTypeIds: string[] }) => void;
}) {
  const [groupName, setGroupName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allTypes;
    return allTypes.filter((t) =>
      (t.name || '').toLowerCase().includes(q) ||
      (t.group_name || '').toLowerCase().includes(q)
    );
  }, [allTypes, search]);

  function toggleType(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!groupName.trim()) return;
    onSubmit({ groupName: groupName.trim(), selectedTypeIds: selectedIds });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-2xl border border-divider">
        <div className="mb-4">
          <h3 className="text-base font-bold text-foreground">Create New Task Group</h3>
          <p className="mt-1 text-xs text-foreground-muted">
            Group related task types together (e.g. &quot;Software Development&quot;, &quot;DevOps&quot;, &quot;Customer Support&quot;).
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Group Name</label>
            <input
              autoFocus
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Software Development"
              required
              className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-foreground focus:border-ink focus:outline-none"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-xs font-medium text-foreground-muted">
                Add Task Types to this Group ({selectedIds.length} selected)
              </label>
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="text-xs text-foreground-dim hover:text-foreground"
                >
                  Clear all
                </button>
              )}
            </div>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter existing types..."
              className="w-full rounded-lg border border-divider bg-surface-alt px-3 py-1.5 text-xs text-foreground outline-none focus:border-ink mb-2"
            />

            <div className="max-h-56 overflow-y-auto rounded-lg border border-divider p-2 space-y-1">
              {filtered.map((t) => {
                const checked = selectedIds.includes(t.id);
                return (
                  <label
                    key={t.id}
                    className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs cursor-pointer transition ${
                      checked ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200' : 'hover:bg-surface-alt'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleType(t.id)}
                      className="rounded border-divider"
                    />
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color || '#6b7280' }} />
                    <span className="font-medium flex-1 truncate">{t.name}</span>
                    <span className="text-[10px] text-foreground-dim truncate max-w-[130px]">
                      currently: {t.group_name || 'None'}
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] text-foreground-dim">
              {selectedIds.length === 0
                ? 'Tip: You can create the group now and add new task types directly into it next.'
                : 'Selected task types will be moved into this new group.'}
            </p>
          </div>

          <div className="flex gap-3 pt-3 border-t border-divider">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-lg border border-divider py-2 text-xs font-semibold text-foreground-muted hover:bg-surface-alt transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!groupName.trim()}
              className="flex-1 rounded-lg bg-ink py-2 text-xs font-semibold text-white hover:bg-ink-hover disabled:opacity-40 transition shadow-sm"
            >
              {selectedIds.length > 0 ? 'Create & Move Types' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Modal: Rename Task Group
// ----------------------------------------------------------------
function GroupRenameModal({
  currentName, onCancel, onSubmit,
}: {
  currentName: string;
  onCancel: () => void;
  onSubmit: (newName: string) => void;
}) {
  const [newName, setNewName] = useState(currentName);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || newName.trim() === currentName) return;
    onSubmit(newName.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl border border-divider">
        <h3 className="mb-2 text-base font-bold text-foreground">Rename Task Group</h3>
        <p className="mb-4 text-xs text-foreground-muted">
          This will update the group name for all task types currently in &quot;{currentName}&quot;.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-muted">New Group Name</label>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-foreground focus:border-ink focus:outline-none"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-lg border border-divider py-2 text-xs font-semibold text-foreground-muted hover:bg-surface-alt transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!newName.trim() || newName.trim() === currentName}
              className="flex-1 rounded-lg bg-ink py-2 text-xs font-semibold text-white hover:bg-ink-hover disabled:opacity-40 transition"
            >
              Rename
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Modal: Move / Add Existing Task Types into a Group
// ----------------------------------------------------------------
function AddExistingToGroupModal({
  targetGroup, allTypes, onCancel, onSubmit,
}: {
  targetGroup: string;
  allTypes: TaskType[];
  onCancel: () => void;
  onSubmit: (selectedIds: string[]) => void;
}) {
  const otherTypes = useMemo(
    () => allTypes.filter((t) => (t.group_name || '').trim() !== targetGroup.trim()),
    [allTypes, targetGroup]
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return otherTypes;
    return otherTypes.filter((t) =>
      (t.name || '').toLowerCase().includes(q) ||
      (t.group_name || '').toLowerCase().includes(q)
    );
  }, [otherTypes, search]);

  function toggleType(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedIds.length === 0) return;
    onSubmit(selectedIds);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-2xl border border-divider">
        <h3 className="text-base font-bold text-foreground">
          Add Task Types to &quot;{targetGroup}&quot;
        </h3>
        <p className="mt-1 text-xs text-foreground-muted mb-4">
          Select existing task types from other groups to move into &quot;{targetGroup}&quot;.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search task types..."
            className="w-full rounded-lg border border-divider bg-surface-alt px-3 py-1.5 text-xs text-foreground outline-none focus:border-ink"
          />

          <div className="max-h-60 overflow-y-auto rounded-lg border border-divider p-2 space-y-1">
            {filtered.length === 0 ? (
              <p className="p-4 text-center text-xs text-foreground-dim">No other task types available</p>
            ) : (
              filtered.map((t) => {
                const checked = selectedIds.includes(t.id);
                return (
                  <label
                    key={t.id}
                    className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs cursor-pointer transition ${
                      checked ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200' : 'hover:bg-surface-alt'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleType(t.id)}
                      className="rounded border-divider"
                    />
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color || '#6b7280' }} />
                    <span className="font-medium flex-1 truncate">{t.name}</span>
                    <span className="text-[10px] text-foreground-dim truncate max-w-[140px]">
                      currently: {t.group_name || 'Other'}
                    </span>
                  </label>
                );
              })
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-lg border border-divider py-2 text-xs font-semibold text-foreground-muted hover:bg-surface-alt transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={selectedIds.length === 0}
              className="flex-1 rounded-lg bg-ink py-2 text-xs font-semibold text-white hover:bg-ink-hover disabled:opacity-40 transition shadow-sm"
            >
              Move {selectedIds.length > 0 ? `(${selectedIds.length})` : ''} into {targetGroup}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Modal: Create New Task Type
// ----------------------------------------------------------------
function TypeCreateModal({
  initialGroup, existingGroups, onCancel, onSubmit,
}: {
  initialGroup?: string | null;
  existingGroups: string[];
  onCancel: () => void;
  onSubmit: (body: any) => void;
}) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyDirty, setKeyDirty] = useState(false);
  const [groupName, setGroupName] = useState(initialGroup || '');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('check-square');
  const [color, setColor] = useState('#3b82f6');

  useEffect(() => {
    if (!keyDirty) setKey(slugify(name));
  }, [name, keyDirty]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      key: key.trim(),
      group_name: groupName.trim() || null,
      description: description.trim() || null,
      icon: icon.trim() || 'check-square',
      color: color.trim() || '#6b7280',
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl border border-divider">
        <h3 className="mb-4 text-base font-bold text-foreground">Add Task Type</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Code Review"
              required
              className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-foreground focus:border-ink focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Task Group / Category</label>
            <div className="relative">
              <input
                list="group-datalist-create"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. Software Development"
                className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-foreground focus:border-ink focus:outline-none"
              />
              <datalist id="group-datalist-create">
                {existingGroups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
            <p className="mt-1 text-[10px] text-foreground-dim">
              Select an existing group or type a new one to create it.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Key</label>
            <input
              value={key}
              onChange={(e) => { setKey(e.target.value); setKeyDirty(true); }}
              placeholder="code_review"
              required
              className="w-full rounded-lg border border-divider px-3 py-2 font-[family-name:var(--font-mono)] text-sm text-foreground focus:border-ink focus:outline-none"
            />
            <p className="mt-1 text-[10px] text-foreground-dim">Lowercase letters, numbers, and underscores.</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Brief description for this task type"
              className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-foreground focus:border-ink focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground-muted">Icon</label>
              <input
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="w-full rounded-lg border border-divider px-3 py-2 text-sm font-[family-name:var(--font-mono)] text-foreground focus:border-ink focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground-muted">Color</label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-full cursor-pointer rounded-lg border border-divider"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-3 border-t border-divider">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-lg border border-divider py-2 text-xs font-semibold text-foreground-muted hover:bg-surface-alt transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 rounded-lg bg-ink py-2 text-xs font-semibold text-white hover:bg-ink-hover transition shadow-sm"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Toggle switch
// ----------------------------------------------------------------
function Toggle({
  value,
  onChange,
  onToggleClick,
  size = 'sm',
  indeterminate = false,
  title,
  disabled = false,
}: {
  value: boolean;
  onChange?: (v: boolean) => void;
  onToggleClick?: (e: React.MouseEvent) => void;
  size?: 'sm' | 'md';
  indeterminate?: boolean;
  title?: string;
  disabled?: boolean;
}) {
  const w = size === 'md' ? 'w-10 h-5' : 'w-8 h-4';
  const knob = size === 'md' ? 'h-4 w-4' : 'h-3 w-3';
  const offset = size === 'md'
    ? (indeterminate ? 'translate-x-2.5' : value ? 'translate-x-5' : 'translate-x-0.5')
    : (indeterminate ? 'translate-x-2' : value ? 'translate-x-4' : 'translate-x-0.5');

  const bg = indeterminate
    ? 'bg-amber-500/80 dark:bg-amber-600'
    : value
    ? 'bg-emerald-500'
    : 'bg-well';

  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        if (onToggleClick) {
          onToggleClick(e);
        } else if (onChange) {
          onChange(!value);
        }
      }}
      className={`relative ${w} shrink-0 rounded-full transition ${bg} disabled:opacity-40`}
      aria-label={title || (indeterminate ? 'Partially enabled' : value ? 'Enabled' : 'Disabled')}
    >
      <span className={`absolute top-0.5 ${offset} ${knob} rounded-full bg-surface shadow transition flex items-center justify-center`}>
        {indeterminate && <span className="h-0.5 w-1.5 rounded-full bg-amber-600 dark:bg-amber-400" />}
      </span>
    </button>
  );
}

// ----------------------------------------------------------------
// Custom fields card
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
    <div className="rounded-xl border border-divider bg-surface p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Custom Fields</h3>
          <p className="text-xs text-foreground-muted">Extra fields shown when this type of task is opened.</p>
        </div>
        <button
          onClick={onAddField}
          className="rounded-lg border border-divider bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-alt transition"
        >
          + Add Field
        </button>
      </div>
      {type.fields && type.fields.length > 0 ? (
        <ul className="space-y-2">
          {type.fields.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded-lg border border-divider bg-surface-alt px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{f.label}</span>
                  <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-foreground-muted">
                    {FIELD_TYPE_LABELS[f.field_type]}
                  </span>
                  {f.is_required && <span className="text-[10px] font-medium text-red-500">Required</span>}
                </div>
                <div className="mt-0.5 font-[family-name:var(--font-mono)] text-[10px] text-foreground-dim">{f.key}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => onEditField(f)} className="text-xs text-foreground-muted hover:text-foreground">Edit</button>
                <button onClick={() => onDeleteField(f.id, f.label)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-divider py-8 text-center text-xs text-foreground-dim">
          No custom fields yet
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Access card: roles + users sharing
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
    <div className="rounded-xl border border-divider bg-surface p-6 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">Access Permissions</h3>
        <p className="text-xs text-foreground-muted">
          Who can create tasks with this type. If empty, all admins can use it.
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-foreground-muted">Roles</span>
            <RolePicker
              excludeIds={new Set(roleAccess.map((r) => r.role_id))}
              onPick={(id) => onAddRole(id)}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {roleAccess.length === 0 && (
              <span className="text-xs text-foreground-dim">No specific roles restricted</span>
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
            <span className="text-xs font-medium text-foreground-muted">Users</span>
            <UserPicker
              excludeIds={new Set(userAccess.map((u) => u.user_id))}
              onPick={(id) => onAddUser(id)}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {userAccess.length === 0 && (
              <span className="text-xs text-foreground-dim">No specific users restricted</span>
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
        <p className="mt-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200/50 dark:border-amber-900/50 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          Not restricted to specific roles or users — available to workspace admins.
        </p>
      )}
    </div>
  );
}

function Chip({ color, label, onRemove }: { color?: string; label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-divider bg-surface px-2.5 py-1 text-xs text-foreground">
      {color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
      <span>{label}</span>
      <button onClick={onRemove} className="text-foreground-dim hover:text-red-500" aria-label="Remove">×</button>
    </span>
  );
}

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
        className="rounded-md border border-divider bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-alt transition"
      >
        + Add role
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-lg border border-divider bg-surface shadow-lg">
            <div className="max-h-64 overflow-y-auto p-1">
              {available.length === 0 && (
                <div className="px-3 py-2 text-xs text-foreground-dim">All roles already added</div>
              )}
              {available.map((r) => (
                <button
                  key={r.id}
                  onClick={() => { onPick(r.id); setOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-alt"
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
                  <span className="flex-1 truncate text-foreground">{r.name}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

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
        className="rounded-md border border-divider bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-alt transition"
      >
        + Add user
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-72 overflow-hidden rounded-lg border border-divider bg-surface shadow-lg">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users…"
              className="w-full border-b border-divider px-3 py-2 text-xs outline-none bg-surface text-foreground"
            />
            <div className="max-h-64 overflow-y-auto p-1">
              {available.length === 0 && (
                <div className="px-3 py-2 text-xs text-foreground-dim">{query ? 'No matches' : 'Start typing to search'}</div>
              )}
              {available.map((u) => (
                <button
                  key={u.id}
                  onClick={() => { onPick(u.id); setOpen(false); setQuery(''); }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-alt"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-well text-[10px] font-medium text-foreground">
                    {(u.display_name || u.email)?.[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-foreground">{u.display_name || u.email}</div>
                    {u.display_name && <div className="truncate text-[10px] text-foreground-dim">{u.email}</div>}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-6 shadow-2xl border border-divider">
        <h3 className="mb-4 text-base font-bold text-foreground">{field ? 'Edit Field' : 'Add Custom Field'}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground-muted">Label</label>
              <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} required
                className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-foreground focus:border-ink focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground-muted">Key {field && <span className="text-[10px] text-foreground-dim">(read-only)</span>}</label>
              <input value={key} onChange={(e) => { setKey(e.target.value); setKeyDirty(true); }} disabled={!!field} required
                className="w-full rounded-lg border border-divider px-3 py-2 font-[family-name:var(--font-mono)] text-sm focus:border-ink focus:outline-none disabled:bg-surface-alt disabled:text-foreground-dim" />
              {keyError && <p className="mt-1 text-[10px] text-red-500">{keyError}</p>}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Type</label>
            <select value={fieldType} onChange={(e) => setFieldType(e.target.value as TaskFieldType)}
              className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-foreground focus:border-ink focus:outline-none bg-surface">
              {(Object.keys(FIELD_TYPE_LABELS) as TaskFieldType[]).map((k) => (
                <option key={k} value={k}>{FIELD_TYPE_LABELS[k]}</option>
              ))}
            </select>
          </div>
          {showOptions && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="block text-xs font-medium text-foreground-muted">Options</label>
                <button type="button" onClick={addOption} className="text-xs text-foreground hover:underline">+ Add option</button>
              </div>
              <div className="space-y-2">
                {options.length === 0 && <p className="text-xs text-foreground-dim">No options yet</p>}
                {options.map((o, i) => (
                  <div key={i} className="flex gap-2">
                    <input placeholder="Label" value={o.label}
                      onChange={(e) => updateOption(i, { label: e.target.value, value: o.value || slugify(e.target.value) })}
                      className="flex-1 rounded-lg border border-divider px-2 py-1.5 text-xs text-foreground focus:border-ink focus:outline-none" />
                    <input placeholder="value" value={o.value} onChange={(e) => updateOption(i, { value: e.target.value })}
                      className="w-28 rounded-lg border border-divider px-2 py-1.5 font-[family-name:var(--font-mono)] text-xs text-foreground focus:border-ink focus:outline-none" />
                    <button type="button" onClick={() => removeOption(i)} className="text-xs text-red-400 hover:text-red-600">×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground-muted">Placeholder</label>
              <input value={placeholder} onChange={(e) => setPlaceholder(e.target.value)}
                className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-foreground focus:border-ink focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground-muted">Help text</label>
              <input value={helpText} onChange={(e) => setHelpText(e.target.value)}
                className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-foreground focus:border-ink focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Help link URL <span className="text-[10px] text-foreground-dim">(opens in new tab next to the field)</span></label>
            <input value={helpUrl} onChange={(e) => setHelpUrl(e.target.value)} placeholder="/help/social-sizes or https://…"
              className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-foreground focus:border-ink focus:outline-none" />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} className="rounded border-divider-strong" />
            <span className="text-sm text-foreground">Required field</span>
          </label>
          {showOptions && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={allowOther} onChange={(e) => setAllowOther(e.target.checked)} className="rounded border-divider-strong" />
              <span className="text-sm text-foreground">Allow &quot;Other&quot; (reveals a free-text input when selected)</span>
            </label>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onCancel} className="flex-1 rounded-lg border border-divider py-2 text-xs font-semibold text-foreground-muted hover:bg-surface-alt transition">Cancel</button>
            <button type="submit" disabled={!!keyError} className="flex-1 rounded-lg bg-ink py-2 text-xs font-semibold text-white hover:bg-ink-hover disabled:opacity-40 transition shadow-sm">{field ? 'Save' : 'Add Field'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
