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
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a]">
      <div className="w-full max-w-md p-8">
        <h1 className="mb-2 text-2xl font-semibold text-[#ededed]">Create Your Workspace</h1>
        <p className="mb-6 text-[#888]">Give your team a home on SquadHub</p>
        <form onSubmit={handleCreate} className="space-y-4">
          {error && <p className="text-sm text-red-400">{error}</p>}
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workspace name"
            className="w-full rounded-md border border-[#333] bg-[#0a0a0a] px-4 py-2.5 text-[#ededed] placeholder-[#555] focus:border-[#ededed] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="w-full rounded-md bg-[#ededed] py-2.5 font-medium text-[#0a0a0a] transition hover:bg-white disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Workspace'}
          </button>
        </form>
      </div>
    </div>
  );
}
