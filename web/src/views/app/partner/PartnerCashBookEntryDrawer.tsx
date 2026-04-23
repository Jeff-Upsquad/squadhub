import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';

// Right-side detail drawer for a single cashbook submission (entry / check /
// expense). Shows the full record incl. receipt photo, exposes prev/next
// chevrons to walk the current list, and a single primary action that
// posts/unposts the item via the existing partner mutations.
//
// All data needed is already in the parent's list query response, so this
// component takes the row directly — no refetch on open.

type Kind = 'entry' | 'check' | 'expense';

// Fetch a short-lived signed GET URL for a cashbook photo. The bucket is
// private, so we can't render photo_url directly.
function useSignedPhotoUrl(photoKey: string | null | undefined) {
  return useQuery({
    queryKey: ['partner-cashbook-photo-sign', photoKey],
    queryFn: async () => {
      if (!photoKey) return null;
      const { data } = await api.get('/partner/cashbook/photo/sign', {
        params: { key: photoKey },
      });
      if (!data.success) throw new Error(data.error || 'Failed to sign URL');
      return data.data.url as string;
    },
    enabled: !!photoKey,
    staleTime: 50 * 60 * 1000,
    gcTime: 55 * 60 * 1000,
  });
}

interface Props {
  kind: Kind;
  list: any[]; // The currently-displayed list (entries / checks / expenses)
  currentId: string;
  onSelectId: (id: string) => void;
  onClose: () => void;
  onTogglePosted: (id: string, isPosted: boolean) => void;
  isMutating: boolean;
}

const formatCurrency = (n: number | string) =>
  Number(n).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });

const formatDateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

function ReceiptPhoto({ photoKey }: { photoKey: string | null | undefined }) {
  const { data: url, isLoading, isError } = useSignedPhotoUrl(photoKey);
  if (!photoKey) return null;
  if (isLoading) {
    return (
      <div className="mb-5 flex h-[120px] items-center justify-center rounded-lg border border-divider bg-surface-alt text-xs text-[#64748B]">
        Loading photo…
      </div>
    );
  }
  if (isError || !url) {
    return (
      <div className="mb-5 flex h-[120px] items-center justify-center rounded-lg border border-divider bg-surface-alt text-xs text-[#DC2626]">
        Could not load photo
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-5 block overflow-hidden rounded-lg border border-divider bg-surface-alt"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Receipt"
        className="block h-auto max-h-[360px] w-full object-contain"
      />
    </a>
  );
}

export default function PartnerCashBookEntryDrawer({
  kind,
  list,
  currentId,
  onSelectId,
  onClose,
  onTogglePosted,
  isMutating,
}: Props) {
  const idx = list.findIndex((r) => r.id === currentId);
  const current = idx >= 0 ? list[idx] : null;
  const prev = idx > 0 ? list[idx - 1] : null;
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;

  // Esc closes; arrows walk prev/next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && prev) {
        onSelectId(prev.id);
      } else if (e.key === 'ArrowRight' && next) {
        onSelectId(next.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onSelectId, prev, next]);

  if (!current) {
    // Row vanished from the underlying list (filter changed, refetch lost it).
    // Close so we don't render a blank shell.
    return null;
  }

  const dateField = kind === 'check' ? current.check_date : current.entry_date;

  // Title varies by kind.
  let titleLine: string;
  if (kind === 'entry') {
    titleLine = `${current.entry_type === 'cash_in' ? 'Cash In' : 'Cash Out'} · ${formatCurrency(current.amount)}`;
  } else if (kind === 'check') {
    const checkLabel = current.check_type === 'collection' ? 'Collection' : 'Deposit';
    titleLine = `Check #${current.check_number} · ${checkLabel}`;
  } else {
    titleLine = `${current.entry_type === 'expense_out' ? 'Expense Out' : 'Reimbursement'} · ${formatCurrency(current.amount)}`;
  }

  return (
    <div className="fixed inset-0 z-[90]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px] animate-cb-fadeIn"
        onClick={onClose}
      />
      {/* Drawer panel */}
      <div
        className="absolute right-0 top-0 bottom-0 flex w-[min(560px,92vw)] flex-col border-l border-divider bg-surface shadow-2xl animate-cb-slideIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-divider px-5 py-3">
          <span className="font-mono text-[11px] text-foreground-dim">#{current.id.slice(0, 8)}</span>
          {current.is_posted ? (
            <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold text-green-400">Posted</span>
          ) : (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">Pending</span>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-foreground-muted transition-colors hover:bg-surface-alt hover:text-foreground"
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <h2 className="mb-5 text-xl font-semibold tracking-tight text-foreground">{titleLine}</h2>

          {/* Photo */}
          <ReceiptPhoto photoKey={current.photo_key} />

          {/* Property grid */}
          <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2.5 text-xs">
            <PropRow label="Date" value={dateField} />
            {kind !== 'check' && <PropRow label="Amount" value={<span className="font-medium text-foreground">{formatCurrency(current.amount)}</span>} />}

            {/* Entry-specific */}
            {kind === 'entry' && (
              <>
                <PropRow
                  label="Type"
                  value={
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${current.entry_type === 'cash_in' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                      {current.entry_type === 'cash_in' ? 'Cash In' : 'Cash Out'}
                    </span>
                  }
                />
                <PropRow label="Party" value={current.party_name || '—'} />
                <PropRow label="Payment mode" value={(current.payment_mode || '').replace('_', ' ') || '—'} valueClass="capitalize" />
                <PropRow label="Category" value={current.category?.name || '—'} />
                <PropRow label="Description" value={current.description || '—'} />
              </>
            )}

            {/* Check-specific */}
            {kind === 'check' && (
              <>
                <PropRow label="Amount" value={<span className="font-medium text-foreground">{formatCurrency(current.amount)}</span>} />
                <PropRow
                  label="Type"
                  value={<span className="capitalize">{current.check_type}</span>}
                />
                <PropRow label="Check #" value={<span className="font-mono">{current.check_number}</span>} />
                <PropRow label="Bank" value={current.bank_name || '—'} />
                <PropRow label="Party" value={current.party_name || '—'} />
                <PropRow
                  label="Status"
                  value={
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
                        current.status === 'cleared' ? 'bg-green-500/10 text-green-400' :
                        current.status === 'bounced' ? 'bg-red-500/10 text-red-400' :
                        current.status === 'deposited' ? 'bg-blue-500/10 text-blue-400' :
                        'bg-amber-500/10 text-amber-400'
                      }`}
                    >
                      {current.status}
                    </span>
                  }
                />
                {current.notes && <PropRow label="Notes" value={current.notes} />}
              </>
            )}

            {/* Expense-specific */}
            {kind === 'expense' && (
              <>
                <PropRow
                  label="Type"
                  value={
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${current.entry_type === 'expense_out' ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                      {current.entry_type === 'expense_out' ? 'Expense Out' : 'Reimbursement'}
                    </span>
                  }
                />
                <PropRow label="Nature" value={current.nature_of_expense || '—'} />
                <PropRow label="Payment mode" value={(current.payment_mode || '').replace('_', ' ') || '—'} valueClass="capitalize" />
                <PropRow label="Category" value={current.category?.name || '—'} />
                <PropRow label="Description" value={current.description || '—'} />
              </>
            )}

            {/* Common audit/footer */}
            <PropRow label="Submitted by" value={current.user?.display_name || '—'} />
            <PropRow label="Submitted at" value={formatDateTime(current.created_at)} />
            {current.is_posted && (
              <PropRow label="Posted at" value={formatDateTime(current.posted_at)} />
            )}
          </dl>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-divider bg-surface-alt px-5 py-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => prev && onSelectId(prev.id)}
              disabled={!prev}
              aria-label="Previous"
              className="rounded-md p-1.5 text-foreground-muted transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span className="px-2 text-[11px] tabular-nums text-foreground-dim">
              {idx + 1} of {list.length}
            </span>
            <button
              onClick={() => next && onSelectId(next.id)}
              disabled={!next}
              aria-label="Next"
              className="rounded-md p-1.5 text-foreground-muted transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
          {current.is_posted ? (
            <button
              onClick={() => onTogglePosted(current.id, true)}
              disabled={isMutating}
              className="rounded-md border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
            >
              Unmark as Posted
            </button>
          ) : (
            <button
              onClick={() => onTogglePosted(current.id, false)}
              disabled={isMutating}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Mark as Posted
            </button>
          )}
        </div>
      </div>

    </div>
  );
}

function PropRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-foreground-dim">{label}</dt>
      <dd className={`text-foreground-muted ${valueClass || ''}`}>{value}</dd>
    </>
  );
}
