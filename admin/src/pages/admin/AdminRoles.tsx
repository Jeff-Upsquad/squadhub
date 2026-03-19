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

  // Form state
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState('#22c55e');
  const [formPermissions, setFormPermissions] = useState<RolePermissions>({ ...DEFAULT_PERMISSIONS });

  const { data: rolesRes, isLoading } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api.get('/admin/roles').then((r) => r.data),
  });

  const roles: RoleWithCount[] = rolesRes?.data || [];

  const createMutation = useMutation({
    mutationFn: (data: { name: string; color: string; permissions: RolePermissions }) =>
      api.post('/admin/roles', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-roles'] });
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string; name: string; color: string; permissions: RolePermissions }) =>
      api.put(`/admin/roles/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-roles'] });
      closeModal();
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
    setShowModal(true);
  };

  const openEdit = (role: RoleWithCount) => {
    setEditingRole(role);
    setFormName(role.name);
    setFormColor(role.color);
    setFormPermissions({ ...DEFAULT_PERMISSIONS, ...role.permissions });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingRole(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
        <h2 className="text-2xl font-semibold text-[#ededed]">Roles</h2>
        <button
          onClick={openCreate}
          className="rounded-md bg-[#ededed] px-4 py-2 text-sm font-medium text-[#0a0a0a] transition hover:bg-white"
        >
          Create Role
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-[#888]">Loading...</p>
      ) : roles.length === 0 ? (
        <p className="text-sm text-[#888]">No roles found.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#222]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#222] bg-[#111]">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#888]">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#888]">Members</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#888]">Permissions</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-[#888]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => {
                const enabledPerms = Object.entries(role.permissions || {})
                  .filter(([, v]) => v)
                  .map(([k]) => PERMISSION_LABELS[k] || k);

                return (
                  <tr key={role.id} className="border-b border-[#222] last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 rounded-full"
                          style={{ backgroundColor: role.color }}
                        />
                        <span className="text-sm font-medium text-[#ededed]">{role.name}</span>
                        {role.is_default && (
                          <span className="rounded-full bg-[#222] px-2 py-0.5 text-[10px] text-[#888]">Default</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-[#888]">{role.member_count}</td>
                    <td className="px-4 py-3">
                      {enabledPerms.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {enabledPerms.map((p) => (
                            <span key={p} className="rounded bg-[#1a1a1a] px-1.5 py-0.5 text-[10px] text-[#888]">
                              {p}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-[#555]">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(role)}
                          className="rounded-md border border-[#333] bg-transparent px-2.5 py-1 text-xs text-[#888] hover:border-[#555] hover:text-[#ededed]"
                        >
                          Edit
                        </button>
                        {!role.is_default && (
                          <button
                            onClick={() => handleDelete(role)}
                            disabled={deleteMutation.isPending}
                            className="rounded-md bg-red-500/15 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/25 disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-lg border border-[#222] bg-[#111] p-6">
            <h3 className="mb-4 text-lg font-semibold text-[#ededed]">
              {editingRole ? 'Edit Role' : 'Create Role'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#888]">Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  maxLength={30}
                  className="w-full rounded-md border border-[#333] bg-[#0a0a0a] px-3 py-2 text-sm text-[#ededed] placeholder-[#555] outline-none focus:border-[#ededed]"
                  placeholder="e.g. Designer"
                />
              </div>

              {/* Color */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#888]">Color</label>
                <div className="flex items-center gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setFormColor(c)}
                      className={`h-7 w-7 rounded-full border-2 transition ${
                        formColor === c ? 'border-[#ededed]' : 'border-transparent hover:border-[#555]'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Permissions */}
              <div>
                <label className="mb-2 block text-xs font-medium text-[#888]">Permissions</label>
                <div className="space-y-2">
                  {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between rounded-md border border-[#222] bg-[#0a0a0a] px-3 py-2">
                      <span className="text-sm text-[#ededed]">{label}</span>
                      <button
                        type="button"
                        onClick={() => togglePermission(key)}
                        className={`relative h-5 w-9 rounded-full transition ${
                          formPermissions[key] ? 'bg-[#ededed]' : 'bg-[#333]'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full transition-transform ${
                            formPermissions[key]
                              ? 'translate-x-4 bg-[#0a0a0a]'
                              : 'translate-x-0.5 bg-[#888]'
                          }`}
                        />
                      </button>
                    </label>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-[#333] px-4 py-2 text-sm text-[#888] hover:border-[#555] hover:text-[#ededed]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !formName.trim()}
                  className="rounded-md bg-[#ededed] px-4 py-2 text-sm font-medium text-[#0a0a0a] transition hover:bg-white disabled:opacity-50"
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
