'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { StatusGroup, StatusGroupStatus, StatusCategory } from '@squadhub/shared';

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
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Status Groups</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Build reusable sets of statuses, then apply them to areas, spaces, lists — or to a space
          template so future spaces inherit them automatically.
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
                <GroupMetaCard group={selected} onChanged={invalidate} onDelete={() => deleteGroup.mutate(selected.id)} />
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
                {subTab === 'statuses' && <StatusesCard group={selected} onChanged={invalidate} />}
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
function NewGroupForm({ onSubmit, pending }: { onSubmit: (b: any) => void; pending: boolean }) {
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
        onSubmit({ key: finalKey, name: name.trim(), description: description.trim() || null, color });
      }}
    >
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
function GroupMetaCard({ group, onChanged, onDelete }: { group: StatusGroup; onChanged: () => void; onDelete: () => void }) {
  const qc = useQueryClient();
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
  const setDefault = useMutation({
    mutationFn: () => api.put(`/admin/status-groups/${group.id}/default`),
    onSuccess: () => { onChanged(); qc.invalidateQueries({ queryKey: ['admin-status-groups'] }); },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to set default'),
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
          {!group.is_default && (
            <button onClick={() => setDefault.mutate()} className="rounded-lg border border-divider px-2.5 py-1 text-xs hover:bg-muted">Set as default</button>
          )}
          <button onClick={() => toggleEnabled.mutate()} className="rounded-lg border border-divider px-2.5 py-1 text-xs hover:bg-muted">
            {group.is_enabled ? 'Disable' : 'Enable'}
          </button>
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
      {!group.is_enabled && <p className="mt-1 text-xs text-amber-600">Disabled — hidden from pickers, existing boards keep working.</p>}
    </div>
  );
}

// ============================================================
// Statuses card
// ============================================================
function StatusesCard({ group, onChanged }: { group: StatusGroup; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6b7280');
  const [category, setCategory] = useState<StatusCategory>('todo');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#6b7280');
  const [editCategory, setEditCategory] = useState<StatusCategory>('todo');

  const statuses: StatusGroupStatus[] = [...(group.statuses || [])].sort((a, b) => a.position - b.position);

  const create = useMutation({
    mutationFn: () => api.post(`/admin/status-groups/${group.id}/statuses`, { name: name.trim(), color, category }),
    onSuccess: () => { onChanged(); setName(''); },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to add status'),
  });
  const update = useMutation({
    mutationFn: (args: { id: string; body: any }) => api.put(`/admin/status-groups/${group.id}/statuses/${args.id}`, args.body),
    onSuccess: () => { onChanged(); setEditingId(null); },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to update status'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/status-groups/${group.id}/statuses/${id}`),
    onSuccess: onChanged,
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to delete status'),
  });
  const move = useMutation({
    mutationFn: (ordered: StatusGroupStatus[]) =>
      api.put(`/admin/status-groups/${group.id}/statuses/reorder`, {
        items: ordered.map((s, i) => ({ id: s.id, position: i })),
      }),
    onSuccess: onChanged,
  });

  const shift = (idx: number, dir: -1 | 1) => {
    const next = [...statuses];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    move.mutate(next);
  };

  return (
    <div className="rounded-xl border border-divider bg-surface p-4">
      <h3 className="mb-1 text-sm font-semibold">Statuses in this group ({statuses.length})</h3>
      <p className="mb-3 text-xs text-foreground-dim">Order controls the board column order. Category controls grouping (to-do / active / done / closed).</p>

      <form
        className="mb-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New status name (e.g. For Review)" className="min-w-40 flex-1 rounded-lg border border-divider px-3 py-2 text-sm focus:border-ink focus:outline-none" />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-10 cursor-pointer rounded border border-divider" title="Status color" />
        <select value={category} onChange={(e) => setCategory(e.target.value as StatusCategory)} className="rounded-lg border border-divider px-2 py-2 text-sm">
          {(Object.keys(CATEGORY_LABELS) as StatusCategory[]).map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
        <button className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white hover:opacity-90">Add</button>
      </form>

      <div className="space-y-1.5">
        {statuses.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2 rounded-lg border border-divider px-3 py-2">
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
                <button onClick={() => update.mutate({ id: s.id, body: { name: editName.trim(), color: editColor, category: editCategory } })} className="rounded bg-ink px-2 py-1 text-xs font-medium text-white">Save</button>
                <button onClick={() => setEditingId(null)} className="rounded border border-divider px-2 py-1 text-xs">Cancel</button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground-dim">{CATEGORY_LABELS[s.category]}</span>
                {s.is_default && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">DEFAULT</span>}
                <button onClick={() => shift(i, -1)} disabled={i === 0} className="rounded px-1 text-foreground-dim hover:text-foreground disabled:opacity-30" title="Move up">↑</button>
                <button onClick={() => shift(i, 1)} disabled={i === statuses.length - 1} className="rounded px-1 text-foreground-dim hover:text-foreground disabled:opacity-30" title="Move down">↓</button>
                {!s.is_default && (
                  <button onClick={() => update.mutate({ id: s.id, body: { is_default: true } })} className="rounded px-1 text-xs text-foreground-dim hover:text-foreground" title="Mark as default">★</button>
                )}
                <button onClick={() => { setEditingId(s.id); setEditName(s.name); setEditColor(s.color); setEditCategory(s.category); }} className="rounded px-1 text-xs text-foreground-dim hover:text-foreground">Edit</button>
                <button onClick={() => { if (confirm(`Delete status “${s.name}”?`)) remove.mutate(s.id); }} className="rounded px-1 text-xs text-red-500 hover:text-red-700">Delete</button>
              </>
            )}
          </div>
        ))}
        {statuses.length === 0 && <p className="py-4 text-center text-xs text-foreground-dim">No statuses yet — add the first one above.</p>}
      </div>
    </div>
  );
}

// ============================================================
// Apply card — requirement 2
// ============================================================
function ApplyCard({ group, onChanged }: { group: StatusGroup; onChanged: () => void }) {
  const [entityType, setEntityType] = useState<EntityType>('space');
  const [q, setQ] = useState('');

  const { data: searchRes, isLoading } = useQuery({
    queryKey: ['admin-status-group-targets', entityType, q],
    queryFn: () => api.get('/admin/status-groups/targets/search', { params: { type: entityType, q } }).then((r) => r.data),
  });
  const targets: { id: string; name: string; detail: string; assigned_group_id: string | null }[] = searchRes?.data || [];

  const apply = useMutation({
    mutationFn: (entity_id: string) => api.post(`/admin/status-groups/${group.id}/apply`, { entity_type: entityType, entity_id }),
    onSuccess: onChanged,
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to apply group'),
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
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">HAS ANOTHER GROUP</span>
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
    mutationFn: (template_id: string) => api.post(`/admin/status-groups/${selectedGroupId}/apply`, { entity_type: 'template', entity_id: template_id }),
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
