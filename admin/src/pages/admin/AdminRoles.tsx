import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { Role, RolePermissions } from '@squadhub/shared';

interface RoleWithCount extends Role {
  member_count: number;
}

const DEFAULT_PERMISSIONS: RolePermissions = {
  can_manage_channels: false,
  can_delete_messages: false,
  can_manage_members: false,
  can_manage_tasks: false,
  can_manage_roles: false,
  can_view_admin_panel: false,
  can_manage_workspace: false,
};

const PERMISSION_LABELS: Record<string, string> = {
  can_manage_channels: 'Manage Channels',
  can_delete_messages: 'Delete Messages',
  can_manage_members: 'Manage Members',
  can_manage_tasks: 'Manage Tasks',
  can_manage_roles: 'Manage Roles',
  can_view_admin_panel: 'View Admin Panel',
  can_manage_workspace: 'Manage Workspace',
};

const PRESET_COLORS = ['#22c55e', '#a855f7', '#3b82f6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#888888'];

export default function AdminRoles() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleWithCount | null>(null);
  const [formError, setFormError] = useState('');

  // Form state
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState('#22c55e');
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
    mutationFn: (data: { name: string; color: string; permissions: RolePermissions }) =>
      api.post('/admin/roles', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-roles'] });
      closeModal();
    },
    onError: (err) => {
      setFormError(getErrorMessage(err));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string; name: string; color: string; permissions: RolePermissions }) =>
      api.put(`/admin/roles/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-roles'] });
      closeModal();
    },
    onError: (err) => {
      setFormError(getErrorMessage(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/roles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-roles'] });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  const openCreate = () => {
    setEditingRole(null);
    setFormName('');
    setFormColor('#22c55e');
    setFormPermissions({ ...DEFAULT_PERMISSIONS });
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (role: RoleWithCount) => {
    setEditingRole(role);
    setFormName(role.name);
    setFormColor(role.color);
    setFormPermissions({ ...DEFAULT_PERMISSIONS, ...role.permissions });
    setFormError('');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingRole(null);
    setFormError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const payload = { name: formName, color: formColor, permissions: formPermissions };
    if (editingRole) {
      updateMutation.mutate({ id: editingRole.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleDelete = (role: RoleWithCount) => {
    if (role.is_default) return;
    if (window.confirm(`Delete the "${role.name}" role? ${role.member_count} user(s) will be moved to the default role.`)) {
      deleteMutation.mutate(role.id);
    }
  };

  const togglePermission = (key: string) => {
    setFormPermissions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[#171717]">Roles</h2>
        <button
          onClick={openCreate}
          className="rounded-md bg-[#171717] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#333]"
        >
          Create Role
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-[#666]">Loading...</p>
      ) : roles.length === 0 ? (
        <p className="text-sm text-[#666]">No roles found.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#eaeaea] bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#eaeaea] bg-[#fafafa]">
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#666]">Role</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#666]">Members</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#666]">Permissions</th>
                <th className="px-4 py-3 text-right font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#666]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => {
                const enabledPerms = Object.entries(role.permissions || {})
                  .filter(([, v]) => v)
                  .map(([k]) => PERMISSION_LABELS[k] || k);

                return (
                  <tr key={role.id} className="border-b border-[#eaeaea] last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 rounded-full"
                          style={{ backgroundColor: role.color }}
                        />
                        <span className="text-sm font-medium text-[#171717]">{role.name}</span>
                        {role.is_default && (
                          <span className="rounded-full bg-[#f5f5f5] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[#666]">Default</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-[#666]">{role.member_count}</td>
                    <td className="px-4 py-3">
                      {enabledPerms.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {enabledPerms.map((p) => (
                            <span key={p} className="rounded bg-[#f5f5f5] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[#666]">
                              {p}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-[#999]">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(role)}
                          className="rounded-md border border-[#d9d9d9] bg-transparent px-2.5 py-1 text-xs text-[#666] hover:border-[#999] hover:text-[#171717]"
                        >
                          Edit
                        </button>
                        {!role.is_default && (
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

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg border border-[#eaeaea] bg-white p-6 shadow-lg">
            <h3 className="mb-4 font-[family-name:var(--font-display)] text-lg font-semibold text-[#171717]">
              {editingRole ? 'Edit Role' : 'Create Role'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#666]">Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  maxLength={30}
                  className="w-full rounded-md border border-[#d9d9d9] bg-white px-3 py-2 text-sm text-[#171717] placeholder-[#999] outline-none focus:border-[#0070F3] focus:ring-1 focus:ring-[#0070F3]"
                  placeholder="e.g. Designer"
                />
              </div>

              {/* Color */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#666]">Color</label>
                <div className="flex items-center gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setFormColor(c)}
                      className={`h-7 w-7 rounded-full border-2 transition ${
                        formColor === c ? 'border-[#171717]' : 'border-transparent hover:border-[#d9d9d9]'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Permissions */}
              <div>
                <label className="mb-2 block text-xs font-medium text-[#666]">Permissions</label>
                <div className="space-y-2">
                  {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between rounded-md border border-[#eaeaea] bg-[#fafafa] px-3 py-2">
                      <span className="text-sm text-[#171717]">{label}</span>
                      <button
                        type="button"
                        onClick={() => togglePermission(key)}
                        className={`relative h-5 w-9 rounded-full transition ${
                          formPermissions[key] ? 'bg-[#0070F3]' : 'bg-[#d9d9d9]'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                            formPermissions[key]
                              ? 'translate-x-4'
                              : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </label>
                  ))}
                </div>
              </div>

              {/* Error */}
              {formError && (
                <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                  {formError}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-[#d9d9d9] px-4 py-2 text-sm text-[#666] hover:border-[#999] hover:text-[#171717]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !formName.trim()}
                  className="rounded-md bg-[#171717] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#333] disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : editingRole ? 'Save Changes' : 'Create Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
