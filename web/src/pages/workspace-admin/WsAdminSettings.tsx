import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { useWorkspaceStore } from '../../stores/workspaceStore';

export default function WsAdminSettings() {
  const { currentWorkspace, setWorkspace } = useWorkspaceStore();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (currentWorkspace) setName(currentWorkspace.name);
  }, [currentWorkspace]);

  const updateWorkspace = useMutation({
    mutationFn: async (newName: string) => {
      const res = await api.put(`/workspaces/${currentWorkspace!.id}`, { name: newName });
      return res.data.data;
    },
    onSuccess: (data) => {
      setWorkspace({ ...currentWorkspace!, ...data });
      qc.invalidateQueries({ queryKey: ['workspaces'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name === currentWorkspace?.name) return;
    updateWorkspace.mutate(name.trim());
  };

  if (!currentWorkspace) {
    return <p className="text-gray-500">No workspace selected</p>;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="mb-6 text-2xl font-bold">Workspace Settings</h2>

      <form onSubmit={handleSave} className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <label className="mb-1 block text-sm font-medium text-gray-400">Workspace Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-4 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
        />

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!name.trim() || name === currentWorkspace.name || updateWorkspace.isPending}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {updateWorkspace.isPending ? 'Saving...' : 'Save Changes'}
          </button>
          {saved && <span className="text-sm text-green-400">Saved!</span>}
          {updateWorkspace.isError && (
            <span className="text-sm text-red-400">Failed to save</span>
          )}
        </div>
      </form>

      {/* Workspace info */}
      <div className="mt-6 rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h3 className="mb-3 text-sm font-semibold text-gray-400">Info</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">ID</span>
            <span className="font-mono text-xs text-gray-400">{currentWorkspace.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Slug</span>
            <span className="text-gray-400">{currentWorkspace.slug}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Created</span>
            <span className="text-gray-400">{new Date(currentWorkspace.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
