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
      <div className="w-full max-w-sm rounded-lg border border-[#E2E8F0] bg-[#F1F5F9] p-6">
        <h3 className="mb-4 font-[family-name:var(--font-display)] text-lg font-semibold text-[#0F172B]">Create Channel</h3>
        {error && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          placeholder="channel-name"
          className="mb-4 w-full rounded-md border border-[#CAD5E2] bg-[#ffffff] px-3 py-2 text-[#0F172B] placeholder-[#999999] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-[#CAD5E2] px-4 py-2 text-sm text-[#666666] transition hover:border-[#999999] hover:text-[#0F172B]">
            Cancel
          </button>
          <button
            onClick={() => name && mutation.mutate(name)}
            disabled={!name || mutation.isPending}
            className="rounded-md bg-[#0F172B] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1D293D] disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
