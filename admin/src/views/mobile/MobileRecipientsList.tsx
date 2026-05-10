'use client';

import { useState } from 'react';
import type { PartnerRecipient, TalentRecipient } from '@/views/admin/AdminPublishedCardRecipientsPanel';
import MobileActionSheet from './MobileActionSheet';

const STATUS_PILL: Record<string, { bg: string; fg: string }> = {
  accepted: { bg: '#D1FAE5', fg: '#065F46' },
  rejected: { bg: '#FEE2E2', fg: '#991B1B' },
  pending: { bg: '#FEF3C7', fg: '#92400E' },
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

type ActionTarget = {
  type: 'partner' | 'talent';
  id: string;
  name: string;
  email?: string | null;
  canSelect: boolean;
  canAutoAccept: boolean;
};

export default function MobileRecipientsList({
  partners,
  talents,
  hasSelection,
  isCardActive,
  isManual,
  talentGroups,
  onSelectPartner,
  onSelectTalent,
  onRemovePartner,
  onRemoveTalent,
  onAutoAcceptTalent,
  isSelecting,
  isRemoving,
}: {
  partners: PartnerRecipient[];
  talents: TalentRecipient[];
  hasSelection: boolean;
  isCardActive: boolean;
  isManual?: boolean;
  talentGroups?: { pending: TalentRecipient[]; sentBatches: { notifiedAt: string; items: TalentRecipient[] }[] } | null;
  onSelectPartner: (id: string) => void;
  onSelectTalent: (id: string) => void;
  onRemovePartner: (id: string) => void;
  onRemoveTalent: (id: string) => void;
  onAutoAcceptTalent?: (id: string, name: string, email: string) => void;
  isSelecting: boolean;
  isRemoving: boolean;
}) {
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);

  const canSelectRecipients = !hasSelection && isCardActive;

  const renderTalentRow = (t: TalentRecipient) => (
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
          email: t.email,
          canSelect: canSelectRecipients && t.status === 'accepted' && !t.selected_at && !t.passed_over_at,
          canAutoAccept:
            !!isManual
            && !!onAutoAcceptTalent
            && isCardActive
            && t.status === 'pending'
            && !t.selected_at
            && !t.passed_over_at
            && !!t.email,
        })
      }
    />
  );

  return (
    <div className="space-y-5">
      {/* Partners */}
      <div>
        <h4 className="sh-section-heading mb-2 flex items-center gap-2">
          Partners
          <span className="rounded-full border border-[var(--color-sh-warm-border)] bg-[var(--color-sh-cream)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-sh-ink-subtle)]">
            {partners.length}
          </span>
        </h4>
        {partners.length === 0 ? (
          <p className="text-xs text-[var(--color-sh-ink-faint)]">No partners yet.</p>
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
                    canAutoAccept: false,
                  })
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Talents */}
      {isManual && talentGroups ? (
        <>
          {talentGroups.pending.length > 0 && (
            <div>
              <h4 className="sh-section-heading mb-2 flex items-center gap-2" style={{ color: '#B45309' }}>
                Pending broadcast
                <span className="rounded-full border border-[#FCD9B6] bg-[#FFF4E5] px-2 py-0.5 text-[10px] font-bold text-[#9A3412]">
                  {talentGroups.pending.length}
                </span>
              </h4>
              <div className="space-y-2">
                {talentGroups.pending.map(renderTalentRow)}
              </div>
            </div>
          )}
          {talentGroups.sentBatches.map((batch) => (
            <div key={batch.notifiedAt}>
              <h4 className="sh-section-heading mb-2 flex items-center gap-2">
                Sent {formatRelative(batch.notifiedAt)}
                <span className="rounded-full border border-[var(--color-sh-warm-border)] bg-[var(--color-sh-cream)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-sh-ink-subtle)]">
                  {batch.items.length}
                </span>
              </h4>
              <div className="space-y-2">
                {batch.items.map(renderTalentRow)}
              </div>
            </div>
          ))}
          {talentGroups.pending.length === 0 && talentGroups.sentBatches.length === 0 && (
            <div>
              <h4 className="sh-section-heading mb-2">Talents</h4>
              <p className="text-xs text-[var(--color-sh-ink-faint)]">No talents yet.</p>
            </div>
          )}
        </>
      ) : (
        <div>
          <h4 className="sh-section-heading mb-2 flex items-center gap-2">
            Talents
            <span className="rounded-full border border-[var(--color-sh-warm-border)] bg-[var(--color-sh-cream)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-sh-ink-subtle)]">
              {talents.length}
            </span>
          </h4>
          {talents.length === 0 ? (
            <p className="text-xs text-[var(--color-sh-ink-faint)]">No talents yet.</p>
          ) : (
            <div className="space-y-2">
              {talents.map(renderTalentRow)}
            </div>
          )}
        </div>
      )}

      <MobileActionSheet
        open={!!actionTarget}
        onClose={() => setActionTarget(null)}
        title={actionTarget?.name || ''}
        description="What would you like to do with this recipient?"
        actions={[
          ...(actionTarget?.canSelect
            ? [{
                label: 'Select for this card',
                variant: 'primary' as const,
                disabled: isSelecting,
                onPress: () => {
                  if (actionTarget.type === 'partner') onSelectPartner(actionTarget.id);
                  else onSelectTalent(actionTarget.id);
                  setActionTarget(null);
                },
              }]
            : []),
          ...(actionTarget?.canAutoAccept && actionTarget.email && onAutoAcceptTalent
            ? [{
                label: 'Auto-accept on their behalf',
                variant: 'success' as const,
                onPress: () => {
                  onAutoAcceptTalent(actionTarget.id, actionTarget.name, actionTarget.email!);
                  setActionTarget(null);
                },
              }]
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
  const pill = STATUS_PILL[status];
  return (
    <button
      onClick={onTap}
      className="sh-card sh-card-interactive flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--color-sh-ink)]">{name}</p>
        {subtitle && (
          <p className="truncate text-[11px] font-mono text-[var(--color-sh-ink-faint)]">{subtitle}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {selectedAt ? (
            <span className="sh-status-pill" style={{ backgroundColor: '#DBEAFE', color: '#1E40AF' }}>
              Selected
            </span>
          ) : passedOverAt ? (
            <span className="sh-status-pill" style={{ backgroundColor: 'var(--color-sh-cream)', color: 'var(--color-sh-ink-subtle)' }}>
              Not selected
            </span>
          ) : (
            <span className="sh-status-pill" style={{ backgroundColor: pill.bg, color: pill.fg }}>
              {status}
            </span>
          )}
          {assignedManually && (
            <span className="sh-status-pill" style={{ backgroundColor: 'var(--color-sh-cream)', color: 'var(--color-sh-ink-subtle)' }}>
              Manual
            </span>
          )}
          {respondedAt && (
            <span className="text-[10px] text-[var(--color-sh-ink-faint)]">{formatRelative(respondedAt)}</span>
          )}
        </div>
      </div>
      <svg className="h-4 w-4 shrink-0 text-[var(--color-sh-ink-faint)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
      </svg>
    </button>
  );
}
