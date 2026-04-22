import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type {
  ClientSubmission,
  ClientSubmissionSubscription,
  Country,
  Subscription,
  SubscriptionPlanRow,
  SubscriptionPlan,
  SubscriptionTier,
  SalesPerson,
  SubmissionStatus,
} from '@squadhub/shared';
import { PIPELINE_STATUSES } from '@squadhub/shared';
import SliderPanel from './SliderPanel';
import LeadStatusChips, { STATUS_META } from '../../../components/LeadStatusChips';
import AdminLeadSubscriptionsSection from './AdminLeadSubscriptionsSection';

const PLAN_ORDER: SubscriptionPlan[] = ['Starter', 'Basic', 'Plus', 'Pro', 'Personal'];
const TIERS: SubscriptionTier[] = ['Junior', 'Pro', 'Elite'];
const TIER_COLOR: Record<SubscriptionTier, string> = {
  Junior: 'bg-slate-100 text-slate-600',
  Pro: 'bg-indigo-100 text-indigo-700',
  Elite: 'bg-yellow-100 text-yellow-700',
};

type SubmissionWithStaged = ClientSubmission & {
  selected_subscriptions?: ClientSubmissionSubscription[];
};

export default function NewClientsModule() {
  const queryClient = useQueryClient();
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);

  const { data: submissionsRes, isLoading } = useQuery({
    queryKey: ['admin-submissions'],
    queryFn: () => api.get('/admin/clients/submissions').then((r) => r.data),
  });
  const submissions: SubmissionWithStaged[] = submissionsRes?.data || [];

  const { data: countriesRes } = useQuery({
    queryKey: ['admin-countries'],
    queryFn: () => api.get('/admin/countries').then((r) => r.data),
  });
  const countries: Country[] = countriesRes?.data || [];

  const { data: peopleRes } = useQuery({
    queryKey: ['admin-sales-people'],
    queryFn: () => api.get('/admin/onboarding-links/sales-people').then((r) => r.data),
  });
  const salesPeople: SalesPerson[] = peopleRes?.data || [];

  const [editPrimary, setEditPrimary] = useState<string>('');
  const [editSecondary, setEditSecondary] = useState<string>('');

  const selectedSubmission = useMemo(
    () => submissions.find((s) => s.id === selectedSubmissionId) || null,
    [submissions, selectedSubmissionId],
  );

  useEffect(() => {
    setEditPrimary(selectedSubmission?.primary_sales_person_id || '');
    setEditSecondary(selectedSubmission?.secondary_sales_person_id || '');
    setStatusError(null);
  }, [selectedSubmission?.id, selectedSubmission?.status]);

  const updateSpMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) =>
      api.patch(`/admin/clients/submissions/${id}/sales-people`, payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
    },
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed to update sales person'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: SubmissionStatus }) =>
      api.patch(`/admin/clients/submissions/${id}/status`, { status }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
      queryClient.invalidateQueries({ queryKey: ['admin-submissions-count'] });
      queryClient.invalidateQueries({ queryKey: ['admin-clients'] });
      queryClient.invalidateQueries({ queryKey: ['admin-clients-count'] });
      setStatusError(null);
    },
    onError: (err: any) => {
      setStatusError(err?.response?.data?.error || err.message || 'Failed to update status');
    },
  });

  function closeSlider() {
    setSelectedSubmissionId(null);
  }

  const filtered = submissions.filter((s) =>
    s.business_name.toLowerCase().includes(search.toLowerCase()) ||
    s.contact_person.toLowerCase().includes(search.toLowerCase())
  );

  // Group by pipeline status, preserving the PIPELINE_STATUSES order.
  const grouped = useMemo(() => {
    const bucket: Record<SubmissionStatus, SubmissionWithStaged[]> = {
      new: [], in_progress: [], selection: [], converted: [], onboarding: [], closed: [],
    };
    for (const s of filtered) {
      const st = (s.status as SubmissionStatus) || 'new';
      (bucket[st] = bucket[st] || []).push(s);
    }
    return PIPELINE_STATUSES
      .map((s) => ({ status: s as SubmissionStatus, items: bucket[s] || [] }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  const selectedCountry = selectedSubmission
    ? countries.find((c) => c.id === selectedSubmission.country_id) || null
    : null;

  const selectedSubs = selectedSubmission?.selected_subscriptions || [];
  const subsLocked = selectedSubmission?.status === 'converted' || selectedSubmission?.status === 'closed';

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">New Clients</h1>
        <p className="mt-1 text-sm text-[#62748E]">Track lead pipeline and assign subscriptions</p>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search submissions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172B] placeholder-[#90A1B9] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
        />
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-[#90A1B9]">Loading...</p>
      ) : grouped.length === 0 ? (
        <div className="rounded-lg border border-[#E2E8F0] bg-white py-12 text-center">
          <p className="text-sm text-[#90A1B9]">{search ? 'No matching submissions.' : 'No submissions yet.'}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => {
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
                  <span className="text-xs text-[#90A1B9]">({group.items.length})</span>
                </div>
                <div className="space-y-2">
                  {group.items.map((sub) => {
                    const countryName = countries.find((c) => c.id === sub.country_id)?.name;
                    return (
                      <button
                        key={sub.id}
                        onClick={() => setSelectedSubmissionId(sub.id)}
                        className="flex w-full items-center justify-between rounded-lg border border-[#E2E8F0] bg-white px-5 py-4 text-left transition hover:shadow-sm"
                      >
                        <div className="flex items-center gap-4">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 text-sm font-semibold">
                            {sub.business_name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-[#0F172B]">{sub.business_name}</p>
                              {countryName && (
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                  {countryName}
                                </span>
                              )}
                              {(sub.selected_subscriptions?.length ?? 0) > 0 && (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                                  {sub.selected_subscriptions!.length} sub{sub.selected_subscriptions!.length === 1 ? '' : 's'}
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-[#62748E]">
                              {sub.contact_person}{sub.designation ? ` - ${sub.designation}` : ''}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-[#90A1B9]">
                          {new Date(sub.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SliderPanel open={!!selectedSubmission} onClose={closeSlider} title="Lead" width="w-[520px]">
        {selectedSubmission && (
          <div className="space-y-6">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">Pipeline</h4>
              <LeadStatusChips
                value={selectedSubmission.status as SubmissionStatus}
                onChange={(s) => statusMutation.mutate({ id: selectedSubmission.id, status: s })}
                loading={statusMutation.isPending}
              />
              {statusError && <p className="text-xs text-red-600">{statusError}</p>}
            </div>

            <AdminLeadSubscriptionsSection
              submissionId={selectedSubmission.id}
              country={selectedCountry}
              countries={countries}
              selected={selectedSubs}
              disabled={subsLocked}
            />

            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">Sales Attribution</h4>
              <div>
                <label className="mb-1 block text-xs text-[#62748E]">Primary Sales Person</label>
                <select
                  value={editPrimary}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEditPrimary(v);
                    updateSpMutation.mutate({
                      id: selectedSubmission.id,
                      payload: { primary_sales_person_id: v || null },
                    });
                  }}
                  className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none"
                >
                  <option value="">— Not assigned —</option>
                  {salesPeople.map((p) => (
                    <option key={p.id} value={p.id}>{p.display_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-[#62748E]">Secondary Sales Person</label>
                <select
                  value={editSecondary}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEditSecondary(v);
                    updateSpMutation.mutate({
                      id: selectedSubmission.id,
                      payload: { secondary_sales_person_id: v || null },
                    });
                  }}
                  className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none"
                >
                  <option value="">— None —</option>
                  {salesPeople.filter((p) => p.id !== editPrimary).map((p) => (
                    <option key={p.id} value={p.id}>{p.display_name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">Business Details</h4>
              <InfoRow label="Business Name" value={selectedSubmission.business_name} />
              <InfoRow label="Country" value={selectedCountry?.name || 'Not set'} />
              <InfoRow label="Contact Person" value={selectedSubmission.contact_person} />
              {selectedSubmission.designation && <InfoRow label="Designation" value={selectedSubmission.designation} />}
              <InfoRow label="Contact Number" value={selectedSubmission.contact_number} />
              <InfoRow label="Email" value={selectedSubmission.email} />
              <InfoRow label="Business Address" value={selectedSubmission.business_address} />
              <InfoRow label="GST Registered" value={selectedSubmission.gst_registered ? 'Yes' : 'No'} />
              {selectedSubmission.gst_number && <InfoRow label="GST Number" value={selectedSubmission.gst_number} />}
              {selectedSubmission.accounts_email && <InfoRow label="Accounts Email" value={selectedSubmission.accounts_email} />}
              <InfoRow label="Submitted" value={new Date(selectedSubmission.created_at).toLocaleString('en-IN')} />
            </div>
          </div>
        )}
      </SliderPanel>
    </div>
  );
}

// ============================================================
// Plan picker — kept exported; used by ClientsModule for already-approved clients.
// ============================================================

export function PlanPicker({
  catalog, country, selectedPlanIds, onToggle,
}: {
  catalog: Subscription[];
  country: Country | null;
  selectedPlanIds: string[];
  onToggle: (planId: string) => void;
}) {
  const activeSubs = useMemo(() => catalog.filter((s) => s.is_active), [catalog]);

  if (!country) {
    return <p className="rounded-lg border border-[#E2E8F0] bg-white p-3 text-xs text-[#90A1B9]">Pick a country first.</p>;
  }
  if (activeSubs.length === 0) {
    return <p className="rounded-lg border border-[#E2E8F0] bg-white p-3 text-xs text-[#90A1B9]">No active subscriptions.</p>;
  }

  const sym = country.currency === 'INR' ? '\u20B9' : '$';
  const locale = country.currency === 'INR' ? 'en-IN' : 'en-US';

  return (
    <div className="max-h-80 space-y-3 overflow-y-auto rounded-lg border border-[#E2E8F0] bg-white p-2">
      {activeSubs.map((sub) => {
        const allPlans = (sub.plans || []).filter((p) => p.is_active);
        const priced: SubscriptionPlanRow[] = allPlans.filter((p) =>
          (p.pricing || []).some((pr) => pr.country_id === country.id),
        );

        if (priced.length === 0) {
          return (
            <div key={sub.id}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-[#90A1B9]">{sub.name}</p>
              <p className="px-2 py-1 text-[11px] text-[#CBD5E1]">No plans priced for {country.name}.</p>
            </div>
          );
        }

        return (
          <div key={sub.id}>
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-[#90A1B9]">{sub.name}</p>
            {TIERS.map((tier) => {
              const inTier = priced
                .filter((p) => p.tier === tier)
                .sort((a, b) => PLAN_ORDER.indexOf(a.plan) - PLAN_ORDER.indexOf(b.plan));
              if (inTier.length === 0) return null;
              return (
                <div key={tier} className="mb-1">
                  <div className="flex items-center gap-1.5 px-2 pt-1">
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${TIER_COLOR[tier]}`}>{tier}</span>
                  </div>
                  {inTier.map((p) => {
                    const price = (p.pricing || []).find((pr) => pr.country_id === country.id)?.price ?? 0;
                    return (
                      <label
                        key={p.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                          selectedPlanIds.includes(p.id) ? 'bg-blue-50' : 'hover:bg-[#F8FAFC]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedPlanIds.includes(p.id)}
                          onChange={() => onToggle(p.id)}
                          className="rounded border-[#E2E8F0] text-[#2962FF] focus:ring-[#2962FF]"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#0F172B]">{p.plan}</p>
                          <p className="text-xs text-[#90A1B9]">
                            {sym}{price.toLocaleString(locale)}/mo
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-[#F1F5F9] pb-2">
      <span className="text-xs text-[#90A1B9]">{label}</span>
      <span className="text-sm text-[#0F172B]">{value}</span>
    </div>
  );
}
