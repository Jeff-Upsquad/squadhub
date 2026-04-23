import { useState, useMemo } from 'react';
import { useSpaces, useSpace, useMoveList, useMoveFolder } from '../../../hooks/useSpaces';
import { useWorkspaceStore } from '../../../stores/workspaceStore';

type Props =
  | {
      type: 'list';
      id: string;
      name: string;
      currentSpaceId: string;
      currentFolderId?: string | null;
      onClose: () => void;
      onMoved?: () => void;
    }
  | {
      type: 'folder';
      id: string;
      name: string;
      currentSpaceId: string;
      currentFolderId?: null;
      onClose: () => void;
      onMoved?: () => void;
    };

export default function MoveModal(props: Props) {
  const { type, id, name, currentSpaceId, onClose, onMoved } = props;
  const currentFolderId = type === 'list' ? props.currentFolderId ?? null : null;
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);

  const { data: spaces, isLoading: spacesLoading } = useSpaces(workspaceId);
  const [destSpaceId, setDestSpaceId] = useState<string>(currentSpaceId);
  const [destFolderId, setDestFolderId] = useState<string | null>(currentFolderId);

  // Show all spaces returned by the API — the endpoint already filters to
  // spaces the user can see, and the server re-checks member+ access on submit.
  const eligibleSpaces = useMemo(() => spaces || [], [spaces]);

  // Load destination space's folders when needed (lists only)
  const { data: destSpace } = useSpace(type === 'list' ? destSpaceId : null);
  const destFolders = useMemo(
    () => (destSpace?.folders || []).filter((f) => f.status !== 'inactive'),
    [destSpace],
  );

  const moveList = useMoveList(currentSpaceId);
  const moveFolder = useMoveFolder(currentSpaceId);
  const isPending = moveList.isPending || moveFolder.isPending;

  // When the space changes in list mode, drop the folder selection if it no
  // longer belongs to the new space.
  const handleSpaceChange = (newSpaceId: string) => {
    setDestSpaceId(newSpaceId);
    if (newSpaceId !== currentSpaceId) {
      setDestFolderId(null);
    } else {
      setDestFolderId(currentFolderId);
    }
  };

  const isUnchanged = (() => {
    if (type === 'folder') return destSpaceId === currentSpaceId;
    return destSpaceId === currentSpaceId && (destFolderId ?? null) === (currentFolderId ?? null);
  })();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isUnchanged || isPending) return;
    if (type === 'list') {
      moveList.mutate(
        { listId: id, space_id: destSpaceId, folder_id: destFolderId },
        {
          onSuccess: () => {
            onMoved?.();
            onClose();
          },
        },
      );
    } else {
      moveFolder.mutate(
        { folderId: id, space_id: destSpaceId },
        {
          onSuccess: () => {
            onMoved?.();
            onClose();
          },
        },
      );
    }
  };

  const error = (moveList.error || moveFolder.error) as any;
  const errorMessage = error ? error?.response?.data?.error || error.message : null;

  const typeLabel = type === 'list' ? 'List' : 'Folder';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] p-6 shadow-2xl"
      >
        <h2 className="mb-1 text-lg font-semibold text-[#0F172B] font-[family-name:var(--font-display)]">
          Move {typeLabel}
        </h2>
        <p className="mb-5 text-xs text-[#64748B]">
          Moving <span className="font-medium text-[#0F172B]">{name}</span>
          {type === 'folder' && ' — all lists inside move with it.'}
        </p>

        {/* Destination space */}
        <label className="mb-1 block text-sm font-medium text-[#666666] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">
          Destination space
        </label>
        {spacesLoading ? (
          <div className="mb-4 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#90A1B9]">
            Loading spaces...
          </div>
        ) : (
          <select
            value={destSpaceId}
            onChange={(e) => handleSpaceChange(e.target.value)}
            className="mb-4 w-full rounded-lg border border-[#CAD5E2] bg-[#F8FAFC] px-3 py-2 text-sm text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
          >
            {eligibleSpaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.id === currentSpaceId ? ' (current)' : ''}
              </option>
            ))}
          </select>
        )}

        {/* Destination folder (lists only) */}
        {type === 'list' && (
          <>
            <label className="mb-1 block text-sm font-medium text-[#666666] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">
              Destination folder
            </label>
            <select
              value={destFolderId ?? ''}
              onChange={(e) => setDestFolderId(e.target.value || null)}
              className="mb-4 w-full rounded-lg border border-[#CAD5E2] bg-[#F8FAFC] px-3 py-2 text-sm text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
            >
              <option value="">No folder — top level in space</option>
              {destFolders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.id === currentFolderId ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </>
        )}

        {errorMessage && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{errorMessage}</p>
        )}

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
            disabled={isUnchanged || isPending}
            className="rounded-lg bg-[#0F172B] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D293D] disabled:opacity-50"
          >
            {isPending ? 'Moving...' : 'Move'}
          </button>
        </div>
      </form>
    </div>
  );
}
