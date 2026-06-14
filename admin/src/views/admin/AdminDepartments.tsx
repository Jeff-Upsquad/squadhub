'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { Department, User } from '@squadhub/shared';

const PRESET_COLORS = ['#22c55e', '#a855f7', '#3b82f6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#888888'];

function getErrorMessage(err: unknown): string {
  const axiosErr = err as { response?: { data?: { error?: string } } };
  return axiosErr?.response?.data?.error || 'Something went wrong. Please try again.';
}

function initialOf(s?: string | null) {
  return (s || '?').trim().charAt(0).toUpperCase() || '?';
}

// ---- Avatar circle (image if available, else initial) ----
function Avatar({
  name, email, url, className = '',
}: { name?: string | null; email?: string | null; url?: string | null; className?: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name || email || ''} className={`shrink-0 rounded-full object-cover ${className}`} />;
  }
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full bg-well font-medium text-foreground ${className}`}>
      {initialOf(name || email)}
    </div>
  );
}

// ---- User picker — popover, searches the internal team only ----
function UserPicker({ excludeIds, onPick }: { excludeIds: Set<string>; onPick: (userId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const { data: usersRes, isFetching } = useQuery({
    queryKey: ['admin-internal-users', query],
    queryFn: () =>
      api
        .get(`/admin/users?user_type=internal&search=${encodeURIComponent(query)}&limit=20`)
        .then((r) => r.data),
    enabled: open,
  });
  const users: User[] = usersRes?.data || [];
  const available = users.filter((u) => !excludeIds.has(u.id) && u.status === 'active');

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-divider-strong bg-surface px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-surface-alt"
      >
        + Add member
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-72 overflow-hidden rounded-lg border border-divider bg-surface shadow-lg">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search internal team…"
              className="w-full border-b border-divider px-3 py-2 text-xs outline-none"
            />
            <div className="max-h-64 overflow-y-auto p-1">
              {isFetching && available.length === 0 && (
                <div className="px-3 py-2 text-xs text-foreground-dim">Searching…</div>
              )}
              {!isFetching && available.length === 0 && (
                <div className="px-3 py-2 text-xs text-foreground-dim">
                  {query ? 'No matching internal users' : 'No internal users available'}
                </div>
              )}
              {available.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => { onPick(u.id); setOpen(false); setQuery(''); }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-alt"
                >
                  <Avatar name={u.display_name} email={u.email} url={u.avatar_url} className="h-6 w-6 text-[10px]" />
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

// ---- Main ----
export default function AdminDepartments() {
  const queryClient = useQueryClient();
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formColor, setFormColor] = useState(PRESET_COLORS[0]);
  const [formError, setFormError] = useState('');
  // Holds a just-created department so the members UI shows instantly,
  // before the list query refetches and find() takes over.
  const [justCreated, setJustCreated] = useState<Department | null>(null);

  const { data: deptRes, isLoading } = useQuery({
    queryKey: ['admin-departments'],
    queryFn: () => api.get('/admin/departments').then((r) => r.data),
  });
  const departments: Department[] = deptRes?.data || [];

  // The department being edited is read live from the query so member
  // add/remove (each its own mutation + invalidate) reflects immediately.
  const editingDept = editingId
    ? departments.find((d) => d.id === editingId) || justCreated
    : null;
  const memberIds = useMemo(
    () => new Set((editingDept?.members || []).map((m) => m.user_id)),
    [editingDept],
  );

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description: string; color: string }) =>
      api.post('/admin/departments', data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin-departments'] });
      const created = res.data?.data as Department | undefined;
      // Stay open and switch to edit mode so members can be assigned right away.
      if (created?.id) {
        setJustCreated(created);
        setEditingId(created.id);
      }
      setFormError('');
    },
    onError: (err) => setFormError(getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string; name: string; description: string; color: string }) =>
      api.put(`/admin/departments/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-departments'] });
      closePanel();
    },
    onError: (err) => setFormError(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/departments/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-departments'] }),
    onError: (err) => alert(getErrorMessage(err)),
  });

  const addMemberMutation = useMutation({
    mutationFn: ({ departmentId, userId }: { departmentId: string; userId: string }) =>
      api.post(`/admin/departments/${departmentId}/members`, { user_id: userId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-departments'] }),
    onError: (err) => setFormError(getErrorMessage(err)),
  });

  const removeMemberMutation = useMutation({
    mutationFn: ({ departmentId, userId }: { departmentId: string; userId: string }) =>
      api.delete(`/admin/departments/${departmentId}/members/${userId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-departments'] }),
    onError: (err) => setFormError(getErrorMessage(err)),
  });

  const openCreate = () => {
    setEditingId(null);
    setJustCreated(null);
    setFormName('');
    setFormDescription('');
    setFormColor(PRESET_COLORS[0]);
    setFormError('');
    setPanelOpen(true);
  };

  const openEdit = (d: Department) => {
    setJustCreated(null);
    setEditingId(d.id);
    setFormName(d.name);
    setFormDescription(d.description || '');
    setFormColor(d.color || PRESET_COLORS[0]);
    setFormError('');
    setPanelOpen(true);
  };

  const closePanel = () => {
    setPanelOpen(false);
    setEditingId(null);
    setJustCreated(null);
    setFormError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const payload = { name: formName.trim(), description: formDescription.trim(), color: formColor };
    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleDelete = (e: React.MouseEvent, d: Department) => {
    e.stopPropagation();
    if (window.confirm(
      `Delete the "${d.name}" department? Its ${d.member_count ?? 0} member assignment(s) will be removed. This does not delete any users.`,
    )) {
      deleteMutation.mutate(d.id);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="relative">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">Departments</h2>
          <p className="mt-1 text-sm text-foreground-muted">Organize your internal team into departments and assign members.</p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-hover"
        >
          Create Department
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : departments.length === 0 ? (
        <div className="rounded-lg border border-divider bg-canvas px-6 py-12 text-center">
          <svg className="mx-auto h-10 w-10 text-foreground-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2.83-4M5 9a3 3 0 102.83-4" />
          </svg>
          <p className="mt-3 text-sm text-foreground-muted">No departments yet. Create your first department to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-divider bg-surface">
          <table className="w-full">
            <thead>
              <tr className="border-b border-divider bg-canvas">
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Department</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Members</th>
                <th className="px-4 py-3 text-right font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => {
                const members = d.members || [];
                return (
                  <tr
                    key={d.id}
                    onClick={() => openEdit(d)}
                    className="cursor-pointer border-b border-divider transition hover:bg-canvas last:border-b-0"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">{d.name}</div>
                          {d.description && <div className="max-w-md truncate text-xs text-foreground-dim">{d.description}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        {members.length > 0 && (
                          <div className="flex -space-x-2">
                            {members.slice(0, 4).map((m) => (
                              <Avatar
                                key={m.id}
                                name={m.user?.display_name}
                                email={m.user?.email}
                                url={m.user?.avatar_url}
                                className="h-7 w-7 text-[11px] ring-2 ring-white"
                              />
                            ))}
                            {members.length > 4 && (
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-canvas text-[10px] text-foreground-muted ring-2 ring-white">
                                +{members.length - 4}
                              </div>
                            )}
                          </div>
                        )}
                        <span className="text-sm text-foreground-muted">
                          {members.length === 0 ? 'No members' : `${members.length} member${members.length === 1 ? '' : 's'}`}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); openEdit(d); }}
                          className="rounded-md border border-divider-strong bg-transparent px-2.5 py-1 text-xs text-foreground-muted hover:border-divider-strong hover:text-foreground"
                        >
                          Edit
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, d)}
                          disabled={deleteMutation.isPending}
                          className="rounded-md bg-red-50 px-2.5 py-1 text-xs text-red-600 hover:bg-red-100 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Slide-over panel */}
      {panelOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 transition-opacity" onClick={closePanel} />
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-surface shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-divider px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="inline-block h-3.5 w-3.5 rounded-full" style={{ backgroundColor: formColor }} />
                <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-foreground">
                  {editingId ? 'Edit Department' : 'Create Department'}
                </h3>
              </div>
              <button
                onClick={closePanel}
                className="rounded-md p-1.5 text-foreground-dim transition hover:bg-surface-alt hover:text-foreground"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
                {/* Name */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Department Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    required
                    maxLength={100}
                    className="w-full rounded-md border border-divider-strong bg-surface px-3 py-2 text-sm text-foreground placeholder-foreground-dim outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
                    placeholder="e.g. Sales, HR, Recruiting"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Description <span className="text-foreground-dim">(optional)</span></label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    maxLength={500}
                    rows={2}
                    className="w-full resize-none rounded-md border border-divider-strong bg-surface px-3 py-2 text-sm text-foreground placeholder-foreground-dim outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
                    placeholder="What this department is responsible for"
                  />
                </div>

                {/* Color */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Color</label>
                  <div className="flex items-center gap-2">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setFormColor(c)}
                        className={`h-7 w-7 rounded-full border-2 transition ${
                          formColor === c ? 'scale-110 border-ink' : 'border-transparent hover:border-divider-strong'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>

                {/* Members */}
                <div className="border-t border-divider pt-5">
                  {editingId && editingDept ? (
                    <>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold text-foreground">Members</h4>
                          <p className="text-xs text-foreground-dim">Internal team members assigned to this department.</p>
                        </div>
                        <UserPicker
                          excludeIds={memberIds}
                          onPick={(userId) => addMemberMutation.mutate({ departmentId: editingDept.id, userId })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        {(editingDept.members || []).length === 0 ? (
                          <p className="rounded-lg bg-canvas px-3 py-3 text-xs text-foreground-dim">
                            No members yet. Use “Add member” to assign internal users.
                          </p>
                        ) : (
                          (editingDept.members || []).map((m) => (
                            <div
                              key={m.id}
                              className="flex items-center justify-between rounded-lg border border-divider px-3 py-2"
                            >
                              <div className="flex min-w-0 items-center gap-2.5">
                                <Avatar name={m.user?.display_name} email={m.user?.email} url={m.user?.avatar_url} className="h-8 w-8 text-xs" />
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-foreground">
                                    {m.user?.display_name || m.user?.email || m.user_id.slice(0, 8)}
                                  </div>
                                  {m.user?.display_name && m.user?.email && (
                                    <div className="truncate text-[11px] text-foreground-dim">{m.user.email}</div>
                                  )}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeMemberMutation.mutate({ departmentId: editingDept.id, userId: m.user_id })}
                                disabled={removeMemberMutation.isPending}
                                className="rounded-md px-2 py-1 text-xs text-foreground-dim transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                              >
                                Remove
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="rounded-lg bg-canvas px-3 py-3 text-xs text-foreground-muted">
                      Create the department first — you can assign members right after.
                    </p>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="border-t border-divider bg-surface px-6 py-4">
                {formError && (
                  <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</div>
                )}
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={closePanel}
                    className="rounded-md border border-divider-strong px-4 py-2 text-sm text-foreground-muted transition hover:border-divider-strong hover:text-foreground"
                  >
                    {editingId ? 'Done' : 'Cancel'}
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving || !formName.trim()}
                    className="rounded-md bg-ink px-5 py-2 text-sm font-medium text-white transition hover:bg-ink-hover disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Department'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
