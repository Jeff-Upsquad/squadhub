import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';

type ResourceTab = 'spaces' | 'folders' | 'lists';

type Resource = {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  is_locked: boolean;
  is_private: boolean;
  created_by: string;
  created_by_name: string;
  member_count: number;
  // Space fields
  color?: string;
  icon?: string;
  workspace_id?: string;
  // Folder/List fields
  space_id?: string;
  space_name?: string;
  folder_id?: string;
  folder_name?: string;
};

type Member = {
  id: string;
  resource_type: string;
  resource_id: string;
  user_id: string;
  access_level: string;
  user?: {
    id: string;
    display_name: string;
    email: string;
    avatar_url: string | null;
  };
};

type WorkspaceUser = {
  user_id: string;
  users: {
    id: string;
    display_name: string;
    email: string;
    avatar_url: string | null;
  };
};

const ACCESS_LABELS: Record<string, string> = {
  manager: 'Manager',
  member: 'Full Access',
  viewer: 'View Only',
  commenter: 'Comment Only',
};

const ACCESS_COLORS: Record<string, string> = {
  manager: 'bg-purple-50 text-purple-700',
  member: 'bg-blue-50 text-blue-700',
  viewer: 'bg-gray-50 text-gray-700',
  commenter: 'bg-amber-50 text-amber-700',
};

function Toggle({ checked, onChange, color }: { checked: boolean; onChange: () => void; color?: string }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
        checked ? (color || 'bg-[#2962FF]') : 'bg-[#CAD5E2]'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function TypeBadge({ type }: { type: ResourceTab }) {
  const colors = {
    spaces: 'bg-purple-50 text-purple-700',
    folders: 'bg-yellow-50 text-yellow-700',
    lists: 'bg-blue-50 text-blue-700',
  };
  const label = type.slice(0, -1); // spaces -> space
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${colors[type]}`}>
      {label}
    </span>
  );
}

export default function AdminResourceManagement() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<ResourceTab>('spaces');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [lockFilter, setLockFilter] = useState<'all' | 'true' | 'false'>('all');
  const [page, setPage] = useState(1);
  const [selectedResource, setSelectedResource] = useState<{ type: string; id: string; name: string } | null>(null);

  // Add member state
  const [addUserSearch, setAddUserSearch] = useState('');
  const [addAccessLevel, setAddAccessLevel] = useState<string>('viewer');

  const limit = 50;

  // Fetch resources
  const { data: resourcesData, isLoading } = useQuery({
    queryKey: ['admin-resources', activeTab, search, statusFilter, lockFilter, page],
    queryFn: () =>
      api
        .get('/admin/resources', {
          params: { tab: activeTab, search: search || undefined, status: statusFilter, is_locked: lockFilter, page, limit },
        })
        .then((r) => r.data),
  });

  const resources: Resource[] = resourcesData?.data || [];
  const total = resourcesData?.total || 0;
  const totalPages = Math.ceil(total / limit);

  // Toggle status
  const toggleStatus = useMutation({
    mutationFn: ({ type, id, status }: { type: string; id: string; status: string }) =>
      api.put(`/admin/resources/${type}/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-resources'] }),
  });

  // Toggle lock
  const toggleLock = useMutation({
    mutationFn: ({ type, id, is_locked }: { type: string; id: string; is_locked: boolean }) =>
      api.put(`/admin/resources/${type}/${id}`, { is_locked }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-resources'] }),
  });

  // Members query
  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ['admin-resource-members', selectedResource?.type, selectedResource?.id],
    queryFn: () =>
      api.get(`/admin/resources/${selectedResource!.type}/${selectedResource!.id}/members`).then((r) => r.data.data),
    enabled: !!selectedResource,
  });

  const members: Member[] = membersData || [];

  // Workspace users for adding members
  const { data: workspaceUsers } = useQuery({
    queryKey: ['admin-workspace-users'],
    queryFn: () => api.get('/admin/users').then((r) => r.data.data),
    enabled: !!selectedResource,
  });

  // Add member
  const addMember = useMutation({
    mutationFn: ({ type, id, user_id, access_level }: { type: string; id: string; user_id: string; access_level: string }) =>
      api.post(`/admin/resources/${type}/${id}/members`, { user_id, access_level }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-resource-members'] });
      qc.invalidateQueries({ queryKey: ['admin-resources'] });
      setAddUserSearch('');
    },
  });

  // Update member access
  const updateMember = useMutation({
    mutationFn: ({ membershipId, access_level }: { membershipId: string; access_level: string }) =>
      api.put(`/admin/resources/members/${membershipId}`, { access_level }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-resource-members'] }),
  });

  // Remove member
  const removeMember = useMutation({
    mutationFn: (membershipId: string) => api.delete(`/admin/resources/members/${membershipId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-resource-members'] });
      qc.invalidateQueries({ queryKey: ['admin-resources'] });
    },
  });

  const resourceTypeSingular = activeTab.slice(0, -1) as 'space' | 'folder' | 'list';

  // Filter workspace users for add-member dropdown (exclude already members)
  const memberUserIds = new Set(members.map((m) => m.user_id));
  const availableUsers = (workspaceUsers || []).filter(
    (u: any) => !memberUserIds.has(u.id) && (u.display_name?.toLowerCase().includes(addUserSearch.toLowerCase()) || u.email?.toLowerCase().includes(addUserSearch.toLowerCase()))
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[#0F172B]">Resource Management</h1>
        <p className="mt-1 text-sm text-[#62748E]">Manage spaces, folders, and lists. Control access, status, and locks.</p>
      </div>

      {/* Tab bar */}
      <div className="mb-4 flex items-center gap-4 flex-wrap">
        <div className="flex gap-1 rounded-lg bg-white p-1 border border-[#E2E8F0] w-fit">
          {(['spaces', 'folders', 'lists'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setActiveTab(t); setPage(1); }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                activeTab === t ? 'bg-[#0F172B] text-white' : 'text-[#62748E] hover:text-[#0F172B]'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#90A1B9]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="rounded-lg border border-[#E2E8F0] bg-white py-1.5 pl-8 pr-3 text-xs text-[#0F172B] placeholder:text-[#90A1B9] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
          />
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as any); setPage(1); }}
          className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs text-[#0F172B] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        {/* Lock filter */}
        <select
          value={lockFilter}
          onChange={(e) => { setLockFilter(e.target.value as any); setPage(1); }}
          className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs text-[#0F172B] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
        >
          <option value="all">All Locks</option>
          <option value="true">Locked</option>
          <option value="false">Unlocked</option>
        </select>

        {total > 0 && (
          <span className="text-xs text-[#90A1B9]">{total} result{total !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[#62748E]">Name</th>
              {activeTab !== 'spaces' && (
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[#62748E]">Parent</th>
              )}
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[#62748E]">Created by</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-[#62748E]">Members</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-[#62748E]">Active</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-[#62748E]">Locked</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-[#62748E]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-[#90A1B9]">Loading...</td>
              </tr>
            )}
            {!isLoading && resources.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-[#90A1B9]">No resources found</td>
              </tr>
            )}
            {resources.map((r) => (
              <tr key={r.id} className="border-b border-[#E2E8F0] last:border-0 hover:bg-[#F8FAFC]">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {activeTab === 'spaces' && (
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold text-white"
                        style={{ backgroundColor: r.color || '#7c3aed' }}
                      >
                        {r.name?.[0]?.toUpperCase()}
                      </span>
                    )}
                    {activeTab === 'folders' && (
                      <svg className="h-4 w-4 text-yellow-500/70" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
                      </svg>
                    )}
                    {activeTab === 'lists' && (
                      <svg className="h-4 w-4 text-[#90A1B9]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                      </svg>
                    )}
                    <span className="text-sm font-medium text-[#0F172B]">{r.name}</span>
                    {r.is_locked && (
                      <svg className="h-3.5 w-3.5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                      </svg>
                    )}
                    {r.status === 'inactive' && (
                      <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">Inactive</span>
                    )}
                  </div>
                </td>
                {activeTab !== 'spaces' && (
                  <td className="px-4 py-3 text-sm text-[#62748E]">
                    {r.folder_name ? `${r.space_name} / ${r.folder_name}` : r.space_name || '—'}
                  </td>
                )}
                <td className="px-4 py-3 text-sm text-[#62748E]">{r.created_by_name}</td>
                <td className="px-4 py-3 text-center text-sm text-[#62748E]">{r.member_count}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-center">
                    <Toggle
                      checked={r.status === 'active'}
                      color="bg-emerald-500"
                      onChange={() =>
                        toggleStatus.mutate({
                          type: resourceTypeSingular,
                          id: r.id,
                          status: r.status === 'active' ? 'inactive' : 'active',
                        })
                      }
                    />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-center">
                    <Toggle
                      checked={r.is_locked}
                      color="bg-amber-500"
                      onChange={() =>
                        toggleLock.mutate({
                          type: resourceTypeSingular,
                          id: r.id,
                          is_locked: !r.is_locked,
                        })
                      }
                    />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end">
                    <button
                      onClick={() => setSelectedResource({ type: resourceTypeSingular, id: r.id, name: r.name })}
                      className="rounded-md bg-[#0F172B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1D293D]"
                    >
                      Manage
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-[#90A1B9]">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="rounded-md border border-[#E2E8F0] px-3 py-1.5 text-xs font-medium text-[#62748E] hover:bg-[#F8FAFC] disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="rounded-md border border-[#E2E8F0] px-3 py-1.5 text-xs font-medium text-[#62748E] hover:bg-[#F8FAFC] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Member Management Slide-over Panel */}
      {selectedResource && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSelectedResource(null)} />

          {/* Panel */}
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white shadow-xl flex flex-col">
            {/* Panel Header */}
            <div className="flex items-center justify-between border-b border-[#E2E8F0] px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-[#0F172B]">{selectedResource.name}</h2>
                <p className="text-xs text-[#62748E]">Manage members and access levels</p>
              </div>
              <button
                onClick={() => setSelectedResource(null)}
                className="rounded-md p-1 text-[#62748E] hover:bg-[#F1F5F9] hover:text-[#0F172B]"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Panel Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Add Member */}
              <div className="mb-6 rounded-lg border border-[#E2E8F0] p-4">
                <h3 className="mb-3 text-sm font-medium text-[#0F172B]">Add Member</h3>
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Search users by name or email..."
                      value={addUserSearch}
                      onChange={(e) => setAddUserSearch(e.target.value)}
                      className="flex-1 rounded-md border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172B] placeholder:text-[#90A1B9] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
                    />
                    <select
                      value={addAccessLevel}
                      onChange={(e) => setAddAccessLevel(e.target.value)}
                      className="rounded-md border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172B] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
                    >
                      {Object.entries(ACCESS_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </div>
                  {addUserSearch && availableUsers.length > 0 && (
                    <div className="max-h-40 overflow-y-auto rounded-md border border-[#E2E8F0] bg-white">
                      {availableUsers.slice(0, 10).map((u: any) => (
                        <button
                          key={u.id}
                          onClick={() => {
                            addMember.mutate({
                              type: selectedResource.type,
                              id: selectedResource.id,
                              user_id: u.id,
                              access_level: addAccessLevel,
                            });
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#F8FAFC]"
                        >
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#62748E]">
                            {u.display_name?.[0]?.toUpperCase() || u.email?.[0]?.toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-[#0F172B]">{u.display_name}</div>
                            <div className="truncate text-xs text-[#90A1B9]">{u.email}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {addUserSearch && availableUsers.length === 0 && (
                    <p className="text-xs text-[#90A1B9] py-2">No matching users found</p>
                  )}
                </div>
              </div>

              {/* Members List */}
              <h3 className="mb-3 text-sm font-medium text-[#0F172B]">
                Current Members ({members.length})
              </h3>
              {membersLoading && <p className="text-sm text-[#90A1B9]">Loading...</p>}
              {!membersLoading && members.length === 0 && (
                <p className="text-sm text-[#90A1B9]">No members assigned</p>
              )}
              <div className="space-y-2">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 rounded-lg border border-[#E2E8F0] p-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E2E8F0] text-xs font-medium text-[#62748E]">
                      {m.user?.display_name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-[#0F172B]">{m.user?.display_name || 'Unknown'}</div>
                      <div className="text-xs text-[#90A1B9]">{m.user?.email}</div>
                    </div>
                    <select
                      value={m.access_level}
                      onChange={(e) => updateMember.mutate({ membershipId: m.id, access_level: e.target.value })}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium border-0 focus:outline-none focus:ring-1 focus:ring-[#2962FF] cursor-pointer ${ACCESS_COLORS[m.access_level] || 'bg-gray-50 text-gray-700'}`}
                    >
                      {Object.entries(ACCESS_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        if (confirm(`Remove ${m.user?.display_name || 'this user'} from this resource?`)) {
                          removeMember.mutate(m.id);
                        }
                      }}
                      className="rounded p-1 text-[#90A1B9] hover:bg-red-50 hover:text-red-500"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
