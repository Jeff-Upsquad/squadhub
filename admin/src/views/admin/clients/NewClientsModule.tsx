import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type {
  ClientSubmission,
  Subscription,
  SubscriptionPlanRow,
  SubscriptionPlan,
} from '@squadhub/shared';
import SliderPanel from './SliderPanel';

const PLAN_ORDER: SubscriptionPlan[] = ['Starter', 'Basic', 'Plus', 'Pro', 'Personal'];

export default function NewClientsModule() {
  const queryClient = useQueryClient();
  const [selectedSubmission, setSelectedSubmission] = useState<ClientSubmission | null>(null);
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [rejectConfirm, setRejectConfirm] = useState(false);

  const { data: submissionsRes, isLoading } = useQuery({
    queryKey: ['admin-submissions'],
    queryFn: () => api.get('/admin/clients/submissions').then((r) => r.data),
  });
  const submissions: ClientSubmission[] = submissionsRes?.data || [];

  const { data: catalogRes } = useQuery({
    queryKey: ['admin-subs-catalog'],
    queryFn: () => api.get('/admin/subscriptions').then((r) => r.data),
  });
  const catalog: Subscription[] = catalogRes?.data || [];

  const approveMutation = useMutation({
    mutationFn: ({ id, plan_ids }: { id: string; plan_ids: string[] }) =>
      api.post(`/admin/clients/submissions/${id}/approve`, { plan_ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
      queryClient.invalidateQueries({ queryKey: ['admin-submissions-count'] });
      queryClient.invalidateQueries({ queryKey: ['admin-clients'] });
      queryClient.invalidateQueries({ queryKey: ['admin-clients-count'] });
      closeSlider();
    },
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed to approve'),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/clients/submissions/${id}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
      queryClient.invalidateQueries({ queryKey: ['admin-submissions-count'] });
      closeSlider();
    },
  });

  function closeSlider() {
    setSelectedSubmission(null);
    setSelectedPlanIds([]);
    setRejectConfirm(false);
  }

  function togglePlan(id: string) {
    setSelectedPlanIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  const filtered = submissions.filter((s) =>
    s.business_name.toLowerCase().includes(search.toLowerCase()) ||
    s.contact_person.toLowerCase().includes(search.toLowerCase())
  );

  const country = selectedSubmission?.country || 'India';

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">New Clients</h1>
        <p className="mt-1 text-sm text-[#62748E]">Review onboarding submissions and assign subscriptions</p>
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
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-[#E2E8F0] bg-white py-12 text-center">
          <p className="text-sm text-[#90A1B9]">{search ? 'No matching submissions.' : 'No pending submissions.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((sub) => (
            <button
              key={sub.id}
              onClick={() => setSelectedSubmission(sub)}
              className="flex w-full items-center justify-between rounded-lg border border-[#E2E8F0] bg-white px-5 py-4 text-left transition hover:shadow-sm"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 text-sm font-semibold">
                  {sub.business_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-[#0F172B]">{sub.business_name}</p>
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">New</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      sub.country === 'India' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                    }`}>
                      {sub.country}
                    </span>
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
          ))}
        </div>
      )}

      {/* Detail Slider */}
      <SliderPanel open={!!selectedSubmission} onClose={closeSlider} title="Review Submission" width="w-[520px]">
        {selectedSubmission && (
          <div className="space-y-6">
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">Business Details</h4>
              <InfoRow label="Business Name" value={selectedSubmission.business_name} />
              <InfoRow label="Country" value={selectedSubmission.country} />
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

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">
                Assign Plans ({country === 'India' ? 'INR' : 'USD'})
              </h4>

              <PlanPicker
                catalog={catalog}
                country={country}
                selectedPlanIds={selectedPlanIds}
                onToggle={togglePlan}
              />
            </div>

            <div className="space-y-2 pt-2">
              <button
                onClick={() => approveMutation.mutate({ id: selectedSubmission.id, plan_ids: selectedPlanIds })}
                disabled={selectedPlanIds.length === 0 || approveMutation.isPending}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {approveMutation.isPending ? 'Approving...' : `Approve & Move to Clients (${selectedPlanIds.length} plans)`}
              </button>

              {rejectConfirm ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => rejectMutation.mutate(selectedSubmission.id)}
                    disabled={rejectMutation.isPending}
                    className="flex-1 rounded-lg bg-red-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-50"
                  >
                    {rejectMutation.isPending ? 'Rejecting...' : 'Confirm Reject'}
                  </button>
                  <button
                    onClick={() => setRejectConfirm(false)}
                    className="flex-1 rounded-lg border border-[#E2E8F0] px-4 py-2.5 text-sm font-medium text-[#62748E] transition hover:bg-[#F1F5F9]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setRejectConfirm(true)}
                  className="w-full rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
                >
                  Reject Submission
                </button>
              )}
            </div>
          </div>
        )}
      </SliderPanel>
    </div>
  );
}

export function PlanPicker({
  catalog, country, selectedPlanIds, onToggle,
}: {
  catalog: Subscription[];
  country: 'India' | 'International';
  selectedPlanIds: string[];
  onToggle: (planId: string) => void;
}) {
  const priceField: 'price_inr' | 'price_usd' = country === 'India' ? 'price_inr' : 'price_usd';
  const sym = country === 'India' ? '\u20B9' : '$';

  const activeSubs = useMemo(() => catalog.filter((s) => s.is_active), [catalog]);

  if (activeSubs.length === 0) {
    return <p className="rounded-lg border border-[#E2E8F0] bg-white p-3 text-xs text-[#90A1B9]">No active subscriptions.</p>;
  }

  return (
    <div className="max-h-72 overflow-y-auto rounded-lg border border-[#E2E8F0] bg-white p-2">
      {activeSubs.map((sub) => {
        const plans: SubscriptionPlanRow[] = (sub.plans || [])
          .filter((p) => p.is_active && p[priceField] != null)
          .sort((a, b) => PLAN_ORDER.indexOf(a.plan) - PLAN_ORDER.indexOf(b.plan));

        return (
          <div key={sub.id} className="mb-2">
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-[#90A1B9]">{sub.name}</p>
            {plans.length === 0 ? (
              <p className="px-2 py-1 text-[11px] text-[#CBD5E1]">No plans priced for {country}.</p>
            ) : (
              plans.map((p) => {
                const price = p[priceField];
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
                        {sym}{(price || 0).toLocaleString(country === 'India' ? 'en-IN' : 'en-US')}/mo
                      </p>
                    </div>
                  </label>
                );
              })
            )}
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
