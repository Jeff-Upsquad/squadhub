import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { ClientSpaceTemplate, AccessLevel } from '@squadhub/shared';

type Tab = 'templates' | 'spaces';

interface ClientOption { id: string; business_name: string; status: string }
interface TemplateInstance {
  id: string;
  name: string;
  client_id: string;
  client: { id: string; business_name: string } | null;
  space: { id: string; name: string; workspace: { id: string; name: string } | null } | null;
  created_at: string;
}

interface ActiveSpace {
  id: string;
  name: string;
  client_id: string;
  client: { id: string; business_name: string } | null;
  template: { id: string; name: string; icon: string } | null;
  space: { id: string; name: string; workspace: { id: string; name: string } | null } | null;
  member_count: number;
}

interface FolderMember {
  id: string;
  user_id: string;
  access_level: AccessLevel;
  user?: { id: string; display_name: string; email: string; avatar_url: string | null };
}

interface SquadPoolUser {
  id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
  user_type: string;
  client_role: { id: string; name: string; color: string } | null;
}

export default function AdminClientSpaces() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('templates');
  const [selected, setSelected] = useState<ClientSpaceTemplate | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [activeSpace, setActiveSpace] = useState<ActiveSpace | null>(null);

  const { data: templates, isLoading } = useQuery<ClientSpaceTemplate[]>({
    queryKey: ['admin-client-spaces'],
    queryFn: async () => {
      const res = await api.get('/admin/client-spaces');
      return res.data.data;
    },
  });

  const { data: activeSpaces, isLoading: loadingSpaces } = useQuery<ActiveSpace[]>({
    queryKey: ['admin-client-space-instances'],
    queryFn: async () => {
      const res = await api.get('/admin/client-spaces/spaces');
      return res.data.data;
    },
    enabled: tab === 'spaces',
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_enabled }: { id: string; is_enabled: boolean }) =>
      api.put(`/admin/client-spaces/${id}`, { is_enabled }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-client-spaces'] });
    },
  });

  return (
    <div>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">Client Spaces</h1>
          <p className="mt-1 text-sm text-[#62748E]">
            {tab === 'templates'
              ? 'Templates users can instantiate as folders under a client (e.g. Design Space)'
              : 'Spaces created from a template — manage who has access to each one'}
          </p>
        </div>
        {tab === 'templates' && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F172B] px-3.5 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-[#1E293B]"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Template
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-[#E2E8F0]">
        {(['templates', 'spaces'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition ${
              tab === t
                ? 'border-[#0F172B] text-[#0F172B]'
                : 'border-transparent text-[#62748E] hover:text-[#0F172B]'
            }`}
          >
            {t === 'templates' ? 'Templates' : 'Active Spaces'}
            {t === 'spaces' && activeSpaces && (
              <span className="ml-1.5 rounded-full bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] text-[#62748E]">
                {activeSpaces.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'templates' &&
        (isLoading ? (
          <p className="py-8 text-center text-sm text-[#90A1B9]">Loading…</p>
        ) : !templates || templates.length === 0 ? (
          <div className="rounded-lg border border-[#E2E8F0] bg-white py-12 text-center">
            <p className="text-sm text-[#90A1B9]">No client-space templates yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {templates.map((t) => (
              <TemplateRow
                key={t.id}
                template={t}
                onToggle={() => toggleMutation.mutate({ id: t.id, is_enabled: !t.is_enabled })}
                onShare={() => setSelected(t)}
              />
            ))}
          </div>
        ))}

      {tab === 'spaces' &&
        (loadingSpaces ? (
          <p className="py-8 text-center text-sm text-[#90A1B9]">Loading…</p>
        ) : !activeSpaces || activeSpaces.length === 0 ? (
          <div className="rounded-lg border border-[#E2E8F0] bg-white py-12 text-center">
            <p className="text-sm text-[#90A1B9]">No active client spaces yet. Share a template with a client to create one.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeSpaces.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSpace(s)}
                className="flex w-full items-center justify-between rounded-lg border border-[#E2E8F0] bg-white px-5 py-4 text-left transition hover:shadow-sm"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#9333ea]/10 text-[#9333ea]">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[#0F172B]">{s.name}</div>
                    <div className="mt-0.5 text-[11px] text-[#90A1B9]">
                      {s.client?.business_name || '—'} · {s.template?.name || '—'} · {s.space?.workspace?.name || '—'} / {s.space?.name || '—'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-[#62748E]">
                  <span>
                    {s.member_count} member{s.member_count !== 1 ? 's' : ''}
                  </span>
                  <span className="text-[#0F172B]">→</span>
                </div>
              </button>
            ))}
          </div>
        ))}

      {selected && <SharingSlider template={selected} onClose={() => setSelected(null)} />}
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} />}
      {activeSpace && (
        <SpaceMembersSlider space={activeSpace} onClose={() => setActiveSpace(null)} />
      )}
    </div>
  );
}

// ============================================================
// Per-folder member management (admin's pool = all workspace members)
// ============================================================
const ACCESS_LEVELS: { value: AccessLevel; label: string }[] = [
  { value: 'viewer', label: 'View only' },
  { value: 'commenter', label: 'Comment only' },
  { value: 'member', label: 'Full access' },
  { value: 'manager', label: 'Manager' },
];

function SpaceMembersSlider({ space, onClose }: { space: ActiveSpace; onClose: () => void }) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [pendingLevel, setPendingLevel] = useState<Record<string, AccessLevel>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { data: members = [] } = useQuery<FolderMember[]>({
    queryKey: ['folder-members', space.id],
    queryFn: async () => {
      const res = await api.get(`/memberships?resource_type=folder&resource_id=${space.id}`);
      return res.data.data;
    },
  });

  // Pool is restricted to users who already have access to this space's client
  // (from client_user_access). Admin first grants client access in Client Access,
  // then picks from that pool here.
  const { data: pool = [] } = useQuery<SquadPoolUser[]>({
    queryKey: ['folder-squad-pool-admin', space.id],
    queryFn: async () => {
      const res = await api.get(`/pm/folders/${space.id}/squad-pool`);
      return res.data.data;
    },
    enabled: showAdd,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['folder-members', space.id] });
    qc.invalidateQueries({ queryKey: ['admin-client-space-instances'] });
  };

  const addMember = useMutation({
    mutationFn: (body: { user_id: string; access_level: AccessLevel }) =>
      api.post('/memberships', {
        resource_type: 'folder',
        resource_id: space.id,
        ...body,
      }),
    onSuccess: () => { invalidate(); setPendingLevel({}); },
  });

  const updateMember = useMutation({
    mutationFn: ({ id, access_level }: { id: string; access_level: AccessLevel }) =>
      api.put(`/memberships/${id}`, { access_level }),
    onSuccess: invalidate,
  });

  const removeMember = useMutation({
    mutationFn: (id: string) => api.delete(`/memberships/${id}`),
    onSuccess: invalidate,
  });

  // squad-pool already excludes folder members, just apply the search filter
  const candidatePool = pool.filter(
    (u) =>
      !search ||
      u.display_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[480px] flex-col bg-white shadow-xl">
        <div className="border-b border-[#E2E8F0] px-5 py-4">
          <div className="flex items-center justify-between">
            <h3 className="font-[family-name:var(--font-display)] text-base font-semibold text-[#0F172B]">{space.name}</h3>
            <button onClick={onClose} className="rounded p-1 text-[#90A1B9] hover:bg-[#F1F5F9] hover:text-[#0F172B]">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="mt-1 text-xs text-[#90A1B9]">
            {space.client?.business_name || '—'} · picks from this client's user pool — grant client access first
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!showAdd ? (
            <button
              onClick={() => setShowAdd(true)}
              className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#CBD5E1] py-2 text-xs font-medium text-[#62748E] transition hover:border-[#0F172B] hover:text-[#0F172B]"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add user
            </button>
          ) : (
            <div className="mb-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search users with client access…"
                className="mb-2 w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs focus:border-[#0F172B] focus:outline-none"
              />
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {candidatePool.length === 0 ? (
                  <p className="py-2 text-xs text-[#90A1B9]">
                    No users left to add. Grant access to this client in Client Access first.
                  </p>
                ) : (
                  candidatePool.slice(0, 20).map((u) => {
                    const level = pendingLevel[u.id] || 'manager';
                    return (
                      <div key={u.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-white">
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#62748E]">
                            {u.display_name?.[0]?.toUpperCase() || '?'}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium text-[#0F172B]">
                              {u.display_name}
                              {u.client_role && (
                                <span
                                  className="ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                                  style={{ background: `${u.client_role.color}22`, color: u.client_role.color }}
                                >
                                  {u.client_role.name}
                                </span>
                              )}
                            </div>
                            <div className="truncate text-[10px] text-[#90A1B9]">{u.email}</div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <select
                            value={level}
                            onChange={(e) => setPendingLevel((p) => ({ ...p, [u.id]: e.target.value as AccessLevel }))}
                            className="rounded border border-[#E2E8F0] bg-white px-2 py-1 text-[10px] font-medium text-[#62748E] focus:border-[#0F172B] focus:outline-none"
                          >
                            {ACCESS_LEVELS.map((l) => (
                              <option key={l.value} value={l.value}>{l.label}</option>
                            ))}
                          </select>
                          <button
                            disabled={addMember.isPending}
                            onClick={() => addMember.mutate({ user_id: u.id, access_level: level })}
                            className="rounded bg-[#0F172B] px-2 py-1 text-[10px] font-medium text-white hover:bg-[#1E293B] disabled:opacity-50"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <button onClick={() => { setShowAdd(false); setSearch(''); }} className="mt-2 text-[10px] text-[#90A1B9] hover:text-[#0F172B]">
                Cancel
              </button>
            </div>
          )}

          {members.length === 0 ? (
            <p className="py-6 text-center text-xs text-[#90A1B9]">Nobody added yet.</p>
          ) : (
            <div className="space-y-1.5">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-lg border border-[#E2E8F0] px-3 py-2.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#62748E]">
                      {m.user?.display_name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[#0F172B]">{m.user?.display_name || 'Unknown'}</div>
                      <div className="truncate text-[10px] text-[#90A1B9]">{m.user?.email || ''}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <select
                      value={m.access_level}
                      onChange={(e) => updateMember.mutate({ id: m.id, access_level: e.target.value as AccessLevel })}
                      className="rounded border border-[#E2E8F0] bg-white px-2 py-1 text-[10px] font-medium text-[#62748E] focus:border-[#0F172B] focus:outline-none"
                    >
                      {ACCESS_LEVELS.map((l) => (
                        <option key={l.value} value={l.value}>{l.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeMember.mutate(m.id)}
                      className="rounded p-1 text-[#90A1B9] transition hover:bg-red-50 hover:text-red-500"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function TemplateRow({
  template,
  onToggle,
  onShare,
}: {
  template: ClientSpaceTemplate;
  onToggle: () => void;
  onShare: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-[#E2E8F0] bg-white px-5 py-4 transition hover:shadow-sm">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F1F5F9]">
          <svg className="h-5 w-5 text-[#9333ea]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[#0F172B]">{template.name}</span>
            <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-medium text-[#62748E]">
              v{template.version}
            </span>
            <button
              onClick={onToggle}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                template.is_enabled
                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-red-50 text-red-600 hover:bg-red-100'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${template.is_enabled ? 'bg-emerald-500' : 'bg-red-400'}`} />
              {template.is_enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
          {template.description && (
            <p className="mt-0.5 text-xs text-[#90A1B9]">{template.description}</p>
          )}
          {template.template?.lists && template.template.lists.length > 0 && (
            <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-[#90A1B9]">
              Creates: {template.template.lists.map((l) => l.name).join(' · ')}
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-3">
            {template.instance_count != null && template.instance_count > 0 ? (
              <span className="text-[10px] text-[#90A1B9]">
                Shared with {template.instance_count} {template.instance_count === 1 ? 'space' : 'spaces'}
              </span>
            ) : (
              <span className="text-[10px] text-[#90A1B9]">Not shared yet</span>
            )}
          </div>
        </div>
      </div>
      <button
        onClick={onShare}
        className="flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs font-medium text-[#62748E] transition hover:bg-[#F8FAFC] hover:text-[#0F172B]"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
        </svg>
        Share
      </button>
    </div>
  );
}

function SharingSlider({ template, onClose }: { template: ClientSpaceTemplate; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const { data: instances = [], isLoading } = useQuery<TemplateInstance[]>({
    queryKey: ['client-space-instances', template.id],
    queryFn: async () => {
      const res = await api.get(`/admin/client-spaces/${template.id}/usage`);
      return res.data.data;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['client-space-instances', template.id] });
    queryClient.invalidateQueries({ queryKey: ['admin-client-spaces'] });
  };

  const deleteInstance = useMutation({
    mutationFn: (folderId: string) =>
      api.delete(`/admin/client-spaces/${template.id}/instances/${folderId}`),
    onSuccess: invalidate,
  });

  // Group instances by client
  const grouped = useMemo(() => {
    const map = new Map<string, TemplateInstance[]>();
    for (const inst of instances) {
      const key = inst.client_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(inst);
    }
    return Array.from(map.entries()).map(([clientId, items]) => ({
      clientId,
      clientName: items[0]?.client?.business_name || 'Unknown client',
      items,
    }));
  }, [instances]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[440px] flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
          <div>
            <h3 className="font-[family-name:var(--font-display)] text-base font-semibold text-[#0F172B]">
              Share {template.name}
            </h3>
            <p className="mt-0.5 text-xs text-[#90A1B9]">
              Share this template with a client to create a space under them
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-[#90A1B9] hover:bg-[#F1F5F9] hover:text-[#0F172B]">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {showAddForm ? (
            <AddInstanceForm
              templateId={template.id}
              templateName={template.name}
              onCreated={() => {
                invalidate();
                setShowAddForm(false);
              }}
              onCancel={() => setShowAddForm(false)}
            />
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#CBD5E1] py-2 text-xs font-medium text-[#62748E] transition hover:border-[#0F172B] hover:text-[#0F172B]"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Share with a client
            </button>
          )}

          <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-[#62748E]">
            Shared with ({instances.length} {instances.length === 1 ? 'space' : 'spaces'})
          </div>

          {isLoading ? (
            <p className="py-6 text-center text-xs text-[#90A1B9]">Loading…</p>
          ) : grouped.length === 0 ? (
            <p className="py-6 text-center text-xs text-[#90A1B9]">Not shared with any clients yet.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {grouped.map((g) => (
                <div key={g.clientId} className="rounded-lg border border-[#E2E8F0]">
                  <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
                    <div className="text-xs font-semibold text-[#0F172B]">{g.clientName}</div>
                  </div>
                  <div className="divide-y divide-[#E2E8F0]">
                    {g.items.map((inst) => (
                      <div key={inst.id} className="flex items-center justify-between px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-[#0F172B]">{inst.name}</div>
                          <div className="mt-0.5 truncate text-[10px] text-[#90A1B9]">
                            {inst.space?.workspace?.name || '—'} · {inst.space?.name || '—'}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            if (confirm(`Remove "${inst.name}" from ${g.clientName}?`)) {
                              deleteInstance.mutate(inst.id);
                            }
                          }}
                          disabled={deleteInstance.isPending}
                          className="ml-2 rounded p-1 text-[#90A1B9] transition hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                          title="Unshare"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function AddInstanceForm({
  templateId,
  templateName: _templateName,
  onCreated,
  onCancel,
}: {
  templateId: string;
  templateName: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: clients = [] } = useQuery<ClientOption[]>({
    queryKey: ['admin-clients-list'],
    queryFn: async () => {
      const res = await api.get('/admin/clients');
      return res.data.data;
    },
  });

  const canSubmit = !!clientId;

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/admin/client-spaces/${templateId}/instances`, {
        client_id: clientId,
      });
      return res.data.data;
    },
    onSuccess: () => {
      onCreated();
    },
    onError: (e: any) => {
      setError(e?.response?.data?.error || e?.message || 'Failed to share template');
    },
  });

  return (
    <div className="mb-4 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
      <div className="mb-2 text-xs font-semibold text-[#0F172B]">Share with a client</div>

      <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.1em] text-[#62748E]">Client</label>
      <select
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        className="mb-3 w-full rounded-md border border-[#E2E8F0] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#0F172B]"
      >
        <option value="">Select a client…</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.business_name}
          </option>
        ))}
      </select>

      {error && (
        <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] text-red-700">{error}</div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-[10px] text-[#90A1B9] hover:text-[#0F172B]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={!canSubmit || createMutation.isPending}
          className="rounded bg-[#0F172B] px-3 py-1 text-[10px] font-medium text-white hover:bg-[#1E293B] disabled:bg-[#CAD5E2]"
        >
          {createMutation.isPending ? 'Sharing…' : 'Share'}
        </button>
      </div>
    </div>
  );
}


function CreateModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [listsText, setListsText] = useState('Briefs | list\nIn Progress | board\nReviews | board');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const lists = listsText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line, i) => {
          const [n, view = 'list'] = line.split('|').map((s) => s.trim());
          return { name: n, position: i, default_view: view === 'board' ? 'board' : 'list' };
        });
      return api.post('/admin/client-spaces', {
        slug,
        name,
        description,
        category,
        template: { lists },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-client-spaces'] });
      onClose();
    },
    onError: (e: any) => setError(e?.response?.data?.error || e?.message || 'Failed'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          create.mutate();
        }}
        className="w-full max-w-lg rounded-xl border border-[#E2E8F0] bg-white p-6 shadow-2xl"
      >
        <h2 className="mb-4 text-lg font-semibold text-[#0F172B]">New Client-Space Template</h2>

        <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.1em] text-[#62748E]">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Design Space"
          className="mb-3 w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-sm outline-none focus:border-[#0F172B]"
        />

        <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.1em] text-[#62748E]">Slug</label>
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
          placeholder="design-space"
          className="mb-3 w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-sm outline-none focus:border-[#0F172B]"
        />

        <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.1em] text-[#62748E]">Description</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short description"
          className="mb-3 w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-sm outline-none focus:border-[#0F172B]"
        />

        <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.1em] text-[#62748E]">Category</label>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="design, video, general…"
          className="mb-3 w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-sm outline-none focus:border-[#0F172B]"
        />

        <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.1em] text-[#62748E]">
          Lists (one per line, format: "Name | list|board")
        </label>
        <textarea
          value={listsText}
          onChange={(e) => setListsText(e.target.value)}
          rows={5}
          className="mb-3 w-full rounded-md border border-[#E2E8F0] px-3 py-2 font-mono text-xs outline-none focus:border-[#0F172B]"
        />

        {error && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm text-[#62748E] hover:bg-[#F1F5F9]">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!slug || !name || create.isPending}
            className="rounded-md bg-[#0F172B] px-4 py-2 text-sm font-medium text-white hover:bg-[#1E293B] disabled:bg-[#CAD5E2]"
          >
            {create.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
