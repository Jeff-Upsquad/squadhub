import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useCreateFolder } from '../../../hooks/useSpaces';
import { useAvailableClientSpaceTemplates } from '../../../hooks/useMyClients';
import type { ClientSpaceTemplate } from '@squadhub/shared';

const CATEGORY_COLORS: Record<string, string> = {
  design: '#9333ea',
  video: '#ec4899',
  development: '#3b82f6',
  marketing: '#f97316',
  general: '#6b7280',
};

export default function CreateAreaSpaceModal({
  spaceId,
  parentFolderId,
  onClose,
}: {
  spaceId: string;
  parentFolderId?: string;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<ClientSpaceTemplate | null>(null);
  const createFolder = useCreateFolder(spaceId);
  const { data: templates = [], isLoading } = useAvailableClientSpaceTemplates();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    createFolder.mutate(
      {
        name: selected.name,
        client_space_template_id: selected.id,
        skip_template_lists: true,
        ...(parentFolderId ? { parent_folder_id: parentFolderId } : {}),
      },
      { onSuccess: onClose },
    );
  };

  const error = createFolder.error as any;
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
        <h2 className="mb-1 text-lg font-semibold text-[#0F172B] font-[family-name:var(--font-display)]">
          Create Space
        </h2>
        <p className="mb-5 text-xs text-[#666666]">Pick a template to create a new space under this area.</p>

        {/* Template selection */}
        <label className="mb-2 block text-sm font-medium text-[#666666] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">
          Type
        </label>

        <div className="mb-5 grid grid-cols-1 gap-2">
          {isLoading ? (
            <div className="flex items-center justify-center rounded-lg border border-[#E2E8F0] bg-white p-3">
              <span className="text-xs text-[#90A1B9]">Loading...</span>
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded-lg border border-[#E2E8F0] bg-white p-3 text-xs text-[#999999]">
              No templates available. Ask an admin to create one in Admin → Client Spaces.
            </div>
          ) : (
            templates.map((t) => {
              const catColor = CATEGORY_COLORS[t.category] || CATEGORY_COLORS.general;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelected(t)}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition ${
                    selected?.id === t.id
                      ? 'border-[#2962FF] bg-[#F0F4FF] ring-1 ring-[#2962FF]'
                      : 'border-[#E2E8F0] bg-white hover:border-[#CAD5E2]'
                  }`}
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${catColor}10` }}
                  >
                    <svg className="h-4 w-4" style={{ color: catColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[#0F172B]">{t.name}</div>
                    {t.description && (
                      <div className="mt-0.5 text-[11px] leading-snug text-[#666666]">{t.description}</div>
                    )}
                    {t.template?.lists && t.template.lists.length > 0 && (
                      <div className="mt-1.5 text-[10px] uppercase tracking-[0.08em] text-[#999999]">
                        Creates: {t.template.lists.map((l) => l.name).join(' · ')}
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

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
            disabled={!selected || createFolder.isPending}
            className="rounded-lg bg-[#0F172B] text-white px-4 py-2 text-sm font-medium hover:bg-[#1D293D] disabled:opacity-50"
          >
            {createFolder.isPending ? 'Creating...' : 'Create Space'}
          </button>
        </div>
      </form>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}
