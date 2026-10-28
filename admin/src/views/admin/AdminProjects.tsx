'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

// Projects — the shared workspace project entity. This view lists every
// project across workspaces and opens each one's containers (areas, spaces,
// lists) for management: archive, trash, move, and reassign to another
// project.

interface AdminProject {
  id: string;
  workspace_id: string;
  workspace_name: string;
  name: string;
  color: string;
  description?: string;
  status: 'active' | 'inactive';
  created_at: string;
  deleted_at: string | null;
  container_counts: { spaces: number; folders: number; lists: number };
}

interface ContainerRow {
  id: string;
  name: string;
  status?: string;
  deleted_at: string | null;
  space_id?: string;
  folder_id?: string | null;
  kind?: string | null;
  folder_type?: string | null;
  parent_name?: string | null;
}

interface Containers {
  spaces: ContainerRow[];
  folders: ContainerRow[];
  lists: ContainerRow[];
}

const PRESET_COLORS = ['#7c5cff', '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#888888'];

function getErrorMessage(err: unknown): string {
  const axiosErr = err as { response?: { data?: { error?: string } } };
  return axiosErr?.response?.data?.error || 'Something went wrong. Please try again.';
}

function StatusBadge({ status, deleted }: { status?: string; deleted?: string | null }) {
  if (deleted) return <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600">Trashed</span>;
  if (status === 'inactive') return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">Archived</span>;
  return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Active</span>;
}

function SectionCard({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-divider bg-surface">
      <div className="border-b border-divider px-4 py-2.5">
        <span className="font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">{title}</span>
        <span className="ml-2 text-xs text-foreground-dim">{hint}</span>
      </div>
      {children}
    </div>
  );
}

function ContainerRowActions({
  row,
  type,
  projects,
  onReassign,
  onStatus,
  onDelete,
  onMove,
  busy,
}: {
  row: ContainerRow;
  type: 'space' | 'folder' | 'list';
  projects: AdminProject[];
  onReassign: (projectId: string | null) => void;
  onStatus: (status: 'active' | 'inactive') => void;
  onDelete: () => void;
  onMove: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const activeProjects = projects.filter((p) => !p.deleted_at);
  const typeLabel = type === 'space' ? 'area' : type;
  return (
    <div className="relative flex items-center justify-end gap-1.5">
      <div className="relative">
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-divider-strong px-2 py-1 text-xs text-foreground-muted transition hover:text-foreground disabled:opacity-50"
        >
          Project ↕
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-divider bg-surface shadow-lg">
              <button
                type="button"
                onClick={() => { setOpen(false); onReassign(null); }}
                className="block w-full px-3 py-2 text-left text-xs text-foreground-muted hover:bg-canvas"
              >
                No project
              </button>
              {activeProjects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setOpen(false); onReassign(p.id); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground hover:bg-canvas"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
              {activeProjects.length === 0 && (
                <p className="px-3 py-2 text-xs text-foreground-dim">No active projects</p>
              )}
            </div>
          </>
        )}
      </div>
      {type !== 'space' && (
        <button
          type="button"
          disabled={busy}
          onClick={onMove}
          className="rounded-md border border-divider-strong px-2 py-1 text-xs text-foreground-muted transition hover:text-foreground disabled:opacity-50"
        >
          Move
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => onStatus(row.status === 'inactive' ? 'active' : 'inactive')}
        className="rounded-md border border-divider-strong px-2 py-1 text-xs text-foreground-muted transition hover:text-foreground disabled:opacity-50"
      >
        {row.status === 'inactive' ? 'Unarchive' : 'Archive'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (window.confirm(`Move the "${row.name}" ${typeLabel} to trash? Its tasks stay recoverable from trash.`)) onDelete();
        }}
        className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 transition hover:bg-red-50 disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  );
}

function MoveDialog({
  row,
  type,
  workspaceId,
  currentSpaceId,
  onClose,
  onMove,
  busy,
}: {
  row: ContainerRow;
  type: 'folder' | 'list';
  workspaceId: string;
  currentSpaceId?: string;
  onClose: () => void;
  onMove: (spaceId: string) => void;
  busy: boolean;
}) {
  const [spaceId, setSpaceId] = useState(currentSpaceId || '');
  const { data: spaces } = useQuery({
    queryKey: ['admin-project-workspace-spaces', workspaceId],
    queryFn: () => api.get(`/admin/projects/workspaces/${workspaceId}/spaces`).then((r) => r.data?.data || []),
    enabled: !!workspaceId,
  });
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-96 rounded-lg border border-divider bg-surface p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h4 className="text-sm font-semibold text-foreground">Move “{row.name}”</h4>
        <p className="mt-1 text-xs text-foreground-muted">
          {type === 'folder'
            ? 'Moves the space and every list inside it to the chosen area.'
            : 'Moves the list to the chosen area (lists sit directly under the area after a move).'}
        </p>
        <label className="mt-3 block font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">
          Destination area
        </label>
        <select
          value={spaceId}
          onChange={(e) => setSpaceId(e.target.value)}
          className="mt-1 w-full rounded-md border border-divider bg-canvas px-3 py-2 text-sm text-foreground outline-none"
        >
          <option value="">Choose an area…</option>
          {(spaces || []).map((s: { id: string; name: string }) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-foreground-muted hover:bg-canvas">Cancel</button>
          <button
            type="button"
            disabled={!spaceId || busy}
            onClick={() => onMove(spaceId)}
            className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-hover disabled:opacity-50"
          >
            {busy ? 'Moving…' : 'Move'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminProjects() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [workspaceFilter, setWorkspaceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'deleted'>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState(PRESET_COLORS[0]);
  const [formWorkspace, setFormWorkspace] = useState('');
  const [formError, setFormError] = useState('');
  const [moving, setMoving] = useState<{ row: ContainerRow; type: 'folder' | 'list' } | null>(null);

  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-projects', workspaceFilter, statusFilter],
    queryFn: () =>
      api
        .get('/admin/projects', {
          params: {
            ...(workspaceFilter ? { workspace_id: workspaceFilter } : {}),
            ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
          },
        })
        .then((r) => r.data),
  });
  const projects: AdminProject[] = res?.data || [];
  const workspaces: { id: string; name: string }[] = res?.workspaces || [];

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter(
      (p) => p.name.toLowerCase().includes(needle) || p.workspace_name.toLowerCase().includes(needle),
    );
  }, [projects, search]);

  const detail = projects.find((p) => p.id === detailId) || null;
  const { data: containersRes, isLoading: containersLoading } = useQuery({
    queryKey: ['admin-project-containers', detailId],
    queryFn: () => api.get(`/admin/projects/${detailId}/containers`).then((r) => r.data?.data),
    enabled: !!detailId,
  });
  const containers: Containers = containersRes || { spaces: [], folders: [], lists: [] };

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin-projects'] });
    void qc.invalidateQueries({ queryKey: ['admin-project-containers'] });
  };

  const createMutation = useMutation({
    mutationFn: (body: { workspace_id: string; name: string; color: string }) =>
      api.post('/admin/projects', body).then((r) => r.data),
    onSuccess: () => {
      setCreateOpen(false);
      setFormName('');
      setFormError('');
      invalidate();
    },
    onError: (err) => setFormError(getErrorMessage(err)),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'inactive' }) =>
      api.patch(`/admin/projects/${id}`, { status }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/projects/${id}`),
    onSuccess: () => { setDetailId(null); invalidate(); },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/projects/${id}/restore`),
    onSuccess: invalidate,
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/projects/${id}/permanent`),
    onSuccess: () => { setDetailId(null); invalidate(); },
  });

  const reassignMutation = useMutation({
    mutationFn: ({ type, id, project_id }: { type: string; id: string; project_id: string | null }) =>
      api.put(`/admin/projects/containers/${type}/${id}`, { project_id }),
    onSuccess: invalidate,
  });

  const containerStatusMutation = useMutation({
    mutationFn: ({ type, id, status }: { type: string; id: string; status: 'active' | 'inactive' }) =>
      api.put(`/admin/projects/containers/${type}/${id}/status`, { status }),
    onSuccess: invalidate,
  });

  const containerDeleteMutation = useMutation({
    mutationFn: ({ type, id }: { type: string; id: string }) =>
      api.delete(`/admin/projects/containers/${type}/${id}`),
    onSuccess: invalidate,
  });

  const moveMutation = useMutation({
    mutationFn: ({ type, id, space_id }: { type: string; id: string; space_id: string }) =>
      api.put(`/admin/projects/containers/${type}/${id}/move`, { space_id }),
    onSuccess: () => { setMoving(null); invalidate(); },
  });

  const containerActions = (row: ContainerRow, type: 'space' | 'folder' | 'list') => (
    <ContainerRowActions
      row={row}
      type={type}
      projects={projects}
      busy={reassignMutation.isPending || containerStatusMutation.isPending || containerDeleteMutation.isPending || moveMutation.isPending}
      onReassign={(project_id) => reassignMutation.mutate({ type, id: row.id, project_id })}
      onStatus={(status) => containerStatusMutation.mutate({ type, id: row.id, status })}
      onDelete={() => containerDeleteMutation.mutate({ type, id: row.id })}
      onMove={() => setMoving({ row, type: type === 'list' ? 'list' : 'folder' })}
    />
  );

  const renderContainerRows = (rows: ContainerRow[], type: 'space' | 'folder' | 'list', fallback: string) =>
    rows.length === 0 ? (
      <p className="px-4 py-3 text-xs text-foreground-dim">{fallback}</p>
    ) : (
      rows.map((row) => (
        <div key={row.id} className="flex items-center justify-between gap-3 border-b border-divider px-4 py-2.5 last:border-b-0">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{row.name}</div>
            <div className="flex items-center gap-2 text-xs text-foreground-dim">
              {row.parent_name && <span className="truncate">in {row.parent_name}</span>}
              <StatusBadge status={row.status} deleted={row.deleted_at} />
            </div>
          </div>
          {containerActions(row, type)}
        </div>
      ))
    );

  return (
    <div className="relative">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">Projects</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Every workspace project with its areas, spaces, and lists — archive, trash, move, or reassign them.
          </p>
        </div>
        <button
          onClick={() => { setCreateOpen(true); setFormError(''); }}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-hover"
        >
          Create Project
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects or workspaces…"
          className="w-64 rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-divider-strong"
        />
        <select
          value={workspaceFilter}
          onChange={(e) => setWorkspaceFilter(e.target.value)}
          className="rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground outline-none"
        >
          <option value="">All workspaces</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground outline-none"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Archived</option>
          <option value="deleted">Trashed</option>
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-divider bg-canvas px-6 py-12 text-center">
          <p className="mt-3 text-sm text-foreground-muted">No projects match. Create one or adjust the filters.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-divider bg-surface">
          <table className="w-full">
            <thead>
              <tr className="border-b border-divider bg-canvas">
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Project</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Workspace</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Containers</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Status</th>
                <th className="px-4 py-3 text-right font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-divider transition last:border-b-0 hover:bg-canvas">
                  <td className="cursor-pointer px-4 py-3" onClick={() => setDetailId(p.id)}>
                    <div className="flex items-center gap-2.5">
                      <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">{p.name}</div>
                        <div className="text-xs text-foreground-dim">
                          {p.container_counts.spaces} area{p.container_counts.spaces === 1 ? '' : 's'} ·{' '}
                          {p.container_counts.folders} space{p.container_counts.folders === 1 ? '' : 's'} ·{' '}
                          {p.container_counts.lists} list{p.container_counts.lists === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">{p.workspace_name}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">
                    <button onClick={() => setDetailId(p.id)} className="rounded-md border border-divider-strong px-2.5 py-1 text-xs text-foreground-muted hover:text-foreground">
                      Manage
                    </button>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} deleted={p.deleted_at} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {p.deleted_at ? (
                        <>
                          <button
                            onClick={() => restoreMutation.mutate(p.id)}
                            disabled={restoreMutation.isPending}
                            className="rounded-md border border-divider-strong px-2.5 py-1 text-xs text-foreground-muted hover:text-foreground disabled:opacity-50"
                          >
                            Restore
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm(`Permanently delete "${p.name}"? Its areas/spaces/lists are detached and its goals are deleted. This cannot be undone.`)) {
                                permanentDeleteMutation.mutate(p.id);
                              }
                            }}
                            disabled={permanentDeleteMutation.isPending}
                            className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            Delete forever
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => statusMutation.mutate({ id: p.id, status: p.status === 'inactive' ? 'active' : 'inactive' })}
                            disabled={statusMutation.isPending}
                            className="rounded-md border border-divider-strong px-2.5 py-1 text-xs text-foreground-muted hover:text-foreground disabled:opacity-50"
                          >
                            {p.status === 'inactive' ? 'Unarchive' : 'Archive'}
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm(`Move "${p.name}" to trash? Its containers resolve to “No project” until it is restored.`)) {
                                deleteMutation.mutate(p.id);
                              }
                            }}
                            disabled={deleteMutation.isPending}
                            className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail slide-over: the project's containers */}
      {detail && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setDetailId(null)} />
          <div className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-divider bg-surface p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <span className="inline-block h-3.5 w-3.5 rounded-full" style={{ backgroundColor: detail.color }} />
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{detail.name}</h3>
                  <p className="text-xs text-foreground-muted">{detail.workspace_name}</p>
                </div>
              </div>
              <button onClick={() => setDetailId(null)} className="rounded-md px-2 py-1 text-sm text-foreground-muted hover:bg-canvas">✕</button>
            </div>

            {containersLoading ? (
              <p className="text-sm text-foreground-muted">Loading containers…</p>
            ) : (
              <div className="space-y-4">
                <SectionCard title="Areas" hint="spaces assigned to this project">
                  {renderContainerRows(containers.spaces, 'space', 'No areas assigned to this project.')}
                </SectionCard>
                <SectionCard title="Spaces" hint="folders assigned to this project">
                  {renderContainerRows(containers.folders, 'folder', 'No spaces assigned to this project.')}
                </SectionCard>
                <SectionCard title="Lists" hint="lists assigned to this project">
                  {renderContainerRows(containers.lists, 'list', 'No lists assigned to this project.')}
                </SectionCard>
              </div>
            )}
          </div>
        </>
      )}

      {/* Move dialog */}
      {moving && detail && (
        <MoveDialog
          row={moving.row}
          type={moving.type}
          workspaceId={detail.workspace_id}
          currentSpaceId={moving.row.space_id}
          busy={moveMutation.isPending}
          onClose={() => setMoving(null)}
          onMove={(spaceId) => moveMutation.mutate({ type: moving.type, id: moving.row.id, space_id: spaceId })}
        />
      )}

      {/* Create slide-over */}
      {createOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setCreateOpen(false)} />
          <div className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-l border-divider bg-surface p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-foreground">Create project</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!formWorkspace) return setFormError('Choose a workspace');
                if (!formName.trim()) return setFormError('Name your project');
                createMutation.mutate({ workspace_id: formWorkspace, name: formName.trim(), color: formColor });
              }}
              className="mt-4 space-y-4"
            >
              <div>
                <label className="block font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Workspace</label>
                <select
                  value={formWorkspace}
                  onChange={(e) => { setFormWorkspace(e.target.value); setFormError(''); }}
                  className="mt-1 w-full rounded-md border border-divider bg-canvas px-3 py-2 text-sm text-foreground outline-none"
                >
                  <option value="">Choose a workspace…</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Name</label>
                <input
                  autoFocus
                  value={formName}
                  onChange={(e) => { setFormName(e.target.value); setFormError(''); }}
                  className="mt-1 w-full rounded-md border border-divider bg-canvas px-3 py-2 text-sm text-foreground outline-none"
                />
              </div>
              <div>
                <label className="block font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Color</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      onClick={() => setFormColor(c)}
                      className={`h-6 w-6 rounded-full ${formColor === c ? 'ring-2 ring-ink ring-offset-2' : ''}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setCreateOpen(false)} className="rounded-md px-3 py-1.5 text-sm text-foreground-muted hover:bg-canvas">Cancel</button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="rounded-md bg-ink px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-hover disabled:opacity-50"
                >
                  {createMutation.isPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
