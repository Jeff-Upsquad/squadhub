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
      <div className="w-full max-w-sm rounded-lg border border-[#222] bg-[#111] p-6">
        <h3 className="mb-4 text-lg font-semibold text-[#ededed]">Create Channel</h3>
        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          placeholder="channel-name"
          className="mb-4 w-full rounded-md border border-[#333] bg-[#0a0a0a] px-3 py-2 text-[#ededed] placeholder-[#555] focus:border-[#ededed] focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-[#888] hover:text-[#ededed]">
            Cancel
          </button>
          <button
            onClick={() => name && mutation.mutate(name)}
            disabled={!name || mutation.isPending}
            className="rounded-md bg-[#ededed] px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-white disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
