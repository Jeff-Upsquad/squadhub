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
    <div className="flex min-h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-md rounded-xl bg-gray-900 p-8 shadow-2xl">
        <h1 className="mb-2 text-2xl font-bold text-white">Create Your Workspace</h1>
        <p className="mb-6 text-gray-400">Give your team a home on SquadHub</p>
        <form onSubmit={handleCreate} className="space-y-4">
          {error && <p className="text-sm text-red-400">{error}</p>}
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workspace name"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="w-full rounded-lg bg-brand-600 py-2.5 font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Workspace'}
          </button>
        </form>
      </div>
    </div>
  );
}
