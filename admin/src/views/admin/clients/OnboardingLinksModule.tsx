import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type { OnboardingLink, SalesPerson } from '@squadhub/shared';
import SliderPanel from './SliderPanel';

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  used: 'bg-canvas text-foreground-muted',
  expired: 'bg-red-100 text-red-700',
};

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function OnboardingLinksModule() {
  const queryClient = useQueryClient();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [primaryId, setPrimaryId] = useState<string>('');
  const [secondaryId, setSecondaryId] = useState<string>('');
  const [justCreated, setJustCreated] = useState<OnboardingLink | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: linksRes, isLoading } = useQuery({
    queryKey: ['admin-onboarding-links'],
    queryFn: () => api.get('/admin/onboarding-links').then((r) => r.data),
  });
  const links: OnboardingLink[] = linksRes?.data || [];

  const { data: peopleRes } = useQuery({
    queryKey: ['admin-sales-people'],
    queryFn: () => api.get('/admin/onboarding-links/sales-people').then((r) => r.data),
  });
  const salesPeople: SalesPerson[] = peopleRes?.data || [];

  const { data: meRes } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get('/users/me').then((r) => r.data).catch(() => null),
  });
  const meId: string | null = meRes?.data?.id || null;

  const defaultPrimaryId = useMemo(() => {
    if (!meId) return '';
    const isEligible = salesPeople.some((p) => p.id === meId);
    return isEligible ? meId : salesPeople[0]?.id || '';
  }, [meId, salesPeople]);

  function openGenerate() {
    setPrimaryId(defaultPrimaryId);
    setSecondaryId('');
    setJustCreated(null);
    setGenerateOpen(true);
  }

  function closeGenerate() {
    setGenerateOpen(false);
    setJustCreated(null);
  }

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/admin/onboarding-links', {
        primary_sales_person_id: primaryId || undefined,
        secondary_sales_person_id: secondaryId || null,
      }).then((r) => r.data),
    onSuccess: (res) => {
      setJustCreated(res.data);
      queryClient.invalidateQueries({ queryKey: ['admin-onboarding-links'] });
    },
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed to generate link'),
  });

  function copyUrl(id: string, url: string) {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Invite Links</h1>
          <p className="mt-1 text-sm text-foreground-muted">Tokenized 7-day single-use onboarding links with sales attribution.</p>
        </div>
        <button
          onClick={openGenerate}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-strong"
        >
          + Generate Link
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-divider bg-surface">
        <table className="w-full">
          <thead className="bg-surface-alt text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
            <tr>
              <th className="px-4 py-3">Created by</th>
              <th className="px-4 py-3">Primary SP</th>
              <th className="px-4 py-3">Secondary SP</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Submission</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider text-sm text-foreground">
            {isLoading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-foreground-muted">Loading…</td></tr>
            ) : links.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-foreground-muted">No links generated yet.</td></tr>
            ) : (
              links.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-3">{l.created_by_user?.display_name || '—'}</td>
                  <td className="px-4 py-3">{l.primary_sales_person?.display_name || '—'}</td>
                  <td className="px-4 py-3">{l.secondary_sales_person?.display_name || '—'}</td>
                  <td className="px-4 py-3 text-foreground-muted">{formatDateTime(l.created_at)}</td>
                  <td className="px-4 py-3 text-foreground-muted">{formatDateTime(l.expires_at)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[l.status || 'active']}`}>
                      {l.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {l.submission ? (l.submission as any).business_name : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {l.status === 'active' && l.url && (
                      <button
                        onClick={() => copyUrl(l.id, l.url!)}
                        className="rounded-md border border-divider px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-alt"
                      >
                        {copiedId === l.id ? 'Copied!' : 'Copy URL'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <SliderPanel open={generateOpen} onClose={closeGenerate} title="Generate Onboarding Link">
        {!justCreated ? (
          <div className="space-y-5">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Primary Sales Person</label>
              <select
                value={primaryId}
                onChange={(e) => setPrimaryId(e.target.value)}
                className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
              >
                <option value="">Select…</option>
                {salesPeople.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name} ({p.email})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Secondary Sales Person (optional)</label>
              <select
                value={secondaryId}
                onChange={(e) => setSecondaryId(e.target.value)}
                className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
              >
                <option value="">None</option>
                {salesPeople
                  .filter((p) => p.id !== primaryId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.display_name} ({p.email})</option>
                  ))}
              </select>
            </div>
            <div className="rounded-md bg-surface-alt p-3 text-xs text-foreground-muted">
              Link expires in 7 days and can only be used for one submission.
            </div>
            <button
              onClick={() => createMutation.mutate()}
              disabled={!primaryId || createMutation.isPending}
              className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-50"
            >
              {createMutation.isPending ? 'Generating…' : 'Generate'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Share this URL</label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={justCreated.url || ''}
                  className="flex-1 rounded-md border border-divider bg-surface-alt px-3 py-2 text-sm text-foreground"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  onClick={() => copyUrl(justCreated.id, justCreated.url!)}
                  className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-strong"
                >
                  {copiedId === justCreated.id ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <div className="text-xs text-foreground-muted">
              Expires {formatDateTime(justCreated.expires_at)} · single-use
            </div>
            <button
              onClick={closeGenerate}
              className="w-full rounded-md border border-divider bg-surface px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface-alt"
            >
              Done
            </button>
          </div>
        )}
      </SliderPanel>
    </div>
  );
}
