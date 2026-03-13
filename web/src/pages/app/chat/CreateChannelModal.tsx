import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';

export default function CreateChannelModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (channelName: string) =>
      api.post('/channels', { workspace_id: workspaceId, name: channelName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels', workspaceId] });
      onClose();
    },
    onError: (err: any) => setError(err.response?.data?.error || 'Failed to create channel'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-xl bg-gray-900 p-6">
        <h3 className="mb-4 text-lg font-bold text-white">Create Channel</h3>
        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          placeholder="channel-name"
          className="mb-4 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:text-white">
            Cancel
          </button>
          <button
            onClick={() => name && mutation.mutate(name)}
            disabled={!name || mutation.isPending}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
