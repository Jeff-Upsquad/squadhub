import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAvailableClientSpaceTemplates } from '../../../hooks/useMyClients';
import api from '../../../services/api';
import type { ClientSpaceTemplate } from '@squadhub/shared';

export default function AddClientSpaceModal({
  clientId,
  clientName,
  onClose,
}: {
  clientId: string;
  clientName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<ClientSpaceTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: templates = [], isLoading } = useAvailableClientSpaceTemplates();

  const share = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('Pick a template');
      const res = await api.post(`/admin/client-spaces/${selected.id}/instances`, {
        client_id: clientId,
      });
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-folders', clientId] });
      onClose();
    },
    onError: (e: any) => {
      setError(e?.response?.data?.error || e?.message || 'Failed to share template');
    },
  });

  const canSubmit = !!selected && !share.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] p-6 shadow-2xl">
        <h2 className="mb-1 text-lg font-semibold text-[#0F172B]">Add space to {clientName}</h2>
        <p className="mb-5 text-xs text-[#666666]">Pick a template to create a new space under this client.</p>

        {isLoading ? (
          <div className="mb-5 rounded-lg border border-[#CAD5E2] bg-[#F8FAFC] p-3 text-sm text-[#999999]">
            Loading templates…
          </div>
        ) : templates.length === 0 ? (
          <div className="mb-5 rounded-lg border border-[#CAD5E2] bg-[#F8FAFC] p-3 text-xs text-[#999999]">
            No templates available. Ask an admin to create one in Admin → Client Spaces.
          </div>
        ) : (
          <div className="mb-5 grid grid-cols-1 gap-2">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelected(t)}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition ${
                  selected?.id === t.id
                    ? 'border-[#2962FF] bg-white ring-1 ring-[#2962FF]'
                    : 'border-[#CAD5E2] bg-[#F8FAFC] hover:border-[#2962FF]/50'
                }`}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[#9333ea]/10 text-[#9333ea]">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                    />
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
            ))}
          </div>
        )}

        {error && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-[#666666] hover:bg-[#E2E8F0]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => share.mutate()}
            disabled={!canSubmit}
            className="rounded-md bg-[#2962FF] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[#1E50E0] disabled:cursor-not-allowed disabled:bg-[#CAD5E2]"
          >
            {share.isPending ? 'Adding…' : 'Add Space'}
          </button>
        </div>
      </div>
    </div>
  );
}
