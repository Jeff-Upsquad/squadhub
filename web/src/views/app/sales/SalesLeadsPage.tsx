import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type { ClientSubmission, OnboardingLink, SalesPerson } from '@squadhub/shared';
import GenerateLinkDialog from './GenerateLinkDialog';

type Tab = 'leads' | 'links';

type LeadWithRole = ClientSubmission & { my_role?: 'primary' | 'secondary' };

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  used: 'bg-slate-100 text-slate-600',
  expired: 'bg-red-100 text-red-700',
  pending: 'bg-blue-100 text-blue-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function SalesLeadsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('leads');
  const [generateOpen, setGenerateOpen] = useState(false);
  const [selected, setSelected] = useState<LeadWithRole | null>(null);
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

  const leadsByDate = useMemo(() => {
    const groups: { label: string; items: LeadWithRole[] }[] = [];
    const map = new Map<string, LeadWithRole[]>();
    for (const lead of leads) {
      const key = new Date(lead.created_at).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(lead);
    }
    for (const [key, items] of map.entries()) {
      const label = formatDateLabel(new Date(key).toISOString());
      groups.push({ label, items });
    }
    return groups;
  }, [leads]);

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
          ) : leadsByDate.length === 0 ? (
            <div className="rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] py-12 text-center">
              <p className="text-sm text-[var(--sh-ink-4)]">No leads yet. Generate an invite link to get started.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {leadsByDate.map((group) => (
                <div key={group.label}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--sh-ink-4)]">
                    {group.label}
                  </h3>
                  <div className="space-y-1.5">
                    {group.items.map((lead) => (
                      <button
                        key={lead.id}
                        onClick={() => setSelected(lead)}
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
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_COLOR[lead.status] || ''}`}>
                            {lead.status}
                          </span>
                          <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-700">
                            {lead.my_role || (lead.primary_sales_person_id === meId ? 'primary' : 'secondary')}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
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
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[l.status || 'active']}`}>
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

      {selected && <LeadDetailPanel lead={selected} onClose={() => setSelected(null)} />}

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

function LeadDetailPanel({ lead, onClose }: { lead: LeadWithRole; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-[440px] flex-col bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--sh-hair)] px-5 py-4">
          <h3 className="text-base font-semibold text-[var(--sh-ink)]">{lead.business_name}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)]">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3 text-sm">
          <InfoRow label="Contact Person" value={lead.contact_person} />
          {lead.designation && <InfoRow label="Designation" value={lead.designation} />}
          <InfoRow label="Contact Number" value={lead.contact_number} />
          <InfoRow label="Email" value={lead.email} />
          <InfoRow label="Business Address" value={lead.business_address} />
          <InfoRow label="GST Registered" value={lead.gst_registered ? 'Yes' : 'No'} />
          {lead.gst_number && <InfoRow label="GST Number" value={lead.gst_number} />}
          {lead.accounts_email && <InfoRow label="Accounts Email" value={lead.accounts_email} />}
          <InfoRow label="Status" value={lead.status} />
          <InfoRow label="Primary SP" value={lead.primary_sales_person?.display_name || '—'} />
          <InfoRow label="Secondary SP" value={lead.secondary_sales_person?.display_name || '—'} />
          <InfoRow label="Submitted" value={formatDateTime(lead.created_at)} />
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[var(--sh-hair)] pb-2 last:border-0">
      <span className="text-xs text-[var(--sh-ink-4)]">{label}</span>
      <span className="text-right text-sm text-[var(--sh-ink)]">{value}</span>
    </div>
  );
}
