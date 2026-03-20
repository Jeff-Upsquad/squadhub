import { useState } from 'react';
import { useCreateSpace } from '../../../hooks/useSpaces';

const COLORS = [
  '#7c3aed', '#3b82f6', '#06b6d4', '#10b981', '#22c55e',
  '#eab308', '#f97316', '#ef4444', '#ec4899', '#8b5cf6',
];

export default function CreateSpaceModal({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [description, setDescription] = useState('');
  const createSpace = useCreateSpace(workspaceId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createSpace.mutate(
      { name: name.trim(), color, description: description.trim() || undefined },
      { onSuccess: onClose },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] p-6 shadow-2xl"
      >
        <h2 className="mb-5 text-lg font-semibold text-[#0F172B] font-[family-name:var(--font-display)]">Create Space</h2>

        {/* Name */}
        <label className="mb-1 block text-sm font-medium text-[#666666] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Engineering, Marketing"
          className="mb-4 w-full rounded-lg border border-[#CAD5E2] bg-[#F8FAFC] px-3 py-2 text-sm text-[#0F172B] placeholder-[#999999] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
        />

        {/* Color picker */}
        <label className="mb-1 block text-sm font-medium text-[#666666] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">Color</label>
        <div className="mb-4 flex gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`h-7 w-7 rounded-full transition ${
                color === c ? 'ring-2 ring-[#0F172B] ring-offset-2 ring-offset-[#F1F5F9]' : 'hover:scale-110'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        {/* Description */}
        <label className="mb-1 block text-sm font-medium text-[#666666] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this space for?"
          rows={2}
          className="mb-5 w-full resize-none rounded-lg border border-[#CAD5E2] bg-[#F8FAFC] px-3 py-2 text-sm text-[#0F172B] placeholder-[#999999] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
        />

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#CAD5E2] px-4 py-2 text-sm text-[#666666] hover:border-[#999999]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || createSpace.isPending}
            className="rounded-lg bg-[#0F172B] text-white px-4 py-2 text-sm font-medium hover:bg-[#1D293D] disabled:opacity-50"
          >
            {createSpace.isPending ? 'Creating...' : 'Create Space'}
          </button>
        </div>
      </form>
    </div>
  );
}
