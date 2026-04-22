import { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type {
  ClientSubmission,
  ClientSubmissionSubscription,
  Country,
  OnboardingLink,
  SalesPerson,
  SubmissionStatus,
} from '@squadhub/shared';
import { PIPELINE_STATUSES } from '@squadhub/shared';
import GenerateLinkDialog from './GenerateLinkDialog';
import LeadStatusChips, { STATUS_META } from '../../../components/LeadStatusChips';
import LeadSubscriptionsSection from './LeadSubscriptionsSection';

type Tab = 'leads' | 'links';

type LeadWithRole = ClientSubmission & {
  my_role?: 'primary' | 'secondary';
  selected_subscriptions?: ClientSubmissionSubscription[];
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const LINK_STATUS_COLOR: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  used: 'bg-slate-100 text-slate-600',
  expired: 'bg-red-100 text-red-700',
};

export default function SalesLeadsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('leads');
  const [generateOpen, setGenerateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: leadsRes, isLoading: leadsLoading } = useQuery({
    queryKey: ['sales-leads'],
    queryFn: () => api.get('/onboarding-links/leads').then((r) => r.data),
    enabled: tab === 'leads',
  });
  const leads: LeadWithRole[] = leadsRes?.data || [];

  const { data: linksRes, isLoading: linksLoading } = useQuery({
    queryKey: ['sales-links'],
    queryFn: () => api.get('/onboarding-links/my').then((r) => r.data),
    enabled: tab === 'links',
  });
  const links: OnboardingLink[] = linksRes?.data || [];

  const { data: peopleRes } = useQuery({
    queryKey: ['sales-people'],
    queryFn: () => api.get('/onboarding-links/sales-people').then((r) => r.data),
  });
  const salesPeople: SalesPerson[] = peopleRes?.data || [];

  const { data: meRes } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get('/users/me').then((r) => r.data),
  });
  const meId: string | null = meRes?.data?.id || null;

  const createMutation = useMutation({
    mutationFn: (payload: { primary_sales_person_id?: string; secondary_sales_person_id?: string | null }) =>
      api.post('/onboarding-links', payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-links'] });
    },
  });

  // Group leads by pipeline status, preserving PIPELINE_STATUSES order.
  const leadsByStatus = useMemo(() => {
    const bucket: Record<SubmissionStatus, LeadWithRole[]> = {
      new: [], in_progress: [], selection: [], converted: [], onboarding: [], closed: [],
    };
    for (const lead of leads) {
      const s = (lead.status as SubmissionStatus) || 'new';
      (bucket[s] = bucket[s] || []).push(lead);
    }
    return PIPELINE_STATUSES
      .map((s) => ({ status: s as SubmissionStatus, items: bucket[s] || [] }))
      .filter((g) => g.items.length > 0);
  }, [leads]);

  // Keep the detail panel's lead in sync with the refreshed list (so chip + subs update live after mutations).
  const selected: LeadWithRole | null = useMemo(() => {
    if (!selectedId) return null;
    return leads.find((l) => l.id === selectedId) || null;
  }, [leads, selectedId]);

  function copyUrl(id: string, url: string) {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--sh-hair)] bg-[var(--surface)] px-6 pt-5 pb-0">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-[var(--sh-ink)]">Sales Leads</h1>
            <p className="mt-0.5 text-sm text-[var(--sh-ink-3)]">Generate invite links and track the leads you source.</p>
          </div>
          <button
            onClick={() => setGenerateOpen(true)}
            className="rounded-md bg-[var(--sh-ink)] px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            + Generate Invite Link
          </button>
        </div>
        <div className="flex gap-1">
          <TabButton active={tab === 'leads'} onClick={() => setTab('leads')}>My Leads</TabButton>
          <TabButton active={tab === 'links'} onClick={() => setTab('links')}>My Invite Links</TabButton>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {tab === 'leads' ? (
          leadsLoading ? (
            <p className="py-8 text-center text-sm text-[var(--sh-ink-4)]">Loading…</p>
          ) : leadsByStatus.length === 0 ? (
            <div className="rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] py-12 text-center">
              <p className="text-sm text-[var(--sh-ink-4)]">No leads yet. Generate an invite link to get started.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {leadsByStatus.map((group) => {
                const meta = STATUS_META[group.status];
                return (
                  <div key={group.status}>
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                        style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
                        {meta.label}
                      </span>
                      <span className="text-xs text-[var(--sh-ink-4)]">({group.items.length})</span>
                    </div>
                    <div className="space-y-1.5">
                      {group.items.map((lead) => (
                        <button
                          key={lead.id}
                          onClick={() => setSelectedId(lead.id)}
                          className="flex w-full items-center justify-between rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] px-4 py-3 text-left transition hover:shadow-sm"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600 text-sm font-semibold">
                              {lead.business_name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-[var(--sh-ink)]">{lead.business_name}</p>
                              <p className="mt-0.5 text-xs text-[var(--sh-ink-3)]">{lead.contact_person}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {(lead.selected_subscriptions?.length ?? 0) > 0 && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                                {lead.selected_subscriptions!.length} sub{lead.selected_subscriptions!.length === 1 ? '' : 's'}
                              </span>
                            )}
                            <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-700">
                              {lead.my_role || (lead.primary_sales_person_id === meId ? 'primary' : 'secondary')}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          linksLoading ? (
            <p className="py-8 text-center text-sm text-[var(--sh-ink-4)]">Loading…</p>
          ) : links.length === 0 ? (
            <div className="rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] py-12 text-center">
              <p className="text-sm text-[var(--sh-ink-4)]">No invite links yet. Click Generate to create one.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)]">
              <table className="w-full">
                <thead className="bg-[var(--sh-hair-3)] text-left text-xs font-medium uppercase tracking-wide text-[var(--sh-ink-3)]">
                  <tr>
                    <th className="px-4 py-2.5">Primary SP</th>
                    <th className="px-4 py-2.5">Secondary SP</th>
                    <th className="px-4 py-2.5">Created</th>
                    <th className="px-4 py-2.5">Expires</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--sh-hair)] text-sm text-[var(--sh-ink)]">
                  {links.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2.5">{l.primary_sales_person?.display_name || '—'}</td>
                      <td className="px-4 py-2.5">{l.secondary_sales_person?.display_name || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--sh-ink-3)]">{formatDateTime(l.created_at)}</td>
                      <td className="px-4 py-2.5 text-[var(--sh-ink-3)]">{formatDateTime(l.expires_at)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${LINK_STATUS_COLOR[l.status || 'active']}`}>
                          {l.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {l.status === 'active' && l.url && (
                          <button
                            onClick={() => copyUrl(l.id, l.url!)}
                            className="rounded-md border border-[var(--sh-hair)] px-3 py-1 text-xs font-medium text-[var(--sh-ink)] hover:bg-[var(--sh-hair-3)]"
                          >
                            {copiedId === l.id ? 'Copied!' : 'Copy URL'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {selected && <LeadDetailPanelWrapper lead={selected} onClose={() => setSelectedId(null)} />}

      <GenerateLinkDialog
        open={generateOpen}
        onClose={() => { setGenerateOpen(false); setTab('links'); }}
        salesPeople={salesPeople}
        currentUserId={meId}
        onCreate={async (payload) => {
          const res = await createMutation.mutateAsync(payload);
          return res?.data;
        }}
      />
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
        active
          ? 'border-[var(--sh-ink)] text-[var(--sh-ink)]'
          : 'border-transparent text-[var(--sh-ink-3)] hover:text-[var(--sh-ink)]'
      }`}
    >
      {children}
    </button>
  );
}

function LeadDetailPanelWrapper({ lead, onClose }: { lead: LeadWithRole; onClose: () => void }) {
  const { data: countriesRes } = useQuery({
    queryKey: ['public-countries'],
    queryFn: () => api.get('/clients/countries').then((r) => r.data),
  });
  const countries: Country[] = countriesRes?.data || [];
  const countryName = countries.find((c) => c.id === lead.country_id)?.name;
  return <LeadDetailPanel lead={lead} countryName={countryName} onClose={onClose} />;
}

function LeadDetailPanel({ lead, countryName, onClose }: { lead: LeadWithRole; countryName: string | undefined; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setErrorMsg(null);
  }, [lead.id, lead.status]);

  const statusMutation = useMutation({
    mutationFn: (status: SubmissionStatus) =>
      api.patch(`/onboarding-links/leads/${lead.id}/status`, { status }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-leads'] });
      setErrorMsg(null);
    },
    onError: (err: any) => {
      setErrorMsg(err?.response?.data?.error || err.message || 'Failed to update status');
    },
  });

  const showSubs = lead.status === 'in_progress'
    || lead.status === 'selection'
    || lead.status === 'converted'
    || lead.status === 'onboarding';

  const subsLocked = lead.status === 'converted' || lead.status === 'closed';
  const selectedSubs = lead.selected_subscriptions || [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-[480px] flex-col bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--sh-hair)] px-5 py-4">
          <h3 className="text-base font-semibold text-[var(--sh-ink)]">{lead.business_name}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)]">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-sm">
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--sh-ink-4)]">Pipeline</h4>
            <LeadStatusChips
              value={lead.status as SubmissionStatus}
              onChange={(s) => statusMutation.mutate(s)}
              loading={statusMutation.isPending}
            />
            {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
          </div>

          {showSubs && (
            <LeadSubscriptionsSection
              leadId={lead.id}
              countryId={lead.country_id}
              selected={selectedSubs}
              disabled={subsLocked}
            />
          )}

          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--sh-ink-4)]">Business</h4>
            <div className="space-y-0">
              <InfoRow label="Billing Country" value={countryName || '—'} />
              <InfoRow label="Contact Person" value={lead.contact_person} />
              {lead.designation && <InfoRow label="Designation" value={lead.designation} />}
              <InfoRow label="Contact Number" value={lead.contact_number} />
              <InfoRow label="Email" value={lead.email} />
              <InfoRow label="Business Address" value={lead.business_address} />
              <InfoRow label="GST Registered" value={lead.gst_registered ? 'Yes' : 'No'} />
              {lead.gst_number && <InfoRow label="GST Number" value={lead.gst_number} />}
              {lead.accounts_email && <InfoRow label="Accounts Email" value={lead.accounts_email} />}
              <InfoRow label="Primary SP" value={lead.primary_sales_person?.display_name || '—'} />
              <InfoRow label="Secondary SP" value={lead.secondary_sales_person?.display_name || '—'} />
              <InfoRow label="Submitted" value={formatDateTime(lead.created_at)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[var(--sh-hair)] py-2 last:border-0">
      <span className="text-xs text-[var(--sh-ink-4)]">{label}</span>
      <span className="text-right text-sm text-[var(--sh-ink)]">{value}</span>
    </div>
  );
}
