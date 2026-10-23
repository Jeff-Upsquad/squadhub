import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useCreateFolder } from '../../../hooks/useSpaces';

// Create a space (folder) under an area. The Hub version picked from admin
// "client space templates"; the SaaS has no template admin, so it is a plain
// named folder.
export default function CreateAreaSpaceModal({
  spaceId,
  parentFolderId,
  onClose,
}: {
  spaceId: string;
  parentFolderId?: string;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const createFolder = useCreateFolder(spaceId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createFolder.mutate(
      {
        name: name.trim(),
        ...(parentFolderId ? { parent_folder_id: parentFolderId } : {}),
      },
      { onSuccess: onClose },
    );
  };

  const error = createFolder.error as any;
  const errorMessage = error ? error?.response?.data?.error || error.message : null;

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-lg rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] p-6 shadow-2xl"
      >
        <h2 className="mb-4 text-lg font-semibold text-[#0F172B] font-[family-name:var(--font-display)]">
          Create Space
        </h2>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Space name"
          maxLength={100}
          className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172B] outline-none focus:border-[#2962FF]"
        />
        {errorMessage && <p className="mt-3 text-xs text-red-600">{errorMessage}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-[#666666] hover:bg-white">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || createFolder.isPending}
            className="rounded-lg bg-[#2962FF] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {createFolder.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null;
}
