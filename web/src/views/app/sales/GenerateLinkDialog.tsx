import { useEffect, useState } from 'react';
import type { SalesPerson, OnboardingLink } from '@squadhub/shared';
import SalesPersonSelect from './SalesPersonSelect';

interface GenerateLinkDialogProps {
  open: boolean;
  onClose: () => void;
  salesPeople: SalesPerson[];
  currentUserId: string | null;
  onCreate: (payload: { primary_sales_person_id?: string; secondary_sales_person_id?: string | null }) => Promise<OnboardingLink | undefined>;
}

export default function GenerateLinkDialog({ open, onClose, salesPeople, currentUserId, onCreate }: GenerateLinkDialogProps) {
  const [primaryId, setPrimaryId] = useState('');
  const [secondaryId, setSecondaryId] = useState('');
  const [justCreated, setJustCreated] = useState<OnboardingLink | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPrimaryId('');
    setSecondaryId('');
    setJustCreated(null);
    setError('');
    setCopied(false);
  }, [open]);

  useEffect(() => {
    if (!open || primaryId) return;
    if (salesPeople.length === 0) return;
    const eligibleMe = currentUserId && salesPeople.some((p) => p.id === currentUserId)
      ? currentUserId
      : '';
    setPrimaryId(eligibleMe || salesPeople[0]?.id || '');
  }, [open, currentUserId, salesPeople, primaryId]);

  if (!open) return null;

  async function submit() {
    setError('');
    setSubmitting(true);
    try {
      const res = await onCreate({
        primary_sales_person_id: primaryId || undefined,
        secondary_sales_person_id: secondaryId || null,
      });
      if (res) setJustCreated(res);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to generate link');
    } finally {
      setSubmitting(false);
    }
  }

  function copy() {
    if (justCreated?.url) {
      navigator.clipboard.writeText(justCreated.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl bg-[var(--surface)] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-[var(--sh-ink)]">Generate Invite Link</h3>
          <button onClick={onClose} className="rounded-md p-1 text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)]">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!justCreated ? (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">Primary Sales Person</label>
              <SalesPersonSelect
                value={primaryId}
                onChange={setPrimaryId}
                options={salesPeople.map((p) => ({
                  id: p.id,
                  label: p.display_name,
                  hint: p.id === currentUserId ? 'you' : undefined,
                }))}
                placeholder="Select…"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">Secondary Sales Person (optional)</label>
              <SalesPersonSelect
                value={secondaryId}
                onChange={setSecondaryId}
                options={[
                  { id: '', label: 'None' },
                  ...salesPeople
                    .filter((p) => p.id !== primaryId)
                    .map((p) => ({ id: p.id, label: p.display_name })),
                ]}
                placeholder="None"
              />
            </div>
            <div className="rounded-md bg-[var(--sh-hair-3)] px-3 py-2 text-xs text-[var(--sh-ink-3)]">
              Link expires in 7 days and can only be used for one submission.
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              onClick={submit}
              disabled={!primaryId || submitting}
              className="w-full rounded-md bg-[var(--sh-ink)] px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'Generating…' : 'Generate'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">Share this URL</label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={justCreated.url || ''}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 rounded-md border border-[var(--sh-hair)] bg-[var(--sh-hair-3)] px-3 py-2 text-sm text-[var(--sh-ink)]"
                />
                <button
                  onClick={copy}
                  className="rounded-md bg-[var(--sh-ink)] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <div className="text-xs text-[var(--sh-ink-3)]">
              Expires {new Date(justCreated.expires_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · single-use
            </div>
            <button
              onClick={onClose}
              className="w-full rounded-md border border-[var(--sh-hair)] px-4 py-2.5 text-sm font-medium text-[var(--sh-ink)] hover:bg-[var(--sh-hair-3)]"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
