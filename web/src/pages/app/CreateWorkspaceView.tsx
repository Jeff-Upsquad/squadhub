import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';

export default function CreateWorkspaceView() {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      await api.post('/workspaces', { name: name.trim() });
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create workspace');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#ffffff]">
      <div className="w-full max-w-md p-8">
        <h1 className="mb-2 font-[family-name:var(--font-display)] text-2xl font-semibold text-[#0F172B]">Create Your Workspace</h1>
        <p className="mb-6 text-[#666666]">Give your team a home on SquadHub</p>
        <form onSubmit={handleCreate} className="space-y-4">
          {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workspace name"
            className="w-full rounded-md border border-[#CAD5E2] bg-[#ffffff] px-4 py-2.5 text-[#0F172B] placeholder-[#999999] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
          />
          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="w-full rounded-md bg-[#0F172B] py-2.5 font-medium text-white transition hover:bg-[#1D293D] disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Workspace'}
          </button>
        </form>
      </div>
    </div>
  );
}
