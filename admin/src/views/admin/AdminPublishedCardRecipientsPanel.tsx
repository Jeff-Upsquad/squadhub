'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

type PartnerRecipient = {
  id: string;
  name: string;
  status: 'pending' | 'accepted' | 'rejected';
  responded_at: string | null;
};

type TalentRecipient = {
  external_user_id: string;
  name: string | null;
  status: 'accepted' | 'rejected';
  responded_at: string | null;
};

type RecipientsResponse = {
  partners: PartnerRecipient[];
  talents: TalentRecipient[];
};

function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const STATUS_CHIP: Record<'pending' | 'accepted' | 'rejected', string> = {
  accepted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-700',
};

export default function AdminPublishedCardRecipientsPanel({
  cardId,
  title,
  onClose,
}: {
  cardId: string;
  title: string;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-card-recipients', cardId],
    queryFn: () =>
      api.get(`/admin/subscription-cards/${cardId}/recipients`).then((r) => r.data?.data as RecipientsResponse),
  });

  const partnerGroups = useMemo(() => {
    const accepted = (data?.partners || []).filter((p) => p.status === 'accepted');
    const rejected = (data?.partners || []).filter((p) => p.status === 'rejected');
    const pending = (data?.partners || []).filter((p) => p.status === 'pending');
    return { accepted, rejected, pending };
  }, [data]);

  const talentGroups = useMemo(() => {
    const accepted = (data?.talents || []).filter((t) => t.status === 'accepted');
    const rejected = (data?.talents || []).filter((t) => t.status === 'rejected');
    return { accepted, rejected };
  }, [data]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-[480px] flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
          <h3 className="text-base font-semibold text-[#0F172B]">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-[#62748E] hover:bg-[#F8FAFC]">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-6 text-sm">
          {isLoading ? (
            <p className="text-center text-xs text-[#90A1B9]">Loading…</p>
          ) : error ? (
            <p className="text-center text-xs text-red-600">Failed to load recipients.</p>
          ) : (
            <>
              <Section title="Partners">
                <Subgroup label="Accepted" items={partnerGroups.accepted.map((p) => ({
                  key: p.id, name: p.name, status: p.status, responded_at: p.responded_at,
                }))} />
                <Subgroup label="Rejected" items={partnerGroups.rejected.map((p) => ({
                  key: p.id, name: p.name, status: p.status, responded_at: p.responded_at,
                }))} />
                <Subgroup label="Pending" items={partnerGroups.pending.map((p) => ({
                  key: p.id, name: p.name, status: p.status, responded_at: null,
                }))} />
              </Section>
              <Section title="Talents">
                <Subgroup label="Accepted" items={talentGroups.accepted.map((t) => ({
                  key: t.external_user_id,
                  name: t.name || 'Unknown talent',
                  subtitle: t.external_user_id.slice(0, 8),
                  status: t.status,
                  responded_at: t.responded_at,
                }))} />
                <Subgroup label="Rejected" items={talentGroups.rejected.map((t) => ({
                  key: t.external_user_id,
                  name: t.name || 'Unknown talent',
                  subtitle: t.external_user_id.slice(0, 8),
                  status: t.status,
                  responded_at: t.responded_at,
                }))} />
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">{title}</h4>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Subgroup({
  label,
  items,
}: {
  label: 'Accepted' | 'Rejected' | 'Pending';
  items: { key: string; name: string; subtitle?: string | null; status: 'accepted' | 'rejected' | 'pending'; responded_at: string | null }[];
}) {
  if (items.length === 0) {
    return (
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-[#62748E]">{label} (0)</p>
        <p className="text-xs text-[#90A1B9]">None.</p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-[#62748E]">
        {label} ({items.length})
      </p>
      <ul className="divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0]">
        {items.map((it) => (
          <li key={it.key} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0 flex-1 truncate">
              <p className="truncate text-sm text-[#0F172B]">{it.name}</p>
              {it.subtitle && (
                <p className="truncate text-[11px] font-mono text-[#90A1B9]">{it.subtitle}</p>
              )}
              {it.responded_at && (
                <p className="text-[11px] text-[#90A1B9]">{formatRelative(it.responded_at)}</p>
              )}
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CHIP[it.status]}`}>
              {it.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
