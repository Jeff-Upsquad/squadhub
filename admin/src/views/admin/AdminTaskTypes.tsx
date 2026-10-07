'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type {
  TaskType,
  TaskTypeGroup,
  TaskTypeField,
  TaskFieldType,
  TaskTypeFieldOption,
  Role,
  User,
} from '@squadhub/shared';

type SubTab = 'types' | 'apply' | 'usage' | 'templates';
type EntityType = 'space' | 'folder' | 'list' | 'template';

const ENTITY_LABELS: Record<EntityType, string> = {
  space: 'Areas',
  folder: 'Spaces',
  list: 'Lists',
  template: 'Space templates',
};

const ENTITY_HINTS: Record<EntityType, string> = {
  space: 'Areas are the top-level containers. Applying here updates the area task types.',
  folder: 'Spaces (design, editor, …) live inside areas. Inherited by tasks via effective-group lookup.',
  list: 'Lists live inside spaces or directly under areas.',
  template: 'Apply to a space template so every future space created from it inherits this group automatically.',
};

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
  const [search, setSearch] = useState('');
  const [subTab, setSubTab] = useState<SubTab>('types');
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editingTaskType, setEditingTaskType] = useState<TaskType | null>(null);

  const { data: groupsRes, isLoading } = useQuery({
    queryKey: ['admin-task-type-groups'],
    queryFn: () => api.get('/admin/task-type-groups').then((r) => r.data),
  });
  const groups: TaskTypeGroup[] = groupsRes?.data || [];
  const selected = groups.find((g) => g.id === selectedId) || null;

  // Also query all task types so we can pick from existing ones
  const { data: allTypesRes } = useQuery({
    queryKey: ['admin-task-types'],
    queryFn: () => api.get('/admin/task-types').then((r) => r.data),
  });
  const allTypes: TaskType[] = allTypesRes?.data || [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) =>
      g.name.toLowerCase().includes(q) || g.key.toLowerCase().includes(q),
    );
  }, [groups, search]);

  useEffect(() => {
    if (!selectedId && groups.length > 0) {
      const def = groups.find((g) => g.is_default) || groups[0];
      setSelectedId(def.id);
    }
  }, [groups, selectedId]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-task-type-groups'] });
    qc.invalidateQueries({ queryKey: ['admin-task-types'] });
  };

  const createGroup = useMutation({
    mutationFn: (body: any) => api.post('/admin/task-type-groups', body).then((r) => r.data),
    onSuccess: (res) => {
      invalidate();
      setShowGroupForm(false);
      if (res?.data?.id) { setSelectedId(res.data.id); setSubTab('types'); }
    },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to create task type group'),
  });

  const deleteGroup = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/task-type-groups/${id}`),
    onSuccess: () => { invalidate(); setSelectedId(null); },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to delete task type group'),
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Task Type Groups</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Build reusable groups of task types, then apply them to areas, spaces, lists — or to a space
          template so future spaces inherit them automatically. The current task types serve as the default.
        </p>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-foreground-dim">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
          {/* Left: groups directory */}
          <div className="rounded-xl border border-divider bg-surface p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="px-1 text-xs font-semibold uppercase tracking-wider text-foreground-dim">
                Groups ({filtered.length})
              </p>
              <button
                onClick={() => setShowGroupForm((v) => !v)}
                className="rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90"
              >
                + New group
              </button>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search groups…"
              className="mb-2 w-full rounded-lg border border-divider px-3 py-2 text-sm focus:border-ink focus:outline-none"
            />
            {showGroupForm && <NewGroupForm onSubmit={(b) => createGroup.mutate(b)} pending={createGroup.isPending} />}
            <div className="max-h-[60vh] space-y-1 overflow-y-auto">
              {filtered.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setSelectedId(g.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left transition ${
                    selectedId === g.id ? 'bg-ink/10 ring-1 ring-ink' : 'hover:bg-muted'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: g.color }} />
                    <span className="truncate text-sm font-medium">{g.name}</span>
                    {g.is_default && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">DEFAULT</span>
                    )}
                    {g.is_system && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">SYSTEM</span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-foreground-dim">
                    {(g.task_types || []).length} types · applied to {g.usage_count || 0} places
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-foreground-dim">No groups match.</p>
              )}
            </div>
          </div>

          {/* Right: group detail */}
          <div>
            {!selected ? (
              <div className="rounded-xl border border-divider bg-surface p-10 text-center text-sm text-foreground-dim">
                Select a group on the left, or create a new one.
              </div>
            ) : (
              <div className="space-y-5">
                <GroupMetaCard group={selected} onChanged={invalidate} onDelete={() => deleteGroup.mutate(selected.id)} />
                <div className="flex gap-1 border-b border-divider">
                  {([['types', 'Task Types'], ['apply', 'Apply to…'], ['usage', `Applied to (${selected.usage_count || 0})`], ['templates', 'Space templates']] as [SubTab, string][]).map(([t, label]) => (
                    <button
                      key={t}
                      onClick={() => setSubTab(t)}
                      className={`px-4 py-2 text-sm font-medium transition border-b-2 ${
                        subTab === t ? 'border-ink text-foreground' : 'border-transparent text-foreground-muted hover:text-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {subTab === 'types' && (
                  <TypesCard
                    group={selected}
                    allTypes={allTypes}
                    onChanged={invalidate}
                    onEditType={(type) => setEditingTaskType(type)}
                  />
                )}
                {subTab === 'apply' && <ApplyCard group={selected} onChanged={invalidate} />}
                {subTab === 'usage' && <UsageCard groupId={selected.id} />}
                {subTab === 'templates' && <TemplatesCard selectedGroupId={selected.id} onChanged={invalidate} />}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal to edit full task type (custom fields, access, details) */}
      {editingTaskType && (
        <EditTaskTypeModal
          typeId={editingTaskType.id}
          onClose={() => setEditingTaskType(null)}
          onChanged={() => {
            invalidate();
            setEditingTaskType(null);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// New group form
// ============================================================
function NewGroupForm({ onSubmit, pending }: { onSubmit: (b: any) => void; pending: boolean }) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#3b82f6');

  return (
    <form
      className="mb-2 space-y-2 rounded-lg border border-divider p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const finalKey = (key || slugify(name)).trim();
        if (!name.trim() || !finalKey) { alert('Name and key are required'); return; }
        onSubmit({ key: finalKey, name: name.trim(), description: description.trim() || null, color });
      }}
    >
      <input
        value={name}
        onChange={(e) => { setName(e.target.value); if (!key) setKey(slugify(e.target.value)); }}
        placeholder="Group name (e.g. Software Dev)"
        className="w-full rounded-lg border border-divider px-3 py-2 text-sm focus:border-ink focus:outline-none"
      />
      <div className="flex gap-2">
        <input
          value={key}
          onChange={(e) => setKey(slugify(e.target.value))}
          placeholder="key (e.g. software_dev)"
          className="flex-1 rounded-lg border border-divider px-3 py-2 font-mono text-xs focus:border-ink focus:outline-none"
        />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-10 cursor-pointer rounded border border-divider"
          title="Group color"
        />
      </div>
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="w-full rounded-lg border border-divider px-3 py-2 text-sm focus:border-ink focus:outline-none"
      />
      <button
        disabled={pending}
        className="w-full rounded-lg bg-ink py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create group'}
      </button>
    </form>
  );
}

// ============================================================
// Group meta card
// ============================================================
function GroupMetaCard({ group, onChanged, onDelete }: { group: TaskTypeGroup; onChanged: () => void; onDelete: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || '');
  const [color, setColor] = useState(group.color);

  useEffect(() => {
    setName(group.name);
    setDescription(group.description || '');
    setColor(group.color);
    setEditing(false);
  }, [group.id]);

  const save = useMutation({
    mutationFn: () => api.put(`/admin/task-type-groups/${group.id}`, { name, description: description || null, color }),
    onSuccess: () => { onChanged(); setEditing(false); },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to update group'),
  });
  const toggleEnabled = useMutation({
    mutationFn: () => api.put(`/admin/task-type-groups/${group.id}/enabled`, { is_enabled: !group.is_enabled }),
    onSuccess: onChanged,
  });
  const setDefault = useMutation({
    mutationFn: () => api.put(`/admin/task-type-groups/${group.id}/default`),
    onSuccess: () => { onChanged(); qc.invalidateQueries({ queryKey: ['admin-task-type-groups'] }); },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to set default'),
  });

  return (
    <div className="rounded-xl border border-divider bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="h-4 w-4 rounded-full" style={{ background: group.color }} />
        {editing ? (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-divider px-3 py-1.5 text-sm font-semibold focus:border-ink focus:outline-none"
            />
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-8 w-9 cursor-pointer rounded border border-divider"
            />
          </>
        ) : (
          <>
            <h2 className="text-base font-bold">{group.name}</h2>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground-dim">{group.key}</code>
          </>
        )}
        <span className="ml-auto flex items-center gap-2">
          {!group.is_default && (
            <button
              onClick={() => setDefault.mutate()}
              className="rounded-lg border border-divider px-2.5 py-1 text-xs hover:bg-muted"
            >
              Set as default
            </button>
          )}
          <button
            onClick={() => toggleEnabled.mutate()}
            className="rounded-lg border border-divider px-2.5 py-1 text-xs hover:bg-muted"
          >
            {group.is_enabled ? 'Disable' : 'Enable'}
          </button>
          {editing ? (
            <>
              <button
                onClick={() => save.mutate()}
                className="rounded-lg bg-ink px-2.5 py-1 text-xs font-medium text-white"
              >
                Save
              </button>
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg border border-divider px-2.5 py-1 text-xs"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg border border-divider px-2.5 py-1 text-xs hover:bg-muted"
            >
              Edit
            </button>
          )}
          {!group.is_system && !group.is_default && (
            <button
              onClick={() => {
                if (confirm(`Delete group “${group.name}”? The task types themselves will be preserved.`)) onDelete();
              }}
              className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          )}
        </span>
      </div>
      {editing ? (
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          className="mt-2 w-full rounded-lg border border-divider px-3 py-1.5 text-sm focus:border-ink focus:outline-none"
        />
      ) : (
        group.description && <p className="mt-1 text-sm text-foreground-muted">{group.description}</p>
      )}
      {!group.is_enabled && (
        <p className="mt-1 text-xs text-amber-600">Disabled — hidden from pickers, falling back to default group.</p>
      )}
    </div>
  );
}

// ============================================================
// TypesCard — manage task types in the group
// ============================================================
function TypesCard({
  group,
  allTypes,
  onChanged,
  onEditType,
}: {
  group: TaskTypeGroup;
  allTypes: TaskType[];
  onChanged: () => void;
  onEditType: (t: TaskType) => void;
}) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedExistingId, setSelectedExistingId] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newColor, setNewColor] = useState('#6b7280');
  const [newIcon, setNewIcon] = useState('check-square');

  const types: TaskType[] = group.task_types || [];
  const existingIdsInGroup = new Set(types.map((t) => t.id));
  const availableToPick = allTypes.filter((t) => !existingIdsInGroup.has(t.id));

  const addType = useMutation({
    mutationFn: (body: any) => api.post(`/admin/task-type-groups/${group.id}/types`, body),
    onSuccess: () => {
      onChanged();
      setShowAddModal(false);
      setSelectedExistingId('');
      setIsCreatingNew(false);
      setNewName('');
      setNewKey('');
      setNewDesc('');
    },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to add task type'),
  });

  const removeType = useMutation({
    mutationFn: (typeId: string) => api.delete(`/admin/task-type-groups/${group.id}/types/${typeId}`),
    onSuccess: onChanged,
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to remove task type'),
  });

  const toggleTypeEnabled = useMutation({
    mutationFn: ({ id, is_enabled }: { id: string; is_enabled: boolean }) =>
      api.put(`/admin/task-types/${id}/enabled`, { is_enabled }),
    onSuccess: onChanged,
  });

  const reorderTypes = useMutation({
    mutationFn: (items: { id: string; position: number }[]) =>
      api.put(`/admin/task-type-groups/${group.id}/types/reorder`, { items }),
    onSuccess: onChanged,
  });

  function move(index: number, direction: -1 | 1) {
    const nextIdx = index + direction;
    if (nextIdx < 0 || nextIdx >= types.length) return;
    const reordered = [...types];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(nextIdx, 0, moved);
    reorderTypes.mutate(reordered.map((t, idx) => ({ id: t.id, position: idx })));
  }

  return (
    <div className="rounded-xl border border-divider bg-surface p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Task Types in this Group ({types.length})</h3>
          <p className="text-xs text-foreground-dim">
            These task types will be presented in areas, spaces, or lists where this group is applied.
          </p>
        </div>
        <button
          onClick={() => { setShowAddModal(true); setIsCreatingNew(false); }}
          className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
        >
          + Add task type
        </button>
      </div>

      {/* Task Types List */}
      <div className="space-y-1.5">
        {types.map((t, idx) => (
          <div
            key={t.id}
            className="flex items-center justify-between rounded-lg border border-divider bg-surface px-3 py-2 text-sm"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="h-3 w-3 rounded-full shrink-0" style={{ background: t.color }} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground truncate">{t.name}</span>
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground-dim">
                    {t.key}
                  </code>
                  {(t.fields || []).length > 0 && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground-dim">
                      {(t.fields || []).length} custom fields
                    </span>
                  )}
                  {t.is_system && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                      SYSTEM
                    </span>
                  )}
                </div>
                {t.description && (
                  <p className="truncate text-xs text-foreground-dim">{t.description}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Order buttons */}
              <button
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                className="rounded px-1.5 py-0.5 text-xs text-foreground-dim hover:text-foreground disabled:opacity-30"
                title="Move up"
              >
                ↑
              </button>
              <button
                onClick={() => move(idx, 1)}
                disabled={idx === types.length - 1}
                className="rounded px-1.5 py-0.5 text-xs text-foreground-dim hover:text-foreground disabled:opacity-30"
                title="Move down"
              >
                ↓
              </button>

              {/* Enabled toggle */}
              <button
                onClick={() => toggleTypeEnabled.mutate({ id: t.id, is_enabled: !t.is_enabled })}
                className={`rounded px-2 py-0.5 text-xs font-medium border border-divider ${
                  t.is_enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-foreground-dim'
                }`}
              >
                {t.is_enabled ? 'Active' : 'Disabled'}
              </button>

              {/* Edit full details & custom fields */}
              <button
                onClick={() => onEditType(t)}
                className="rounded border border-divider px-2 py-0.5 text-xs font-medium hover:bg-muted"
              >
                Edit
              </button>

              {/* Remove from group */}
              <button
                onClick={() => {
                  if (confirm(`Remove “${t.name}” from group “${group.name}”? The task type will remain in the catalog.`)) {
                    removeType.mutate(t.id);
                  }
                }}
                className="rounded border border-red-200 px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                Remove
              </button>
            </div>
          </div>
        ))}

        {types.length === 0 && (
          <p className="py-6 text-center text-xs text-foreground-dim">
            No task types in this group yet. Click &quot;+ Add task type&quot; above to add one.
          </p>
        )}
      </div>

      {/* Add Task Type Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-divider bg-surface p-6 shadow-2xl">
            <h3 className="text-base font-bold text-foreground mb-3">Add Task Type to {group.name}</h3>

            <div className="mb-4 flex gap-2 border-b border-divider pb-2">
              <button
                onClick={() => setIsCreatingNew(false)}
                className={`text-xs font-semibold pb-1 border-b-2 ${
                  !isCreatingNew ? 'border-ink text-foreground' : 'border-transparent text-foreground-dim'
                }`}
              >
                Pick from existing ({availableToPick.length})
              </button>
              <button
                onClick={() => setIsCreatingNew(true)}
                className={`text-xs font-semibold pb-1 border-b-2 ${
                  isCreatingNew ? 'border-ink text-foreground' : 'border-transparent text-foreground-dim'
                }`}
              >
                + Create new task type
              </button>
            </div>

            {!isCreatingNew ? (
              <div className="space-y-3">
                <p className="text-xs text-foreground-muted">
                  Select an existing task type from your catalog to include in this group:
                </p>
                <select
                  value={selectedExistingId}
                  onChange={(e) => setSelectedExistingId(e.target.value)}
                  className="w-full rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-ink focus:outline-none"
                >
                  <option value="">-- Select a task type --</option>
                  {availableToPick.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.key})
                    </option>
                  ))}
                </select>
                {availableToPick.length === 0 && (
                  <p className="text-xs text-amber-600">All existing task types are already in this group.</p>
                )}
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 rounded-lg border border-divider py-2 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={!selectedExistingId}
                    onClick={() => addType.mutate({ task_type_id: selectedExistingId })}
                    className="flex-1 rounded-lg bg-ink py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Add to group
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newName.trim()) return;
                  const finalKey = (newKey || slugify(newName)).trim();
                  addType.mutate({
                    name: newName.trim(),
                    key: finalKey,
                    description: newDesc.trim() || null,
                    color: newColor,
                    icon: newIcon,
                  });
                }}
                className="space-y-3"
              >
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground-muted">Name</label>
                  <input
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value);
                      if (!newKey) setNewKey(slugify(e.target.value));
                    }}
                    required
                    placeholder="e.g. Bug Report"
                    className="w-full rounded-lg border border-divider px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground-muted">Key</label>
                  <input
                    value={newKey}
                    onChange={(e) => setNewKey(slugify(e.target.value))}
                    required
                    placeholder="e.g. bug_report"
                    className="w-full rounded-lg border border-divider px-3 py-1.5 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground-muted">Color</label>
                  <input
                    type="color"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    className="h-8 w-10 cursor-pointer rounded border border-divider"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground-muted">Description</label>
                  <input
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Short description"
                    className="w-full rounded-lg border border-divider px-3 py-1.5 text-sm"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 rounded-lg border border-divider py-2 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-lg bg-ink py-2 text-xs font-semibold text-white"
                  >
                    Create &amp; Add
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// ApplyCard — apply task type group to container
// ============================================================
function ApplyCard({ group, onChanged }: { group: TaskTypeGroup; onChanged: () => void }) {
  const [entityType, setEntityType] = useState<EntityType>('space');
  const [q, setQ] = useState('');

  const { data: searchRes } = useQuery({
    queryKey: ['admin-task-type-group-targets', entityType, q],
    queryFn: () =>
      api.get('/admin/task-type-groups/targets/search', { params: { type: entityType, q } }).then((r) => r.data),
  });
  const targets: { id: string; name: string; detail: string; assigned_group_id: string | null }[] =
    searchRes?.data || [];

  const apply = useMutation({
    mutationFn: (entity_id: string) =>
      api.post(`/admin/task-type-groups/${group.id}/apply`, { entity_type: entityType, entity_id }),
    onSuccess: onChanged,
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to apply group'),
  });

  const unapply = useMutation({
    mutationFn: (entity_id: string) =>
      api.delete(`/admin/task-type-groups/${group.id}/apply`, { data: { entity_type: entityType, entity_id } }),
    onSuccess: onChanged,
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to remove'),
  });

  return (
    <div className="rounded-xl border border-divider bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">Apply “{group.name}” to…</h3>
      <div className="mt-2 flex flex-wrap gap-1">
        {(Object.keys(ENTITY_LABELS) as EntityType[]).map((t) => (
          <button
            key={t}
            onClick={() => { setEntityType(t); setQ(''); }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              entityType === t ? 'bg-ink text-white' : 'border border-divider hover:bg-muted'
            }`}
          >
            {ENTITY_LABELS[t]}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-foreground-dim">{ENTITY_HINTS[entityType]}</p>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${ENTITY_LABELS[entityType].toLowerCase()}…`}
        className="mt-3 w-full rounded-lg border border-divider px-3 py-2 text-sm focus:border-ink focus:outline-none"
      />

      <div className="mt-3 max-h-96 space-y-1.5 overflow-y-auto">
        {targets.map((t) => {
          const isCurrent = t.assigned_group_id === group.id;
          const isOther = t.assigned_group_id && !isCurrent;
          return (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-lg border border-divider px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium text-foreground">{t.name}</p>
                <p className="text-xs text-foreground-dim">{t.detail}</p>
              </div>
              <div>
                {isCurrent ? (
                  <button
                    onClick={() => unapply.mutate(t.id)}
                    className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                  >
                    ✓ Applied (click to remove)
                  </button>
                ) : (
                  <button
                    onClick={() => apply.mutate(t.id)}
                    className="rounded-lg bg-ink px-3 py-1 text-xs font-medium text-white hover:opacity-90"
                  >
                    {isOther ? 'Replace current' : 'Apply'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {targets.length === 0 && (
          <p className="py-6 text-center text-xs text-foreground-dim">No targets match.</p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// UsageCard — where is the group applied?
// ============================================================
function UsageCard({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const { data: usageRes, isLoading } = useQuery({
    queryKey: ['admin-task-type-group-usage', groupId],
    queryFn: () => api.get(`/admin/task-type-groups/${groupId}/usage`).then((r) => r.data),
  });
  const usage: any[] = usageRes?.data || [];

  const unapply = useMutation({
    mutationFn: ({ entity_type, entity_id }: any) =>
      api.delete(`/admin/task-type-groups/${groupId}/apply`, { data: { entity_type, entity_id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-task-type-group-usage', groupId] });
      qc.invalidateQueries({ queryKey: ['admin-task-type-groups'] });
    },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to remove'),
  });

  return (
    <div className="rounded-xl border border-divider bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">Where this group is currently applied</h3>
      <p className="text-xs text-foreground-dim">
        Removing an assignment returns that container to its parent or default task type group.
      </p>

      {isLoading ? (
        <p className="py-6 text-center text-xs text-foreground-dim">Loading…</p>
      ) : usage.length === 0 ? (
        <p className="py-8 text-center text-xs text-foreground-dim">
          Not directly applied anywhere yet. Use &quot;Apply to…&quot; above, or set as default.
        </p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {usage.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between rounded-lg border border-divider px-3 py-2 text-sm"
            >
              <div>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-foreground-dim mr-2">
                  {u.entity_label}
                </span>
                <span className="font-medium text-foreground">{u.entity_name}</span>
                <span className="ml-2 text-xs text-foreground-dim">
                  Applied {new Date(u.created_at).toLocaleDateString()}
                </span>
              </div>
              <button
                onClick={() => unapply.mutate({ entity_type: u.entity_type, entity_id: u.entity_id })}
                className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// TemplatesCard — space templates inheritance
// ============================================================
function TemplatesCard({ selectedGroupId, onChanged }: { selectedGroupId: string; onChanged: () => void }) {
  const { data: tplRes, isLoading } = useQuery({
    queryKey: ['admin-task-type-group-templates'],
    queryFn: () => api.get('/admin/task-type-groups/templates').then((r) => r.data),
  });
  const templates: any[] = tplRes?.data || [];

  const assign = useMutation({
    mutationFn: ({ templateId, groupId }: { templateId: string; groupId: string }) =>
      api.post(`/admin/task-type-groups/${groupId}/apply`, { entity_type: 'template', entity_id: templateId }),
    onSuccess: onChanged,
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to assign'),
  });

  const unassign = useMutation({
    mutationFn: ({ templateId, groupId }: { templateId: string; groupId: string }) =>
      api.delete(`/admin/task-type-groups/${groupId}/apply`, { data: { entity_type: 'template', entity_id: templateId } }),
    onSuccess: onChanged,
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to remove'),
  });

  return (
    <div className="rounded-xl border border-divider bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">Space templates auto-inheritance</h3>
      <p className="text-xs text-foreground-dim">
        When a client space is created from a template (e.g. Developer Space, Designer Space),
        it automatically inherits the assigned task type group.
      </p>

      {isLoading ? (
        <p className="py-6 text-center text-xs text-foreground-dim">Loading…</p>
      ) : templates.length === 0 ? (
        <p className="py-6 text-center text-xs text-foreground-dim">No space templates found.</p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {templates.map((t) => {
            const currentGroup = t.assignment?.task_type_groups || null;
            const isThis = currentGroup?.id === selectedGroupId;
            return (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-lg border border-divider px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium text-foreground">{t.name}</p>
                  <p className="text-xs text-foreground-dim">slug: {t.slug}</p>
                </div>
                <div className="flex items-center gap-2">
                  {currentGroup ? (
                    <span className="flex items-center gap-1.5 rounded-full border border-divider px-2.5 py-0.5 text-xs">
                      <span className="h-2 w-2 rounded-full" style={{ background: currentGroup.color }} />
                      <span>{currentGroup.name}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-foreground-dim">Default group</span>
                  )}
                  {isThis ? (
                    <button
                      onClick={() => unassign.mutate({ templateId: t.id, groupId: selectedGroupId })}
                      className="rounded border border-divider px-2 py-1 text-xs hover:bg-muted"
                    >
                      Clear
                    </button>
                  ) : (
                    <button
                      onClick={() => assign.mutate({ templateId: t.id, groupId: selectedGroupId })}
                      className="rounded bg-ink px-2.5 py-1 text-xs font-medium text-white hover:opacity-90"
                    >
                      Assign this group
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// EditTaskTypeModal — full editor for custom fields, access, details
// ============================================================
function EditTaskTypeModal({
  typeId,
  onClose,
  onChanged,
}: {
  typeId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const { data: typesRes } = useQuery({
    queryKey: ['admin-task-types'],
    queryFn: () => api.get('/admin/task-types').then((r) => r.data),
  });
  const types: TaskType[] = typesRes?.data || [];
  const type = types.find((t) => t.id === typeId);

  const [activeTab, setActiveTab] = useState<'details' | 'fields' | 'access'>('details');
  const [showFieldForm, setShowFieldForm] = useState(false);
  const [editingField, setEditingField] = useState<TaskTypeField | null>(null);

  // Detail edits
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('check-square');
  const [color, setColor] = useState('#6b7280');

  useEffect(() => {
    if (type) {
      setName(type.name);
      setDescription(type.description || '');
      setIcon(type.icon || 'check-square');
      setColor(type.color || '#6b7280');
    }
  }, [type]);

  const updateType = useMutation({
    mutationFn: (body: any) => api.put(`/admin/task-types/${typeId}`, body),
    onSuccess: () => {
      onChanged();
      alert('Task type updated');
    },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to update task type'),
  });

  const createField = useMutation({
    mutationFn: (body: any) => api.post(`/admin/task-types/${typeId}/fields`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-task-types'] });
      setShowFieldForm(false);
    },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to create field'),
  });

  const updateField = useMutation({
    mutationFn: ({ id, ...body }: any) => api.put(`/admin/task-types/${typeId}/fields/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-task-types'] });
      setShowFieldForm(false);
      setEditingField(null);
    },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to update field'),
  });

  const deleteField = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/task-types/${typeId}/fields/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-task-types'] }),
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to delete field'),
  });

  const addRoleAccess = useMutation({
    mutationFn: (role_id: string) => api.post(`/admin/task-types/${typeId}/roles`, { role_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-task-types'] }),
  });

  const removeRoleAccess = useMutation({
    mutationFn: (role_id: string) => api.delete(`/admin/task-types/${typeId}/roles/${role_id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-task-types'] }),
  });

  const addUserAccess = useMutation({
    mutationFn: (user_id: string) => api.post(`/admin/task-types/${typeId}/users`, { user_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-task-types'] }),
  });

  const removeUserAccess = useMutation({
    mutationFn: (user_id: string) => api.delete(`/admin/task-types/${typeId}/users/${user_id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-task-types'] }),
  });

  if (!type) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-divider bg-surface p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-divider pb-3">
          <div className="flex items-center gap-2">
            <span className="h-3.5 w-3.5 rounded-full" style={{ background: type.color }} />
            <h2 className="text-base font-bold text-foreground">{type.name}</h2>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground-dim">{type.key}</code>
          </div>
          <button onClick={onClose} className="rounded p-1 text-foreground-dim hover:text-foreground">✕</button>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex gap-2 border-b border-divider pb-2">
          <button
            onClick={() => setActiveTab('details')}
            className={`text-xs font-semibold pb-1 border-b-2 ${
              activeTab === 'details' ? 'border-ink text-foreground' : 'border-transparent text-foreground-dim'
            }`}
          >
            General Details
          </button>
          <button
            onClick={() => setActiveTab('fields')}
            className={`text-xs font-semibold pb-1 border-b-2 ${
              activeTab === 'fields' ? 'border-ink text-foreground' : 'border-transparent text-foreground-dim'
            }`}
          >
            Custom Fields ({(type.fields || []).length})
          </button>
          <button
            onClick={() => setActiveTab('access')}
            className={`text-xs font-semibold pb-1 border-b-2 ${
              activeTab === 'access' ? 'border-ink text-foreground' : 'border-transparent text-foreground-dim'
            }`}
          >
            Access Permissions
          </button>
        </div>

        {activeTab === 'details' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateType.mutate({
                name: name.trim(),
                description: description.trim() || null,
                icon,
                color,
              });
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground-muted">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full rounded-lg border border-divider px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground-muted">Color</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="h-9 w-10 cursor-pointer rounded border border-divider"
                  />
                  <input
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="flex-1 rounded-lg border border-divider px-2 py-1.5 font-mono text-xs"
                  />
                </div>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground-muted">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-divider px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-divider px-4 py-2 text-xs font-semibold"
              >
                Close
              </button>
              <button
                type="submit"
                className="rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-white"
              >
                Save Changes
              </button>
            </div>
          </form>
        )}

        {activeTab === 'fields' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-foreground-muted">Custom fields prompt assignees for extra details on tasks.</p>
              <button
                onClick={() => { setEditingField(null); setShowFieldForm(true); }}
                className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              >
                + Add Custom Field
              </button>
            </div>

            <div className="space-y-1.5">
              {(type.fields || []).map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between rounded-lg border border-divider px-3 py-2 text-sm"
                >
                  <div>
                    <span className="font-medium text-foreground">{f.label}</span>
                    <span className="ml-2 font-mono text-xs text-foreground-dim">({f.key})</span>
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground-dim">
                      {FIELD_TYPE_LABELS[f.field_type] || f.field_type}
                    </span>
                    {f.is_required && (
                      <span className="ml-1 text-[10px] font-semibold text-red-500">Required</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setEditingField(f); setShowFieldForm(true); }}
                      className="rounded border border-divider px-2 py-0.5 text-xs hover:bg-muted"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete custom field “${f.label}”?`)) deleteField.mutate(f.id);
                      }}
                      className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {(type.fields || []).length === 0 && (
                <p className="py-6 text-center text-xs text-foreground-dim">No custom fields defined yet.</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'access' && (
          <div className="space-y-4">
            <p className="text-xs text-foreground-muted">
              Restrict who can use this task type. If no roles or users are added, it is accessible to all members.
            </p>

            {/* Role Access */}
            <div className="rounded-lg border border-divider p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">Role Access</h4>
                <RolePicker
                  excludeIds={new Set((type.role_access || []).map((r) => r.role_id))}
                  onPick={(roleId) => addRoleAccess.mutate(roleId)}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(type.role_access || []).map((ra) => (
                  <span
                    key={ra.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-divider px-2.5 py-1 text-xs"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ra.role?.color }} />
                    <span>{ra.role?.name}</span>
                    <button
                      onClick={() => removeRoleAccess.mutate(ra.role_id)}
                      className="text-foreground-dim hover:text-red-500"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {(type.role_access || []).length === 0 && (
                  <p className="text-xs text-foreground-dim">No role restrictions (open to all roles)</p>
                )}
              </div>
            </div>

            {/* User Access */}
            <div className="rounded-lg border border-divider p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">Specific User Access</h4>
                <UserPicker
                  excludeIds={new Set((type.user_access || []).map((u) => u.user_id))}
                  onPick={(userId) => addUserAccess.mutate(userId)}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(type.user_access || []).map((ua) => (
                  <span
                    key={ua.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-divider px-2.5 py-1 text-xs"
                  >
                    <span>{ua.user?.display_name || ua.user?.email}</span>
                    <button
                      onClick={() => removeUserAccess.mutate(ua.user_id)}
                      className="text-foreground-dim hover:text-red-500"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {(type.user_access || []).length === 0 && (
                  <p className="text-xs text-foreground-dim">No specific user restrictions</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {showFieldForm && (
        <FieldFormModal
          field={editingField}
          onCancel={() => { setShowFieldForm(false); setEditingField(null); }}
          onSubmit={(body) => {
            if (editingField) {
              updateField.mutate({ id: editingField.id, ...body });
            } else {
              createField.mutate(body);
            }
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// FieldFormModal, RolePicker, UserPicker
// ============================================================
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
