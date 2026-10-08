'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import {
  type StatusGroup,
  type StatusGroupStatus,
  type StatusCategory,
  type SystemStatusPreset,
  isSystemStatus,
  SYSTEM_STATUS_PRESETS,
} from '@squadhub/shared';

type SubTab = 'statuses' | 'apply' | 'usage' | 'templates';
type EntityType = 'space' | 'folder' | 'list' | 'template';

const CATEGORY_LABELS: Record<StatusCategory, string> = {
  todo: 'To do',
  active: 'Active',
  done: 'Done',
  closed: 'Closed',
};

const ENTITY_LABELS: Record<EntityType, string> = {
  space: 'Areas',
  folder: 'Spaces',
  list: 'Lists',
  template: 'Space templates',
};

const ENTITY_HINTS: Record<EntityType, string> = {
  space: 'Areas are the top-level containers. Applying here updates the area board immediately.',
  folder: 'Spaces (design, editor, …) live inside areas. The assignment is recorded and inherited by boards via the effective-group lookup.',
  list: 'Lists live inside spaces or directly under areas.',
  template: 'Apply to a template (e.g. Designer Space) so every future space created from it inherits this group automatically.',
};

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9_\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/^[^a-z]+/, '');
}

export default function AdminStatusGroups() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [subTab, setSubTab] = useState<SubTab>('statuses');
  const [showGroupForm, setShowGroupForm] = useState(false);

  const { data: groupsRes, isLoading } = useQuery({
    queryKey: ['admin-status-groups'],
    queryFn: () => api.get('/admin/status-groups').then((r) => r.data),
  });
  const groups: StatusGroup[] = groupsRes?.data || [];
  const selected = groups.find((g) => g.id === selectedId) || null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) =>
      g.name.toLowerCase().includes(q) || g.key.toLowerCase().includes(q),
    );
  }, [groups, search]);

  useEffect(() => {
    if (!selectedId && groups.length > 0) setSelectedId(groups[0].id);
  }, [groups, selectedId]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-status-groups'] });

  const createGroup = useMutation({
    mutationFn: (body: any) => api.post('/admin/status-groups', body).then((r) => r.data),
    onSuccess: (res) => {
      invalidate();
      setShowGroupForm(false);
      if (res?.data?.id) { setSelectedId(res.data.id); setSubTab('statuses'); }
    },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to create status group'),
  });

  const deleteGroup = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/status-groups/${id}`),
    onSuccess: () => { invalidate(); setSelectedId(null); },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to delete status group'),
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Task Statuses</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Manage system defaults, create independent workflows, or extend Default Task Statuses with local additions. Apply groups to areas, spaces, lists, and templates.
        </p>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-foreground-dim">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
          {/* Left: group directory */}
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
            {showGroupForm && <NewGroupForm defaultGroup={groups.find((g) => g.key === 'task_workflow')} onSubmit={(b) => createGroup.mutate(b)} pending={createGroup.isPending} />}
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
                    <span className="min-w-0 flex-1 text-sm font-medium" title={g.name}>{g.name}</span>
                    {g.is_default && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">DEFAULT</span>
                    )}
                    {g.base_group_id && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">LINKED</span>}
                    {g.is_system && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">SYSTEM</span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-foreground-dim">
                    {(g.statuses || []).length} statuses · applied to {g.usage_count || 0} places
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-foreground-dim">No groups match.</p>
              )}
            </div>
          </div>

          {/* Right: detail */}
          <div>
            {!selected ? (
              <div className="rounded-xl border border-divider bg-surface p-10 text-center text-sm text-foreground-dim">
                Select a group on the left, or create a new one.
              </div>
            ) : (
              <div className="space-y-5">
                <GroupMetaCard defaultGroup={groups.find((g) => g.key === 'task_workflow')} group={selected} onChanged={invalidate} onDelete={() => deleteGroup.mutate(selected.id)} />
                <div className="flex gap-1 border-b border-divider">
                  {([['statuses', 'Statuses'], ['apply', 'Apply to…'], ['usage', `Applied to (${selected.usage_count || 0})`], ['templates', 'Space templates']] as [SubTab, string][]).map(([t, label]) => (
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
                {subTab === 'statuses' && <StatusesCard key={selected.id} group={selected} onChanged={invalidate} />}
                {subTab === 'apply' && <ApplyCard group={selected} onChanged={invalidate} />}
                {subTab === 'usage' && <UsageCard groupId={selected.id} />}
                {subTab === 'templates' && <TemplatesCard selectedGroupId={selected.id} onChanged={invalidate} />}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// New group form
// ============================================================
function NewGroupForm({ defaultGroup, onSubmit, pending }: { defaultGroup?: StatusGroup; onSubmit: (b: any) => void; pending: boolean }) {
  const [linked, setLinked] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#6b7280');

  return (
    <form
      className="mb-2 space-y-2 rounded-lg border border-divider p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const finalKey = (key || slugify(name)).trim();
        if (!name.trim() || !finalKey) { alert('Name and key are required'); return; }
        onSubmit({ key: finalKey, name: name.trim(), description: description.trim(), color, base_group_id: linked ? defaultGroup?.id : null });
      }}
    >
      <label className="block text-xs font-medium">Group type
        <select value={linked ? 'linked' : 'independent'} onChange={(e) => setLinked(e.target.value === 'linked')} className="mt-1 w-full rounded-lg border border-divider px-2 py-2 text-sm">
          <option value="independent">Independent status group</option>
          <option value="linked" disabled={!defaultGroup}>Linked to Default Task Statuses</option>
        </select>
      </label>
      <p className="text-xs text-foreground-dim">{linked ? 'Inherits all default statuses and future edits. Add your own statuses and sections.' : 'Create a separate set of statuses for this workflow.'}</p>
      <input value={name} onChange={(e) => { setName(e.target.value); if (!key) setKey(slugify(e.target.value)); }} placeholder="Group name (e.g. Design Workflow)" className="w-full rounded-lg border border-divider px-3 py-2 text-sm focus:border-ink focus:outline-none" />
      <div className="flex gap-2">
        <input value={key} onChange={(e) => setKey(slugify(e.target.value))} placeholder="key (e.g. design_workflow)" className="flex-1 rounded-lg border border-divider px-3 py-2 font-mono text-xs focus:border-ink focus:outline-none" />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-10 cursor-pointer rounded border border-divider" title="Group color" />
      </div>
      <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" className="w-full rounded-lg border border-divider px-3 py-2 text-sm focus:border-ink focus:outline-none" />
      <button disabled={pending} className="w-full rounded-lg bg-ink py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
        {pending ? 'Creating…' : 'Create group'}
      </button>
    </form>
  );
}

// ============================================================
// Group meta card
// ============================================================
function GroupMetaCard({ defaultGroup, group, onChanged, onDelete }: { defaultGroup?: StatusGroup; group: StatusGroup; onChanged: () => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || '');
  const [color, setColor] = useState(group.color);

  useEffect(() => { setName(group.name); setDescription(group.description || ''); setColor(group.color); setEditing(false); }, [group.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => api.put(`/admin/status-groups/${group.id}`, { name, description: description || null, color }),
    onSuccess: () => { onChanged(); setEditing(false); },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to update group'),
  });
  const toggleEnabled = useMutation({
    mutationFn: () => api.put(`/admin/status-groups/${group.id}/enabled`, { is_enabled: !group.is_enabled }),
    onSuccess: onChanged,
  });
  const changePrimary = useMutation({
    mutationFn: (linked: boolean) => api.put(`/admin/status-groups/${group.id}`, { base_group_id: linked ? defaultGroup?.id : null }),
    onSuccess: onChanged,
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to change primary group'),
  });

  return (
    <div className="rounded-xl border border-divider bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="h-4 w-4 rounded-full" style={{ background: group.color }} />
        {editing ? (
          <>
            <input value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-divider px-3 py-1.5 text-sm font-semibold focus:border-ink focus:outline-none" />
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-9 cursor-pointer rounded border border-divider" />
          </>
        ) : (
          <>
            <h2 className="text-base font-bold">{group.name}</h2>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground-dim">{group.key}</code>
          </>
        )}
        <span className="ml-auto flex items-center gap-2">
          {group.key !== 'task_workflow' && <button onClick={() => toggleEnabled.mutate()} className="rounded-lg border border-divider px-2.5 py-1 text-xs hover:bg-muted">
            {group.is_enabled ? 'Disable' : 'Enable'}
          </button>}
          {editing ? (
            <>
              <button onClick={() => save.mutate()} className="rounded-lg bg-ink px-2.5 py-1 text-xs font-medium text-white">Save</button>
              <button onClick={() => setEditing(false)} className="rounded-lg border border-divider px-2.5 py-1 text-xs">Cancel</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="rounded-lg border border-divider px-2.5 py-1 text-xs hover:bg-muted">Edit</button>
          )}
          {!group.is_system && !group.is_default && (
            <button
              onClick={() => { if (confirm(`Delete “${group.name}”? Places using it keep their current statuses.`)) onDelete(); }}
              className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          )}
        </span>
      </div>
      {editing ? (
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" className="mt-2 w-full rounded-lg border border-divider px-3 py-1.5 text-sm focus:border-ink focus:outline-none" />
      ) : (
        group.description && <p className="mt-1 text-sm text-foreground-muted">{group.description}</p>
      )}
      {group.key !== 'task_workflow' && <label className="mt-3 block text-xs font-medium">Primary status group
        <select value={group.base_group_id ? 'linked' : 'independent'} disabled={changePrimary.isPending} onChange={(e) => changePrimary.mutate(e.target.value === 'linked')} className="ml-2 rounded-lg border border-divider px-2 py-1.5 text-sm">
          <option value="independent">None — independent group</option>
          <option value="linked" disabled={!defaultGroup}>Default Task Statuses</option>
        </select>
      </label>}
      {group.base_group_id && <p className="mt-2 text-xs text-foreground-dim">Default statuses update automatically. Your local additions stay in this group. Switching to independent removes inherited rows from this group.</p>}
      {!group.is_enabled && <p className="mt-1 text-xs text-amber-600">Disabled — hidden from pickers, existing boards keep working.</p>}
    </div>
  );
}

// ============================================================
// Statuses card
// ============================================================
const TASK_SECTIONS = [
  { key: 'priority_urgency', label: 'Priority & Urgency', emoji: '⚡' },
  { key: 'in_motion', label: 'In Motion', emoji: '🏃' },
  { key: 'up_next', label: 'Up Next', emoji: '🎯' },
  { key: 'scheduled_queued', label: 'Scheduled / Queued', emoji: '📅' },
  { key: 'routines', label: 'Routines', emoji: '🔁' },
  { key: 'blocked_paused', label: 'Blocked / Paused', emoji: '⏸️' },
  { key: 'not_started', label: 'Not Started', emoji: '📥' },
  { key: 'done', label: 'Closed', emoji: '✅' },
];

function DeleteStatusModal({
  status,
  group,
  onClose,
  onConfirm,
  isPending,
}: {
  status: StatusGroupStatus;
  group: StatusGroup;
  onClose: () => void;
  onConfirm: (targetStatusId?: string) => void;
  isPending: boolean;
}) {
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');

  const usageQuery = useQuery({
    queryKey: ['status-usage', group.id, status.id],
    queryFn: () => api.get(`/admin/status-groups/${group.id}/statuses/${status.id}/usage`).then((r) => r.data),
  });

  const count: number = usageQuery.data?.count ?? 0;
  const availableReplacements = (group.statuses || []).filter((s) => s.id !== status.id);

  useEffect(() => {
    if (!selectedTargetId && availableReplacements.length > 0) {
      const defaultStatus = availableReplacements.find((s) => s.is_default);
      setSelectedTargetId(defaultStatus ? defaultStatus.id : availableReplacements[0].id);
    }
  }, [availableReplacements, selectedTargetId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => !isPending && onClose()}
      />
      <div className="relative w-full max-w-md rounded-xl border border-divider bg-surface p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-foreground">Delete Status</h3>
            <div className="mt-1 flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: status.color || '#94A3B8' }} />
              <span className="text-sm font-medium text-foreground truncate">{status.name}</span>
            </div>
          </div>
        </div>

        <div className="mt-4">
          {usageQuery.isLoading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-foreground-dim">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Checking tasks using this status…
            </div>
          ) : usageQuery.isError ? (
            <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3 text-xs text-red-600 dark:text-red-400">
              Failed to check task usage.
            </div>
          ) : count > 0 ? (
            <div className="space-y-3">
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 p-3">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                  ⚠️ {count} {count === 1 ? 'task currently has' : 'tasks currently have'} this status.
                </p>
                <p className="mt-1 text-xs text-amber-700/90 dark:text-amber-400/90">
                  Select another status to move {count === 1 ? 'this task' : 'these tasks'} to before deleting:
                </p>
              </div>

              {availableReplacements.length === 0 ? (
                <p className="rounded-lg border border-divider bg-muted px-3 py-2 text-xs text-foreground-muted">
                  This is the only status left in the group. Add another status first so tasks have somewhere to go.
                </p>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-foreground-dim mb-1.5">
                    Change {count === 1 ? 'task' : 'tasks'} to:
                  </label>
                  <select
                    value={selectedTargetId}
                    onChange={(e) => setSelectedTargetId(e.target.value)}
                    disabled={isPending}
                    className="w-full rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-ink focus:outline-none"
                  >
                    {availableReplacements.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.section_label ? `(${s.section_label})` : `(${s.category})`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-foreground-dim">
              Are you sure you want to delete <span className="font-semibold text-foreground">“{status.name}”</span>? No tasks are currently using this status.
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg border border-divider px-3.5 py-1.5 text-xs font-medium text-foreground-dim hover:text-foreground disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isPending || usageQuery.isLoading || usageQuery.isError || (count > 0 && !selectedTargetId)}
            onClick={() => onConfirm(count > 0 ? selectedTargetId : undefined)}
            className="rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
          >
            {isPending ? 'Deleting…' : count > 0 ? 'Change Status & Delete' : 'Delete Status'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusesCard({ group, onChanged }: { group: StatusGroup; onChanged: () => void }) {
  const qc = useQueryClient();
  const isTaskWorkflow = true;
  const canEditSystem = group.key === 'task_workflow';
  const [sectionName, setSectionName] = useState('');
  const [sectionEmoji, setSectionEmoji] = useState('📋');
  const sections = useMemo(() => {
    const result = new Map(TASK_SECTIONS.map((s) => [s.key, s]));
    for (const s of group.effective_sections || group.custom_sections || []) result.set(s.key, s);
    for (const s of group.statuses || []) {
      if (s.section && !result.has(s.section)) result.set(s.section, { key: s.section, label: s.section_label || s.section, emoji: s.section_emoji || '📋' });
    }
    return [...result.values()];
  }, [group]);
  const addSection = useMutation({
    mutationFn: () => api.put(`/admin/status-groups/${group.id}`, { custom_sections: [...(group.custom_sections || []), { key: slugify(sectionName), label: sectionName.trim(), emoji: sectionEmoji.trim() || '📋' }] }),
    onSuccess: () => { setSection(slugify(sectionName)); setSectionName(''); onChanged(); },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to add section'),
  });
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6b7280');
  const [category, setCategory] = useState<StatusCategory>('todo');
  const [section, setSection] = useState('not_started');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#6b7280');
  const [editCategory, setEditCategory] = useState<StatusCategory>('todo');
  const [editDescription, setEditDescription] = useState('');
  const [editSection, setEditSection] = useState('not_started');
  const [statusPendingDelete, setStatusPendingDelete] = useState<StatusGroupStatus | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const statuses: StatusGroupStatus[] = [...(group.statuses || [])].sort((a, b) => a.position - b.position);

  // Display order: Task Workflow groups by picker section (same order as the
  // task picker); other groups render flat in position order. The reorder API
  // rewrites positions from the submitted array, so display order is always
  // safe to submit.
  const displayOrder: StatusGroupStatus[] = isTaskWorkflow
    ? [
        ...sections.flatMap((sec) => statuses.filter((s) => (s.section || '') === sec.key)),
        ...statuses.filter((s) => !(s.section || '') || !sections.some((sec) => sec.key === s.section)),
      ]
    : statuses;

  const sectionOf = (s: StatusGroupStatus) =>
    sections.find((sec) => sec.key === (s.section || '')) || null;

  const placeAtEndOfSection = (order: StatusGroupStatus[], id: string, sectionKey: string) => {
    const without = order.filter((s) => s.id !== id);
    const stub = order.find((s) => s.id === id) || ({ id } as StatusGroupStatus);
    let idx = without.length;
    for (let k = without.length - 1; k >= 0; k--) {
      if ((without[k].section || '') === sectionKey) { idx = k + 1; break; }
    }
    without.splice(idx, 0, stub);
    return without;
  };

  const pendingRelocate = useRef<{ id: string; section: string } | null>(null);

  const create = useMutation({
    mutationFn: () => {
      const sec = sections.find((s) => s.key === section);
      return api.post(`/admin/status-groups/${group.id}/statuses`, {
        name: name.trim(), color, category,
        description: description.trim() || null,
        section: isTaskWorkflow ? section : undefined,
        section_label: isTaskWorkflow ? sec?.label : undefined,
        section_emoji: isTaskWorkflow ? sec?.emoji : undefined,
      }).then((r) => r.data);
    },
    onSuccess: (res) => {
      const newId = res?.data?.id as string | undefined;
      setName(''); setDescription('');
      // New rows land at the end of their section, not the end of the list.
      if (isTaskWorkflow && newId) {
        move.mutate(placeAtEndOfSection(displayOrder, newId, section));
      } else {
        onChanged();
      }
    },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to add status'),
  });
  const update = useMutation({
    mutationFn: (args: { id: string; body: any }) => api.put(`/admin/status-groups/${group.id}/statuses/${args.id}`, args.body),
    onSuccess: () => {
      const rel = pendingRelocate.current;
      pendingRelocate.current = null;
      setEditingId(null);
      // Section changes relocate to the end of the new section.
      if (rel) {
        move.mutate(placeAtEndOfSection(displayOrder, rel.id, rel.section));
      } else {
        onChanged();
      }
    },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to update status'),
  });
  const remove = useMutation({
    mutationFn: (args: { id: string; target_status_id?: string }) =>
      api.delete(`/admin/status-groups/${group.id}/statuses/${args.id}`, {
        data: args.target_status_id ? { target_status_id: args.target_status_id } : undefined,
      }),
    onMutate: async (args: { id: string; target_status_id?: string }) => {
      setDeleteError(null);
      await qc.cancelQueries({ queryKey: ['admin-status-groups'] });
      const previous = qc.getQueryData(['admin-status-groups']);
      qc.setQueryData(['admin-status-groups'], (old: any) => {
        if (!old || !old.data) return old;
        return {
          ...old,
          data: old.data.map((g: any) => {
            if (g.id !== group.id) return g;
            return {
              ...g,
              statuses: (g.statuses || []).filter((st: any) => st.id !== args.id),
            };
          }),
        };
      });
      return { previous };
    },
    onError: (err: any, _args, context: any) => {
      if (context?.previous) {
        qc.setQueryData(['admin-status-groups'], context.previous);
      }
      const msg = err?.response?.data?.error || 'Failed to delete status';
      setDeleteError(msg);
      alert(msg);
    },
    onSettled: () => {
      setStatusPendingDelete(null);
      onChanged();
    },
  });
  const move = useMutation({
    mutationFn: (ordered: StatusGroupStatus[]) =>
      api.put(`/admin/status-groups/${group.id}/statuses/reorder`, {
        items: ordered.filter((s) => !s.is_inherited).map((s, i) => ({ id: s.id, position: i })),
      }),
    onSuccess: onChanged,
    onError: (err: any) => { onChanged(); alert(err?.response?.data?.error || 'Failed to reorder statuses'); },
  });

  const addSystemStatus = useMutation({
    mutationFn: (preset: SystemStatusPreset) => {
      const sec = sections.find((s) => s.key === preset.section);
      return api.post(`/admin/status-groups/${group.id}/statuses`, {
        name: isTaskWorkflow ? preset.name : preset.label,
        key: preset.key,
        color: preset.color,
        category: preset.category,
        description: preset.description,
        section: isTaskWorkflow ? preset.section : undefined,
        section_label: isTaskWorkflow ? sec?.label : undefined,
        section_emoji: isTaskWorkflow ? sec?.emoji : undefined,
      }).then((r) => r.data);
    },
    onSuccess: (res, preset) => {
      const newId = res?.data?.id as string | undefined;
      if (isTaskWorkflow && newId) {
        move.mutate(placeAtEndOfSection(displayOrder, newId, preset.section));
      } else {
        onChanged();
      }
    },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to add system status'),
  });

  const availableSystemPresets = SYSTEM_STATUS_PRESETS.filter(
    (preset) => !statuses.some((s) => s.key === preset.key || isSystemStatus(s) && (s.key === preset.key || s.name.toLowerCase().trim() === preset.label.toLowerCase().trim() || s.name.toUpperCase().trim() === preset.name))
  );

  const shift = (displayIdx: number, dir: -1 | 1) => {
    const next = [...displayOrder];
    const j = displayIdx + dir;
    if (j < 0 || j >= next.length) return;
    // Arrows stay inside the section (cross-section moves via Edit → section,
    // which relocates to the end of the new section).
    if (isTaskWorkflow && (next[displayIdx].section || '') !== (next[j].section || '')) return;
    [next[displayIdx], next[j]] = [next[j], next[displayIdx]];
    move.mutate(next);
  };

  const atSectionEdge = (displayIdx: number, dir: -1 | 1) => {
    if (displayOrder[displayIdx]?.is_inherited || displayOrder[displayIdx + dir]?.is_inherited) return true;
    if (!isTaskWorkflow) return displayIdx === 0 ? dir === -1 : displayIdx === displayOrder.length - 1;
    const j = displayIdx + dir;
    if (j < 0 || j >= displayOrder.length) return true;
    return (displayOrder[displayIdx].section || '') !== (displayOrder[j].section || '');
  };

  return (
    <div className="rounded-xl border border-divider bg-surface p-4">
      <h3 className="mb-1 text-sm font-semibold">Statuses in this group ({statuses.length})</h3>
      <p className="mb-3 text-xs text-foreground-dim">Order controls the board column order. Category controls grouping (to-do / active / done / closed).</p>
      {canEditSystem && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Every status created here is a system default. Edits also update linked groups. Status keys stay stable on existing tasks.
        </p>
      )}

      {group.base_group_id && <p className="mb-3 rounded-lg border border-divider bg-muted px-3 py-2 text-xs text-foreground-muted">Primary group: Default Task Statuses. Inherited statuses are read-only here; edit them in the default group. Add local statuses below.</p>}
      {/* System default statuses quick-add / info box */}
      {!group.base_group_id && (
      <div className="mb-3 rounded-lg border border-divider/70 bg-muted/20 p-2.5">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-500" />
            System Default Statuses
          </span>
          <span className="text-[11px] text-foreground-dim">Universal across workflows</span>
        </div>
        {availableSystemPresets.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-foreground-dim mr-1">Add to this group:</span>
            {availableSystemPresets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                disabled={addSystemStatus.isPending}
                onClick={() => addSystemStatus.mutate(preset)}
                className="inline-flex items-center gap-1.5 rounded-md border border-divider bg-surface px-2 py-1 text-xs font-medium text-foreground hover:bg-muted/60 hover:border-foreground/30 transition shadow-xs disabled:opacity-50 cursor-pointer"
                title={`Add universal system default status "${preset.label}" (${CATEGORY_LABELS[preset.category]})`}
              >
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: preset.color }} />
                <span>+ {preset.label}</span>
                <span className="rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.2 text-[9px] font-semibold text-slate-600 dark:text-slate-300">SYSTEM</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
            ✓ All system default statuses are active in this workflow group
          </p>
        )}
      </div>

      )}

      <form className="mb-3 flex flex-wrap gap-2" onSubmit={(e) => {
        e.preventDefault();
        const key = slugify(sectionName);
        if (!key || sections.some((s) => s.key === key)) { alert('Enter a unique section name'); return; }
        addSection.mutate();
      }}>
        <input aria-label="New section name" value={sectionName} onChange={(e) => setSectionName(e.target.value)} placeholder="New section name" className="min-w-40 flex-1 rounded-lg border border-divider px-3 py-2 text-sm" />
        <input aria-label="Section emoji" value={sectionEmoji} maxLength={16} onChange={(e) => setSectionEmoji(e.target.value)} className="w-16 rounded-lg border border-divider px-2 py-2 text-sm" />
        <button disabled={!sectionName.trim() || addSection.isPending} className="rounded-lg border border-divider px-3 py-2 text-sm disabled:opacity-50">+ Add section</button>
      </form>
      <div className="mb-3 flex flex-wrap gap-2">{sections.filter((sec) => !statuses.some((s) => s.section === sec.key) && (group.effective_sections || group.custom_sections || []).some((s) => s.key === sec.key)).map((sec) => <span key={sec.key} className="rounded bg-muted px-2 py-1 text-xs">{sec.emoji} {sec.label} · 0 statuses</span>)}</div>

      <form
        className="mb-3 space-y-2"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New status name (e.g. For Review)" className="min-w-40 flex-1 rounded-lg border border-divider px-3 py-2 text-sm focus:border-ink focus:outline-none" />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-10 cursor-pointer rounded border border-divider" title="Status color" />
          <select value={category} onChange={(e) => setCategory(e.target.value as StatusCategory)} className="rounded-lg border border-divider px-2 py-2 text-sm">
            {(Object.keys(CATEGORY_LABELS) as StatusCategory[]).map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
          {isTaskWorkflow && (
            <select value={section} onChange={(e) => setSection(e.target.value)} className="rounded-lg border border-divider px-2 py-2 text-sm" title="Picker section">
              {sections.map((s) => (
                <option key={s.key} value={s.key}>{s.emoji} {s.label}</option>
              ))}
            </select>
          )}
          <button className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white hover:opacity-90">Add</button>
        </div>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description shown under the status in the picker (optional)" className="w-full rounded-lg border border-divider px-3 py-2 text-sm focus:border-ink focus:outline-none" />
      </form>

      {deleteError && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 px-3 py-1.5 text-xs text-red-700 dark:text-red-300">
          <span>{deleteError}</span>
          <button type="button" onClick={() => setDeleteError(null)} className="font-bold ml-2 cursor-pointer">×</button>
        </div>
      )}

      <div className="space-y-1.5">
        {displayOrder.map((s, i) => {
          const showHeader = isTaskWorkflow &&
            (i === 0 || (displayOrder[i - 1].section || '') !== (s.section || ''));
          const secInfo = sectionOf(s);
          const sectionCount = isTaskWorkflow
            ? displayOrder.filter((x) => (x.section || '') === (s.section || '')).length
            : 0;
          return (
          <Fragment key={s.id}>
          {showHeader && (
            <div className="flex items-center gap-1.5 px-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-foreground-dim">
              <span aria-hidden>{secInfo?.emoji || '📋'}</span>
              <span>{secInfo?.label || s.section_label || s.section || 'Other'}</span>
              <span className="font-normal normal-case tracking-normal">({sectionCount})</span>
            </div>
          )}
          <div className="rounded-lg border border-divider px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
              {editingId === s.id ? (
                <>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} className="min-w-0 flex-1 rounded border border-divider px-2 py-1 text-sm focus:border-ink focus:outline-none" />
                  <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} className="h-7 w-8 cursor-pointer rounded border border-divider" />
                  <select value={editCategory} onChange={(e) => setEditCategory(e.target.value as StatusCategory)} className="rounded border border-divider px-1 py-1 text-xs">
                    {(Object.keys(CATEGORY_LABELS) as StatusCategory[]).map((c) => (
                      <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                    ))}
                  </select>
                  {isTaskWorkflow && (
                    <select value={editSection} onChange={(e) => setEditSection(e.target.value)} className="rounded border border-divider px-1 py-1 text-xs">
                      {sections.map((sec) => (
                        <option key={sec.key} value={sec.key}>{sec.emoji} {sec.label}</option>
                      ))}
                    </select>
                  )}
                  <button onClick={() => {
                    const sec = sections.find((x) => x.key === editSection);
                    if (isTaskWorkflow && editSection !== (s.section || '')) {
                      pendingRelocate.current = { id: s.id, section: editSection };
                    }
                    update.mutate({ id: s.id, body: { name: editName.trim(), color: editColor, category: editCategory, description: editDescription.trim() || null, section: isTaskWorkflow ? editSection : undefined, section_label: isTaskWorkflow ? sec?.label : undefined, section_emoji: isTaskWorkflow ? sec?.emoji : undefined } });
                  }} className="rounded bg-ink px-2 py-1 text-xs font-medium text-white">Save</button>
                  <button onClick={() => setEditingId(null)} className="rounded border border-divider px-2 py-1 text-xs">Cancel</button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
                  {s.key && <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground-dim">{s.key}</code>}
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground-dim">{CATEGORY_LABELS[s.category]}</span>
                  {s.is_default && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">DEFAULT</span>}
                  {(() => {
                    const isSystem = isSystemStatus(s);
                    const locked = s.is_inherited || (isSystem && !canEditSystem);
                    return (
                      <>
                        {isSystem && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">SYSTEM</span>
                        )}
                        <button onClick={() => shift(i, -1)} disabled={atSectionEdge(i, -1)} className="rounded px-1 text-foreground-dim hover:text-foreground disabled:opacity-30" title="Move up">↑</button>
                        <button onClick={() => shift(i, 1)} disabled={atSectionEdge(i, 1)} className="rounded px-1 text-foreground-dim hover:text-foreground disabled:opacity-30" title="Move down">↓</button>
                        {!s.is_default && !locked && !group.base_group_id && (
                          <button onClick={() => update.mutate({ id: s.id, body: { is_default: true } })} className="rounded px-1 text-xs text-foreground-dim hover:text-foreground" title="Mark as default">★</button>
                        )}
                        {locked ? (
                          <span className="rounded px-1.5 py-0.5 text-[11px] font-medium text-foreground-dim bg-muted/60" title={s.is_inherited ? "Edit in Default Task Statuses" : "System default status"}>{s.is_inherited ? 'Inherited' : 'Locked'}</span>
                        ) : (
                          <>
                            <button onClick={() => { setEditingId(s.id); setEditName(s.name); setEditColor(s.color); setEditCategory(s.category); setEditDescription(s.description || ''); setEditSection(s.section || 'not_started'); }} className="rounded px-1 text-xs text-foreground-dim hover:text-foreground">Edit</button>
                            <button
                              type="button"
                              disabled={remove.isPending && (remove.variables as any)?.id === s.id}
                              onClick={() => setStatusPendingDelete(s)}
                              className="rounded px-1 text-xs text-red-500 hover:text-red-700 disabled:opacity-50 cursor-pointer"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </>
                    );
                  })()}
                </>
              )}
            </div>
            {editingId === s.id ? (
              <input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Description shown under the status in the picker (optional)" className="mt-1.5 w-full rounded border border-divider px-2 py-1 text-xs focus:border-ink focus:outline-none" />
            ) : (
              s.description && <p className="mt-0.5 truncate pl-5 text-xs text-foreground-dim">{s.description}</p>
            )}
          </div>
          </Fragment>
          );
        })}
        {statuses.length === 0 && <p className="py-4 text-center text-xs text-foreground-dim">No statuses yet — add the first one above.</p>}
      </div>

      {statusPendingDelete && (
        <DeleteStatusModal
          status={statusPendingDelete}
          group={group}
          onClose={() => setStatusPendingDelete(null)}
          onConfirm={(targetStatusId) =>
            remove.mutate({ id: statusPendingDelete.id, target_status_id: targetStatusId })
          }
          isPending={remove.isPending}
        />
      )}
    </div>
  );
}

// ============================================================
// Apply card — requirement 2
// ============================================================
function ApplyCard({ group, onChanged }: { group: StatusGroup; onChanged: () => void }) {
  const qc = useQueryClient();
  const [entityType, setEntityType] = useState<EntityType>('space');
  const [q, setQ] = useState('');
  const [replaceTarget, setReplaceTarget] = useState<{ id: string; name: string } | null>(null);

  const { data: searchRes, isLoading } = useQuery({
    queryKey: ['admin-status-group-targets', entityType, q],
    queryFn: () => api.get('/admin/status-groups/targets/search', { params: { type: entityType, q } }).then((r) => r.data),
  });
  const targets: { id: string; name: string; detail: string; assigned_group_id: string | null }[] = searchRes?.data || [];

  const apply = useMutation({
    mutationFn: (entity_id: string) => api.post(`/admin/status-groups/${group.id}/apply`, { entity_type: entityType, entity_id }),
    onSuccess: onChanged,
    onError: (err: any) => {
      if (err?.response?.status === 409) {
        // Taken between search and click — refresh so the row shows Replace.
        qc.invalidateQueries({ queryKey: ['admin-status-group-targets'] });
      }
      alert(err?.response?.data?.error || 'Failed to apply group');
    },
  });
  const unapply = useMutation({
    mutationFn: (entity_id: string) => api.delete(`/admin/status-groups/${group.id}/apply`, { data: { entity_type: entityType, entity_id } }),
    onSuccess: onChanged,
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to remove'),
  });

  return (
    <div className="rounded-xl border border-divider bg-surface p-4">
      <h3 className="text-sm font-semibold">Apply “{group.name}” to…</h3>
      <div className="mt-2 flex flex-wrap gap-1">
        {(Object.keys(ENTITY_LABELS) as EntityType[]).map((t) => (
          <button
            key={t}
            onClick={() => { setEntityType(t); setQ(''); }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${entityType === t ? 'bg-ink text-white' : 'border border-divider hover:bg-muted'}`}
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
        className="mt-2 w-full rounded-lg border border-divider px-3 py-2 text-sm focus:border-ink focus:outline-none"
      />
      <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
        {isLoading && <p className="py-4 text-center text-xs text-foreground-dim">Searching…</p>}
        {!isLoading && targets.map((t) => {
          const mine = t.assigned_group_id === group.id;
          const taken = !!t.assigned_group_id && !mine;
          return (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-divider px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.name}</p>
                <p className="truncate text-xs text-foreground-dim">{t.detail}</p>
              </div>
              {mine ? (
                <>
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">APPLIED</span>
                  <button onClick={() => unapply.mutate(t.id)} className="rounded border border-divider px-2 py-1 text-xs hover:bg-muted">Remove</button>
                </>
              ) : taken ? (
                <>
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">HAS ANOTHER GROUP</span>
                  <button onClick={() => setReplaceTarget({ id: t.id, name: t.name })} className="rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50">Replace</button>
                </>
              ) : (
                <button onClick={() => apply.mutate(t.id)} className="rounded-lg bg-ink px-2.5 py-1 text-xs font-medium text-white hover:opacity-90">Apply</button>
              )}
            </div>
          );
        })}
        {!isLoading && targets.length === 0 && (
          <p className="py-4 text-center text-xs text-foreground-dim">Nothing found — try a different search.</p>
        )}
      </div>
      {replaceTarget && (
        <ReplaceGroupModal
          group={group}
          entityType={entityType}
          target={replaceTarget}
          onClose={() => setReplaceTarget(null)}
          onDone={() => { setReplaceTarget(null); onChanged(); qc.invalidateQueries({ queryKey: ['admin-status-group-targets'] }); }}
        />
      )}
    </div>
  );
}

// ============================================================
// Replace modal — swap the entity's current group for this one,
// remapping live tasks from old statuses to new ones.
// Left: existing statuses actually in use (with task counts).
// Right: the new status each one inherits on replace.
// ============================================================
type ReplacePreview = {
  has_existing: boolean;
  entity?: { type: string; id: string; name: string };
  current_group?: { id: string; key?: string; name: string };
  new_group?: { id: string; name: string };
  old_statuses?: StatusGroupStatus[];
  new_statuses?: StatusGroupStatus[];
  breakdown?: { status: string; count: number }[];
  total_tasks?: number;
  list_count?: number;
};

function ReplaceGroupModal({ group, entityType, target, onClose, onDone }: {
  group: StatusGroup;
  entityType: EntityType;
  target: { id: string; name: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const { data: previewRes, isLoading } = useQuery({
    queryKey: ['admin-status-group-replace-preview', group.id, entityType, target.id],
    queryFn: () => api.get(`/admin/status-groups/${group.id}/replace-preview`, { params: { entity_type: entityType, entity_id: target.id } }).then((r) => r.data),
  });
  const preview: ReplacePreview | undefined = previewRes?.data;

  const newStatuses: StatusGroupStatus[] = preview?.new_statuses || [];
  const oldStatuses: StatusGroupStatus[] = preview?.old_statuses || [];
  const breakdown = preview?.breakdown || [];
  const totalTasks = preview?.total_tasks || 0;

  const oldColor = (statusName: string) =>
    oldStatuses.find((s) => s.key === statusName || s.name === statusName || s.name.toLowerCase() === statusName.toLowerCase())?.color || '#94A3B8';

  // Auto-suggest: same key/name match, else the new group's default, else first.
  useEffect(() => {
    if (!preview?.has_existing || breakdown.length === 0 || newStatuses.length === 0) return;
    setMapping((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const fallback = newStatuses.find((s) => s.is_default) || newStatuses[0];
      const next: Record<string, string> = {};
      for (const b of breakdown) {
        const match = newStatuses.find((s) => s.key === b.status || s.name.toLowerCase() === b.status.toLowerCase());
        next[b.status] = (match || fallback).id;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  const replace = useMutation({
    mutationFn: () => api.post(`/admin/status-groups/${group.id}/apply`, {
      entity_type: entityType,
      entity_id: target.id,
      allow_replace: true,
      status_mapping: mapping,
    }).then((r) => r.data),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.response?.data?.error || 'Failed to replace group'),
  });

  const allMapped = breakdown.every((b) => mapping[b.status]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !replace.isPending && onClose()} />
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-divider bg-surface p-6 shadow-2xl">
        <h3 className="text-base font-semibold">Replace status group on “{target.name}”</h3>
        {isLoading ? (
          <p className="py-8 text-center text-sm text-foreground-dim">Checking existing statuses…</p>
        ) : !preview?.has_existing ? (
          <div className="py-6 text-center">
            <p className="text-sm text-foreground-dim">No other group is applied here any more — you can apply directly.</p>
            <button onClick={onClose} className="mt-4 rounded-lg border border-divider px-3.5 py-1.5 text-xs font-medium">Close</button>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-foreground-muted">
              <span className="font-medium text-foreground">{preview.current_group?.name}</span>
              {' → '}
              <span className="font-medium text-foreground">{group.name}</span>
              {totalTasks > 0 ? (
                <> · <span className="font-semibold">{totalTasks} task{totalTasks === 1 ? '' : 's'}</span> will be remapped</>
              ) : (
                <> · no tasks here, safe to switch directly</>
              )}
            </p>

            {breakdown.length === 0 ? (
              <p className="mt-4 rounded-lg border border-divider bg-muted px-3 py-2 text-xs text-foreground-muted">
                Nothing is using a status in this scope yet. Replacing only changes which group future tasks use.
              </p>
            ) : (
              <div className="mt-4">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-foreground-dim">
                  <span>Current status ({breakdown.length} in use)</span>
                  <span />
                  <span>Becomes {group.name} status</span>
                </div>
                <div className="space-y-1.5">
                  {breakdown.map((b) => (
                    <div key={b.status} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-lg border border-divider px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: oldColor(b.status) }} />
                        <span className="truncate text-sm font-medium">{b.status}</span>
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground-dim">
                          {b.count} task{b.count === 1 ? '' : 's'}
                        </span>
                      </div>
                      <span className="text-foreground-dim">→</span>
                      <select
                        value={mapping[b.status] || ''}
                        onChange={(e) => setMapping((m) => ({ ...m, [b.status]: e.target.value }))}
                        disabled={replace.isPending}
                        className="w-full rounded-lg border border-divider bg-surface px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
                      >
                        <option value="" disabled>Select…</option>
                        {newStatuses.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={onClose}
                disabled={replace.isPending}
                className="rounded-lg border border-divider px-3.5 py-1.5 text-xs font-medium text-foreground-dim hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => { setError(null); replace.mutate(); }}
                disabled={replace.isPending || !allMapped || newStatuses.length === 0}
                className="rounded-lg bg-ink px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {replace.isPending ? 'Replacing…' : totalTasks > 0 ? `Replace & remap ${totalTasks} task${totalTasks === 1 ? '' : 's'}` : 'Replace group'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Usage card — requirement 3
// ============================================================
function UsageCard({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const { data: usageRes, isLoading } = useQuery({
    queryKey: ['admin-status-group-usage', groupId],
    queryFn: () => api.get(`/admin/status-groups/${groupId}/usage`).then((r) => r.data),
  });
  const usage: { id: string; entity_type: EntityType; entity_id: string; entity_label: string; entity_name: string }[] =
    usageRes?.data || [];

  const unapply = useMutation({
    mutationFn: (u: { entity_type: EntityType; entity_id: string }) =>
      api.delete(`/admin/status-groups/${groupId}/apply`, { data: u }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-status-group-usage', groupId] });
      qc.invalidateQueries({ queryKey: ['admin-status-groups'] });
    },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to remove'),
  });

  const grouped = useMemo(() => {
    const m = new Map<string, typeof usage>();
    for (const u of usage) {
      const list = m.get(u.entity_label) || [];
      list.push(u);
      m.set(u.entity_label, list);
    }
    return [...m.entries()];
  }, [usage]);

  if (isLoading) return <p className="py-8 text-center text-sm text-foreground-dim">Loading usage…</p>;

  if (usage.length === 0) {
    return (
      <div className="rounded-xl border border-divider bg-surface p-8 text-center text-sm text-foreground-dim">
        This group isn’t applied anywhere yet. Use “Apply to…” to attach it to areas, spaces, lists or templates.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {grouped.map(([label, items]) => (
        <div key={label} className="rounded-xl border border-divider bg-surface p-4">
          <h4 className="mb-2 text-sm font-semibold">{label} ({items.length})</h4>
          <div className="space-y-1">
            {items.map((u) => (
              <div key={u.id} className="flex items-center gap-2 rounded-lg border border-divider px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm">{u.entity_name}</span>
                <button onClick={() => { if (confirm(`Remove this group from “${u.entity_name}”?`)) unapply.mutate({ entity_type: u.entity_type, entity_id: u.entity_id }); }} className="rounded px-1 text-xs text-red-500 hover:text-red-700">Remove</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Templates card — template defaults for future spaces
// ============================================================
function TemplatesCard({ selectedGroupId, onChanged }: { selectedGroupId: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const { data: tplRes, isLoading } = useQuery({
    queryKey: ['admin-status-group-templates'],
    queryFn: () => api.get('/admin/status-groups/templates').then((r) => r.data),
  });
  const templates: { id: string; slug: string; name: string; category: string; is_enabled: boolean; assignment: { group_id: string; status_groups: StatusGroup } | null }[] =
    tplRes?.data || [];

  const apply = useMutation({
    // Templates hold no live tasks, so switching is a direct replace.
    mutationFn: (template_id: string) => api.post(`/admin/status-groups/${selectedGroupId}/apply`, { entity_type: 'template', entity_id: template_id, allow_replace: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-status-group-templates'] }); onChanged(); },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to apply to template'),
  });

  if (isLoading) return <p className="py-8 text-center text-sm text-foreground-dim">Loading templates…</p>;

  return (
    <div className="rounded-xl border border-divider bg-surface p-4">
      <h3 className="text-sm font-semibold">Space templates</h3>
      <p className="mb-3 mt-1 text-xs text-foreground-dim">
        Pick which group each template (Designer Space, Video Editor Space, …) uses. Every future space
        created from that template inherits the group automatically.
      </p>
      <div className="space-y-1.5">
        {templates.map((t) => {
          const mine = t.assignment?.group_id === selectedGroupId;
          return (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-divider px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.name} <span className="font-mono text-xs text-foreground-dim">{t.slug}</span></p>
                <p className="truncate text-xs text-foreground-dim">
                  {mine ? 'Uses the selected group' : t.assignment ? `Uses “${t.assignment.status_groups?.name || t.assignment.group_id}” — applying will switch it` : 'No group yet — falls back to the default group'}
                </p>
              </div>
              {mine
                ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">SELECTED GROUP</span>
                : <button onClick={() => apply.mutate(t.id)} className="rounded-lg bg-ink px-2.5 py-1 text-xs font-medium text-white hover:opacity-90">Use selected</button>}
            </div>
          );
        })}
        {templates.length === 0 && <p className="py-4 text-center text-xs text-foreground-dim">No space templates found.</p>}
      </div>
    </div>
  );
}
