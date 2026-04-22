import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { Role, RolePermissions, RoleHomeView } from '@squadhub/shared';

const HOME_VIEW_OPTIONS: { value: RoleHomeView; label: string; desc: string }[] = [
  { value: 'member', label: 'Member', desc: 'Internal teammates' },
  { value: 'user', label: 'User', desc: 'Client organizations' },
  { value: 'guest', label: 'Guest', desc: 'Partners & freelancers' },
];

interface RoleWithCount extends Role {
  member_count: number;
}

// ---- Permission schema ----
interface PermissionDef {
  key: string;
  label: string;
  description: string;
}

interface PermissionGroup {
  id: string;
  title: string;
  icon: React.ReactNode;
  permissions: PermissionDef[];
}

const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: 'structure',
    title: 'Channel & Structure',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6A1.125 1.125 0 012.25 10.875v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" />
      </svg>
    ),
    permissions: [
      { key: 'can_create_channels', label: 'Create Channels', description: 'Create new channels in workspaces' },
      { key: 'can_create_lists', label: 'Create Lists', description: 'Create new task lists in spaces' },
      { key: 'can_create_folders', label: 'Create Folders', description: 'Create folders to organize lists' },
      { key: 'can_create_spaces', label: 'Create Spaces', description: 'Create new project spaces' },
    ],
  },
  {
    id: 'archive',
    title: 'Archive Controls',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
      </svg>
    ),
    permissions: [
      { key: 'can_archive_lists', label: 'Archive Lists', description: 'Archive and restore task lists' },
      { key: 'can_archive_spaces', label: 'Archive Spaces', description: 'Archive and restore project spaces' },
      { key: 'can_archive_folders', label: 'Archive Folders', description: 'Archive and restore folders' },
    ],
  },
  {
    id: 'messages',
    title: 'Message Controls',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
      </svg>
    ),
    permissions: [
      { key: 'can_delete_messages', label: 'Delete Messages', description: "Delete any member's messages" },
      { key: 'can_edit_messages', label: 'Edit Messages', description: "Edit any member's messages" },
      { key: 'can_send_dms', label: 'Send Direct Messages', description: 'Send private messages to other members' },
    ],
  },
  {
    id: 'time_logs',
    title: 'Time Logs',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6l4 2m5-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    permissions: [
      { key: 'can_edit_time_logs', label: 'Edit Own Time Logs', description: "Edit or delete their own timer sessions (primary role only)" },
    ],
  },
  {
    id: 'admin',
    title: 'Administration',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    permissions: [
      { key: 'can_manage_channels', label: 'Manage Channels', description: 'Edit and delete channels, change settings' },
      { key: 'can_manage_members', label: 'Manage Members', description: 'Invite, remove, and manage workspace members' },
      { key: 'can_manage_tasks', label: 'Manage Tasks', description: 'Edit and delete any tasks in the workspace' },
      { key: 'can_manage_roles', label: 'Manage Roles', description: 'Create, edit, and delete roles' },
      { key: 'can_view_admin_panel', label: 'View Admin Panel', description: 'Access the workspace admin dashboard' },
      { key: 'can_manage_workspace', label: 'Manage Workspace', description: 'Full workspace settings and configuration access' },
    ],
  },
];

const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

const DEFAULT_PERMISSIONS: RolePermissions = {
  ...(Object.fromEntries(ALL_PERMISSION_KEYS.map((k) => [k, false])) as Record<string, boolean>),
  time_edit_window_hours: 0,
} as unknown as RolePermissions;

const PRESET_COLORS = ['#22c55e', '#a855f7', '#3b82f6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#888888'];

// ---- Toggle switch ----
function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-[#2962FF]' : 'bg-[#CAD5E2]'
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

// ---- Permission group component ----
function PermissionGroupPanel({
  group,
  permissions,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onNumberChange,
}: {
  group: PermissionGroup;
  permissions: RolePermissions;
  onToggle: (key: string) => void;
  onSelectAll: (keys: string[]) => void;
  onDeselectAll: (keys: string[]) => void;
  onNumberChange?: (key: string, value: number) => void;
}) {
  const keys = group.permissions.map((p) => p.key);
  const enabledCount = keys.filter((k) => permissions[k]).length;
  const allEnabled = enabledCount === keys.length;
  const isTimeLogs = group.id === 'time_logs';
  const canEditTime = permissions.can_edit_time_logs === true;
  const windowHours = typeof permissions.time_edit_window_hours === 'number' ? permissions.time_edit_window_hours : 0;

  return (
    <div className="rounded-lg border border-[#E2E8F0] bg-white">
      {/* Group header */}
      <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-[#F1F5F9] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[#62748E]">{group.icon}</span>
          <h4 className="text-sm font-semibold text-[#0F172B]">{group.title}</h4>
          <span className="rounded-full bg-[#E2E8F0] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] font-medium text-[#62748E]">
            {enabledCount}/{keys.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => (allEnabled ? onDeselectAll(keys) : onSelectAll(keys))}
          className="font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.08em] text-[#2962FF] transition hover:text-[#1447E6]"
        >
          {allEnabled ? 'Deselect All' : 'Select All'}
        </button>
      </div>
      {/* Permission rows */}
      <div className="divide-y divide-[#E2E8F0]">
        {group.permissions.map((perm) => (
          <div key={perm.key} className="flex items-center justify-between px-4 py-3">
            <div className="mr-4">
              <p className="text-sm font-medium text-[#0F172B]">{perm.label}</p>
              <p className="mt-0.5 text-xs text-[#90A1B9]">{perm.description}</p>
            </div>
            <Toggle checked={!!permissions[perm.key]} onChange={() => onToggle(perm.key)} />
          </div>
        ))}
        {isTimeLogs && (
          <div className="flex items-center justify-between px-4 py-3">
            <div className="mr-4">
              <p className={`text-sm font-medium ${canEditTime ? 'text-[#0F172B]' : 'text-[#90A1B9]'}`}>Edit Window (hours)</p>
              <p className="mt-0.5 text-xs text-[#90A1B9]">How long after a session ends it can still be edited. 0 = unlimited.</p>
            </div>
            <input
              type="number"
              min={0}
              max={720}
              value={windowHours}
              disabled={!canEditTime}
              onChange={(e) => {
                const v = Math.max(0, Math.min(720, Number(e.target.value) || 0));
                onNumberChange?.('time_edit_window_hours', v);
              }}
              className="w-20 rounded-md border border-[#E2E8F0] px-2 py-1 text-right text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none disabled:bg-[#F1F5F9] disabled:text-[#90A1B9]"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Main ----
export default function AdminRoles() {
  const queryClient = useQueryClient();
  const [showPanel, setShowPanel] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleWithCount | null>(null);
  const [formError, setFormError] = useState('');

  // Form state
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState('#22c55e');
  const [formHomeView, setFormHomeView] = useState<RoleHomeView>('user');
  const [formPermissions, setFormPermissions] = useState<RolePermissions>({ ...DEFAULT_PERMISSIONS });

  const { data: rolesRes, isLoading } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api.get('/admin/roles').then((r) => r.data),
  });

  const roles: RoleWithCount[] = rolesRes?.data || [];

  const getErrorMessage = (err: unknown): string => {
    const axiosErr = err as { response?: { data?: { error?: string } } };
    return axiosErr?.response?.data?.error || 'Something went wrong. Please try again.';
  };

  const createMutation = useMutation({
    mutationFn: (data: { name: string; color: string; permissions: RolePermissions; home_view: RoleHomeView }) =>
      api.post('/admin/roles', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-roles'] });
      closePanel();
    },
    onError: (err) => setFormError(getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string; name: string; color: string; permissions: RolePermissions; home_view: RoleHomeView }) =>
      api.put(`/admin/roles/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-roles'] });
      closePanel();
    },
    onError: (err) => setFormError(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/roles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-roles'] });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  // Permission stats
  const totalPermissions = ALL_PERMISSION_KEYS.length;
  const enabledPermissions = useMemo(
    () => ALL_PERMISSION_KEYS.filter((k) => formPermissions[k]).length,
    [formPermissions],
  );

  const openCreate = () => {
    setEditingRole(null);
    setFormName('');
    setFormColor('#22c55e');
    setFormHomeView('user');
    setFormPermissions({ ...DEFAULT_PERMISSIONS });
    setFormError('');
    setShowPanel(true);
  };

  const openEdit = (role: RoleWithCount) => {
    setEditingRole(role);
    setFormName(role.name);
    setFormColor(role.color);
    setFormHomeView(role.home_view ?? 'user');
    setFormPermissions({ ...DEFAULT_PERMISSIONS, ...role.permissions });
    setFormError('');
    setShowPanel(true);
  };

  const closePanel = () => {
    setShowPanel(false);
    setEditingRole(null);
    setFormError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const payload = { name: formName, color: formColor, permissions: formPermissions, home_view: formHomeView };
    if (editingRole) {
      updateMutation.mutate({ id: editingRole.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleDelete = (role: RoleWithCount) => {
    if (role.is_default || role.is_system) return;
    if (window.confirm(`Delete the "${role.name}" role? ${role.member_count} user(s) will be moved to the default role.`)) {
      deleteMutation.mutate(role.id);
    }
  };

  const togglePermission = (key: string) => {
    setFormPermissions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const setPermissionNumber = (key: string, value: number) => {
    setFormPermissions((prev) => ({ ...prev, [key]: value }));
  };

  const selectAll = (keys: string[]) => {
    setFormPermissions((prev) => {
      const next = { ...prev };
      keys.forEach((k) => { next[k] = true; });
      return next;
    });
  };

  const deselectAll = (keys: string[]) => {
    setFormPermissions((prev) => {
      const next = { ...prev };
      keys.forEach((k) => { next[k] = false; });
      return next;
    });
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="relative">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[#0F172B]">Roles</h2>
          <p className="mt-1 text-sm text-[#62748E]">Manage roles and their permissions for this workspace.</p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-md bg-[#0F172B] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1D293D]"
        >
          Create Role
        </button>
      </div>

      {/* Roles table */}
      {isLoading ? (
        <p className="text-sm text-[#62748E]">Loading...</p>
      ) : roles.length === 0 ? (
        <div className="rounded-lg border border-[#E2E8F0] bg-[#F1F5F9] px-6 py-12 text-center">
          <svg className="mx-auto h-10 w-10 text-[#CAD5E2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          <p className="mt-3 text-sm text-[#62748E]">No roles yet. Create your first role to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F1F5F9]">
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#62748E]">Role</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#62748E]">Members</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#62748E]">Home View</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#62748E]">Permissions</th>
                <th className="px-4 py-3 text-right font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#62748E]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => {
                const enabledPerms = ALL_PERMISSION_KEYS.filter((k) => role.permissions?.[k]);
                return (
                  <tr
                    key={role.id}
                    onClick={() => openEdit(role)}
                    className="cursor-pointer border-b border-[#E2E8F0] transition hover:bg-[#F1F5F9] last:border-b-0"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: role.color }} />
                        <span className="text-sm font-medium text-[#0F172B]">{role.name}</span>
                        {role.is_default && (
                          <span className="rounded-full bg-[#F8FAFC] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[#62748E]">Default</span>
                        )}
                        {role.is_system && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-amber-600">System</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-[#62748E]">{role.member_count}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-[#F8FAFC] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.08em] text-[#62748E]">
                        {role.home_view ?? 'user'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-[family-name:var(--font-mono)] text-xs text-[#62748E]">
                          {enabledPerms.length} of {totalPermissions}
                        </span>
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[#E2E8F0]">
                          <div
                            className="h-full rounded-full bg-[#2962FF] transition-all"
                            style={{ width: `${totalPermissions ? (enabledPerms.length / totalPermissions) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => openEdit(role)}
                          className="rounded-md border border-[#CAD5E2] bg-transparent px-2.5 py-1 text-xs text-[#62748E] hover:border-[#90A1B9] hover:text-[#0F172B]"
                        >
                          Edit
                        </button>
                        {!role.is_default && !role.is_system && (
                          <button
                            onClick={() => handleDelete(role)}
                            disabled={deleteMutation.isPending}
                            className="rounded-md bg-red-50 px-2.5 py-1 text-xs text-red-600 hover:bg-red-100 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        )}
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
      {showPanel && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40 bg-black/30 transition-opacity" onClick={closePanel} />

          {/* Panel */}
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-white shadow-xl">
            {/* Panel header */}
            <div className="flex items-center justify-between border-b border-[#E2E8F0] px-6 py-4">
              <div className="flex items-center gap-3">
                {editingRole && (
                  <span className="inline-block h-3.5 w-3.5 rounded-full" style={{ backgroundColor: formColor }} />
                )}
                <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[#0F172B]">
                  {editingRole ? 'Edit Role' : 'Create Role'}
                </h3>
              </div>
              <button
                onClick={closePanel}
                className="rounded-md p-1.5 text-[#90A1B9] transition hover:bg-[#F8FAFC] hover:text-[#0F172B]"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Panel body - scrollable */}
            <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto px-6 py-5">
                <div className="space-y-6">
                  {/* Role name */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#62748E]">Role Name</label>
                    <input
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      required
                      maxLength={30}
                      disabled={!!editingRole?.is_system}
                      className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm text-[#0F172B] placeholder-[#90A1B9] outline-none transition focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF] disabled:cursor-not-allowed disabled:bg-[#F1F5F9] disabled:text-[#90A1B9]"
                      placeholder="e.g. Designer, Manager, Viewer"
                    />
                    {editingRole?.is_system && (
                      <p className="mt-1 text-[11px] text-[#90A1B9]">System role name is locked. Permissions and color can still be edited.</p>
                    )}
                  </div>

                  {/* Role color */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#62748E]">Color</label>
                    <div className="flex items-center gap-2">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setFormColor(c)}
                          className={`h-7 w-7 rounded-full border-2 transition ${
                            formColor === c ? 'border-[#0F172B] scale-110' : 'border-transparent hover:border-[#CAD5E2]'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Home View */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#62748E]">Home View</label>
                    <div className="grid grid-cols-3 gap-2">
                      {HOME_VIEW_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setFormHomeView(opt.value)}
                          className={`rounded-md border px-3 py-2 text-left transition ${
                            formHomeView === opt.value
                              ? 'border-[#0F172B] bg-[#0F172B] text-white'
                              : 'border-[#CAD5E2] bg-white text-[#0F172B] hover:border-[#90A1B9]'
                          }`}
                        >
                          <div className="text-sm font-medium">{opt.label}</div>
                          <div className={`text-[11px] ${formHomeView === opt.value ? 'text-white/70' : 'text-[#90A1B9]'}`}>{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11px] text-[#90A1B9]">Which home page members of this role see when they log in.</p>
                  </div>

                  {/* Permission summary */}
                  <div className="flex items-center justify-between rounded-lg bg-[#F1F5F9] px-4 py-3">
                    <div className="flex items-center gap-2">
                      <svg className="h-4 w-4 text-[#2962FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                      </svg>
                      <span className="text-sm font-medium text-[#0F172B]">
                        {enabledPermissions} of {totalPermissions} permissions enabled
                      </span>
                    </div>
                    <div className="h-2 w-24 overflow-hidden rounded-full bg-[#E2E8F0]">
                      <div
                        className="h-full rounded-full bg-[#2962FF] transition-all"
                        style={{ width: `${totalPermissions ? (enabledPermissions / totalPermissions) * 100 : 0}%` }}
                      />
                    </div>
                  </div>

                  {/* Permission groups */}
                  <div className="space-y-4">
                    {PERMISSION_GROUPS.map((group) => (
                      <PermissionGroupPanel
                        key={group.id}
                        group={group}
                        permissions={formPermissions}
                        onToggle={togglePermission}
                        onSelectAll={selectAll}
                        onDeselectAll={deselectAll}
                        onNumberChange={setPermissionNumber}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Panel footer - sticky */}
              <div className="border-t border-[#E2E8F0] bg-white px-6 py-4">
                {formError && (
                  <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</div>
                )}
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={closePanel}
                    className="rounded-md border border-[#CAD5E2] px-4 py-2 text-sm text-[#62748E] transition hover:border-[#90A1B9] hover:text-[#0F172B]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving || !formName.trim()}
                    className="rounded-md bg-[#0F172B] px-5 py-2 text-sm font-medium text-white transition hover:bg-[#1D293D] disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : editingRole ? 'Save Changes' : 'Create Role'}
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
