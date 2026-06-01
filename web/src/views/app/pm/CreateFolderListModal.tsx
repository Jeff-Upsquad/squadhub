import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useCreateFolder, useCreateList } from '../../../hooks/useSpaces';
import { useAvailableProfiles } from '../../../hooks/useCustomProfiles';
import type { CustomProfile } from '@squadhub/shared';

const CATEGORY_COLORS: Record<string, string> = {
  design: '#9333ea',
  video: '#ec4899',
  development: '#3b82f6',
  marketing: '#f97316',
  general: '#6b7280',
};

export default function CreateFolderListModal({
  type,
  spaceId,
  folderId,
  onClose,
}: {
  type: 'folder' | 'list' | 'client';
  spaceId: string;
  folderId?: string;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [selectedProfile, setSelectedProfile] = useState<CustomProfile | null>(null);
  const createFolder = useCreateFolder(spaceId);
  const createList = useCreateList(spaceId);
  const { data: profiles, isLoading: profilesLoading } = useAvailableProfiles(type === 'client' ? 'folder' : type);

  const isPending = createFolder.isPending || createList.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (type === 'folder') {
      createFolder.mutate(
        { name: name.trim(), profile_id: selectedProfile?.id },
        { onSuccess: onClose },
      );
    } else if (type === 'client') {
      createFolder.mutate(
        { name: name.trim(), folder_type: 'client' },
        { onSuccess: onClose },
      );
    } else {
      createList.mutate(
        { name: name.trim(), folder_id: folderId, profile_id: selectedProfile?.id },
        { onSuccess: onClose },
      );
    }
  };

  const error = (createFolder.error || createList.error) as any;
  const errorMessage = error
    ? error?.response?.data?.error || error.message
    : null;

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
        <h2 className="mb-5 text-lg font-semibold text-[#0F172B] font-[family-name:var(--font-display)]">
          Create {type === 'folder' ? 'Folder' : type === 'client' ? 'Client' : 'List'}
        </h2>

        {/* Name */}
        <label className="mb-1 block text-sm font-medium text-[#666666] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">
          Name
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={type === 'folder' ? 'e.g. Design Assets' : type === 'client' ? 'e.g. Acme Corp' : 'e.g. Sprint Backlog'}
          className="mb-5 w-full rounded-lg border border-[#CAD5E2] bg-[#F8FAFC] px-3 py-2 text-sm text-[#0F172B] placeholder-[#999999] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
        />

        {type !== 'client' && (
          <>
            <label className="mb-2 block text-sm font-medium text-[#666666] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">
              Type
            </label>

            <div className="mb-5 grid grid-cols-2 gap-2">
              {/* Blank option */}
              <button
                type="button"
                onClick={() => setSelectedProfile(null)}
                className={`flex items-center gap-3 rounded-lg border-2 p-3 text-left transition ${
                  !selectedProfile
                    ? 'border-[#2962FF] bg-[#F0F4FF]'
                    : 'border-[#E2E8F0] bg-white hover:border-[#CAD5E2]'
                }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F1F5F9]">
                  <svg className="h-4 w-4 text-[#64748B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-medium text-[#0F172B]">Blank</div>
                  <div className="text-[11px] text-[#999999]">Start from scratch</div>
                </div>
              </button>

              {/* Profile options */}
              {profilesLoading ? (
                <div className="flex items-center justify-center rounded-lg border border-[#E2E8F0] bg-white p-3">
                  <span className="text-xs text-[#90A1B9]">Loading...</span>
                </div>
              ) : (
                (profiles || []).map((profile) => {
                  const catColor = CATEGORY_COLORS[profile.category] || CATEGORY_COLORS.general;
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => {
                        setSelectedProfile(profile);
                        if (!name.trim()) setName(profile.name);
                      }}
                      className={`flex items-center gap-3 rounded-lg border-2 p-3 text-left transition ${
                        selectedProfile?.id === profile.id
                          ? 'border-[#2962FF] bg-[#F0F4FF]'
                          : 'border-[#E2E8F0] bg-white hover:border-[#CAD5E2]'
                      }`}
                    >
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                        style={{ backgroundColor: `${catColor}10` }}
                      >
                        <svg className="h-4 w-4" style={{ color: catColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          {profile.target_type === 'folder' ? (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                          ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                          )}
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[#0F172B] truncate">{profile.name}</div>
                        <div className="text-[11px] text-[#999999] truncate">{profile.description || profile.category}</div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Selected profile details */}
            {selectedProfile && selectedProfile.target_type === 'folder' && selectedProfile.template?.lists && (
              <div className="mb-5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[#90A1B9] mb-1.5">Auto-created lists</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedProfile.template.lists.map((l, i) => (
                    <span key={i} className="rounded-full bg-[#F1F5F9] px-2.5 py-0.5 text-xs text-[#62748E]">
                      {l.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Error message */}
        {errorMessage && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{errorMessage}</p>
        )}

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
            disabled={!name.trim() || isPending}
            className="rounded-lg bg-[#0F172B] text-white px-4 py-2 text-sm font-medium hover:bg-[#1D293D] disabled:opacity-50"
          >
            {isPending ? 'Creating...' : `Create ${type === 'folder' ? 'Folder' : type === 'client' ? 'Client' : 'List'}`}
          </button>
        </div>
      </form>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}
