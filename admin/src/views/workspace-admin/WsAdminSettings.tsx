import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { Workspace } from '@squadhub/shared';

export default function WsAdminSettings() {
  const { currentWorkspace, setWorkspace } = useWorkspaceStore();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);

  // Fetch workspaces and auto-select first one if none selected
  const { data: workspacesRes } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api.get('/workspaces').then((r) => r.data),
  });

  useEffect(() => {
    const workspaces: Workspace[] = workspacesRes?.data || [];
    if (!currentWorkspace && workspaces.length > 0) {
      setWorkspace(workspaces[0]);
    }
  }, [workspacesRes, currentWorkspace, setWorkspace]);

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
    return <p className="text-foreground-dim">Loading workspace...</p>;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="mb-6 font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">Workspace Settings</h2>

      <form onSubmit={handleSave} className="rounded-lg border border-divider bg-surface p-6">
        <label className="mb-1 block text-xs font-medium text-foreground-muted">Workspace Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-4 w-full rounded-md border border-divider-strong bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
        />

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!name.trim() || name === currentWorkspace.name || updateWorkspace.isPending}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-hover disabled:opacity-50"
          >
            {updateWorkspace.isPending ? 'Saving...' : 'Save Changes'}
          </button>
          {saved && <span className="text-sm text-green-600">Saved!</span>}
          {updateWorkspace.isError && (
            <span className="text-sm text-red-600">Failed to save</span>
          )}
        </div>
      </form>

      {/* Workspace info */}
      <div className="mt-6 rounded-lg border border-divider bg-surface p-6">
        <h3 className="mb-3 font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Info</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-foreground-dim">ID</span>
            <span className="font-[family-name:var(--font-mono)] text-xs text-foreground-muted">{currentWorkspace.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-foreground-dim">Slug</span>
            <span className="text-foreground-muted">{currentWorkspace.slug}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-foreground-dim">Created</span>
            <span className="font-[family-name:var(--font-mono)] text-xs text-foreground-muted">{new Date(currentWorkspace.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
