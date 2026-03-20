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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-lg border border-[#eaeaea] bg-[#fafafa] p-6">
        <h3 className="mb-4 font-[family-name:var(--font-display)] text-lg font-semibold text-[#171717]">Create Channel</h3>
        {error && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          placeholder="channel-name"
          className="mb-4 w-full rounded-md border border-[#d9d9d9] bg-[#ffffff] px-3 py-2 text-[#171717] placeholder-[#999999] focus:border-[#0070F3] focus:outline-none focus:ring-1 focus:ring-[#0070F3]"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-[#d9d9d9] px-4 py-2 text-sm text-[#666666] transition hover:border-[#999999] hover:text-[#171717]">
            Cancel
          </button>
          <button
            onClick={() => name && mutation.mutate(name)}
            disabled={!name || mutation.isPending}
            className="rounded-md bg-[#171717] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#333] disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
