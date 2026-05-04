'use client';

import { useState } from 'react';
import type { PartnerRecipient, TalentRecipient } from '@/views/admin/AdminPublishedCardRecipientsPanel';
import MobileActionSheet from './MobileActionSheet';

const STATUS_COLORS: Record<string, string> = {
  accepted: 'border-emerald-600 bg-emerald-100 text-emerald-800',
  rejected: 'border-red-500 bg-red-100 text-red-800',
  pending: 'border-amber-500 bg-amber-100 text-amber-800',
};

function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function MobileRecipientsList({
  partners,
  talents,
  hasSelection,
  isCardActive,
  onSelectPartner,
  onSelectTalent,
  onRemovePartner,
  onRemoveTalent,
  isSelecting,
  isRemoving,
}: {
  partners: PartnerRecipient[];
  talents: TalentRecipient[];
  hasSelection: boolean;
  isCardActive: boolean;
  onSelectPartner: (id: string) => void;
  onSelectTalent: (id: string) => void;
  onRemovePartner: (id: string) => void;
  onRemoveTalent: (id: string) => void;
  isSelecting: boolean;
  isRemoving: boolean;
}) {
  const [actionTarget, setActionTarget] = useState<{
    type: 'partner' | 'talent';
    id: string;
    name: string;
    canSelect: boolean;
  } | null>(null);

  const canSelectRecipients = !hasSelection && isCardActive;

  return (
    <div className="space-y-5">
      {/* Partners */}
      <div>
        <h4 className="mb-2 flex items-center gap-2 font-[family-name:var(--font-jakarta)] text-xs font-bold uppercase tracking-wider text-[#a3a3a3]">
          Partners
          <span className="rounded-full border border-black/20 bg-[#F7F6F3] px-2 py-0.5 text-[10px] font-bold text-[#525252]">
            {partners.length}
          </span>
        </h4>
        {partners.length === 0 ? (
          <p className="text-xs text-[#a3a3a3]">No partners yet.</p>
        ) : (
          <div className="space-y-2">
            {partners.map((p) => (
              <RecipientRow
                key={p.id}
                name={p.name}
                status={p.status}
                respondedAt={p.responded_at}
                assignedManually={!!p.assigned_manually}
                selectedAt={p.selected_at ?? null}
                passedOverAt={p.passed_over_at ?? null}
                onTap={() =>
                  setActionTarget({
                    type: 'partner',
                    id: p.id,
                    name: p.name,
                    canSelect: canSelectRecipients && p.status === 'accepted' && !p.selected_at && !p.passed_over_at,
                  })
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Talents */}
      <div>
        <h4 className="mb-2 flex items-center gap-2 font-[family-name:var(--font-jakarta)] text-xs font-bold uppercase tracking-wider text-[#a3a3a3]">
          Talents
          <span className="rounded-full border border-black/20 bg-[#F7F6F3] px-2 py-0.5 text-[10px] font-bold text-[#525252]">
            {talents.length}
          </span>
        </h4>
        {talents.length === 0 ? (
          <p className="text-xs text-[#a3a3a3]">No talents yet.</p>
        ) : (
          <div className="space-y-2">
            {talents.map((t) => (
              <RecipientRow
                key={t.external_user_id}
                name={t.name || 'Unknown talent'}
                subtitle={t.external_user_id.slice(0, 8)}
                status={t.status}
                respondedAt={t.responded_at}
                assignedManually={!!t.assigned_manually}
                selectedAt={t.selected_at ?? null}
                passedOverAt={t.passed_over_at ?? null}
                onTap={() =>
                  setActionTarget({
                    type: 'talent',
                    id: t.external_user_id,
                    name: t.name || 'Unknown talent',
                    canSelect: canSelectRecipients && t.status === 'accepted' && !t.selected_at && !t.passed_over_at,
                  })
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Action sheet for recipient */}
      <MobileActionSheet
        open={!!actionTarget}
        onClose={() => setActionTarget(null)}
        title={actionTarget?.name || ''}
        description="What would you like to do with this recipient?"
        actions={[
          ...(actionTarget?.canSelect
            ? [
                {
                  label: 'Select for this card',
                  variant: 'primary' as const,
                  disabled: isSelecting,
                  onPress: () => {
                    if (actionTarget.type === 'partner') onSelectPartner(actionTarget.id);
                    else onSelectTalent(actionTarget.id);
                    setActionTarget(null);
                  },
                },
              ]
            : []),
          {
            label: 'Remove from card',
            variant: 'danger' as const,
            disabled: isRemoving,
            onPress: () => {
              if (actionTarget?.type === 'partner') onRemovePartner(actionTarget.id);
              else if (actionTarget) onRemoveTalent(actionTarget.id);
              setActionTarget(null);
            },
          },
        ]}
      />
    </div>
  );
}

function RecipientRow({
  name,
  subtitle,
  status,
  respondedAt,
  assignedManually,
  selectedAt,
  passedOverAt,
  onTap,
}: {
  name: string;
  subtitle?: string;
  status: 'pending' | 'accepted' | 'rejected';
  respondedAt: string | null;
  assignedManually: boolean;
  selectedAt: string | null;
  passedOverAt: string | null;
  onTap: () => void;
}) {
  return (
    <button
      onClick={onTap}
      className="flex w-full items-center justify-between gap-3 rounded-xl border-2 border-black/10 bg-white px-3.5 py-3 text-left active:bg-[#F7F6F3] transition-colors"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#0a0a0a]">{name}</p>
        {subtitle && (
          <p className="truncate text-[11px] font-mono text-[#a3a3a3]">{subtitle}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {selectedAt ? (
            <span className="rounded-full border border-blue-600 bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">
              Selected
            </span>
          ) : passedOverAt ? (
            <span className="rounded-full border border-[#a3a3a3] bg-[#F7F6F3] px-2 py-0.5 text-[10px] font-bold text-[#525252]">
              Not selected
            </span>
          ) : (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_COLORS[status]}`}>
              {status}
            </span>
          )}
          {assignedManually && (
            <span className="rounded-full border border-[#a3a3a3] bg-[#F7F6F3] px-2 py-0.5 text-[10px] font-semibold text-[#525252]">
              Manual
            </span>
          )}
          {respondedAt && (
            <span className="text-[10px] text-[#a3a3a3]">{formatRelative(respondedAt)}</span>
          )}
        </div>
      </div>
      <svg className="h-4 w-4 shrink-0 text-[#a3a3a3]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
      </svg>
    </button>
  );
}
