import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type { ClientSubmission, Subscription } from '@squadhub/shared';
import SliderPanel from './SliderPanel';

export default function NewClientsModule() {
  const queryClient = useQueryClient();
  const [selectedSubmission, setSelectedSubmission] = useState<ClientSubmission | null>(null);
  const [selectedSubscriptionIds, setSelectedSubscriptionIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [rejectConfirm, setRejectConfirm] = useState(false);

  const { data: submissionsRes, isLoading } = useQuery({
    queryKey: ['admin-submissions'],
    queryFn: () => api.get('/admin/clients/submissions').then((r) => r.data),
  });
  const submissions: ClientSubmission[] = submissionsRes?.data || [];

  const { data: subscriptionsRes } = useQuery({
    queryKey: ['admin-subscriptions'],
    queryFn: () => api.get('/admin/clients/subscriptions').then((r) => r.data),
  });
  const subscriptions: Subscription[] = subscriptionsRes?.data || [];

  const approveMutation = useMutation({
    mutationFn: ({ id, subscription_ids }: { id: string; subscription_ids: string[] }) =>
      api.post(`/admin/clients/submissions/${id}/approve`, { subscription_ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
      queryClient.invalidateQueries({ queryKey: ['admin-submissions-count'] });
      queryClient.invalidateQueries({ queryKey: ['admin-clients'] });
      queryClient.invalidateQueries({ queryKey: ['admin-clients-count'] });
      closeSlider();
    },
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
    setSelectedSubscriptionIds([]);
    setRejectConfirm(false);
  }

  function toggleSubscription(id: string) {
    setSelectedSubscriptionIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  function removeSubscription(id: string) {
    setSelectedSubscriptionIds((prev) => prev.filter((s) => s !== id));
  }

  const filtered = submissions.filter((s) =>
    s.business_name.toLowerCase().includes(search.toLowerCase()) ||
    s.contact_person.toLowerCase().includes(search.toLowerCase())
  );

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
            {/* Submitted data */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">Business Details</h4>
              <InfoRow label="Business Name" value={selectedSubmission.business_name} />
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

            {/* Assign subscriptions */}
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">Assign Subscriptions</h4>

              {/* Selected chips */}
              {selectedSubscriptionIds.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {selectedSubscriptionIds.map((id) => {
                    const sub = subscriptions.find((s) => s.id === id);
                    return sub ? (
                      <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[#0F172B] px-2.5 py-1 text-xs text-white">
                        {sub.name}
                        <button onClick={() => removeSubscription(id)} className="ml-0.5 hover:text-red-300">
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ) : null;
                  })}
                </div>
              )}

              {/* Subscription list to pick from */}
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-[#E2E8F0] p-2">
                {subscriptions.length === 0 ? (
                  <p className="py-4 text-center text-xs text-[#90A1B9]">No subscriptions created yet. Create some first.</p>
                ) : (
                  subscriptions.map((sub) => (
                    <label
                      key={sub.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                        selectedSubscriptionIds.includes(sub.id) ? 'bg-blue-50' : 'hover:bg-[#F8FAFC]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSubscriptionIds.includes(sub.id)}
                        onChange={() => toggleSubscription(sub.id)}
                        className="rounded border-[#E2E8F0] text-[#2962FF] focus:ring-[#2962FF]"
                      />
                      <div className="flex-1">
                        <span className="text-[#0F172B]">{sub.name}</span>
                        <span className="ml-2 text-xs text-[#90A1B9]">{'\u20B9'}{sub.price.toLocaleString('en-IN')}/mo</span>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-2">
              <button
                onClick={() => approveMutation.mutate({ id: selectedSubmission.id, subscription_ids: selectedSubscriptionIds })}
                disabled={selectedSubscriptionIds.length === 0 || approveMutation.isPending}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {approveMutation.isPending ? 'Approving...' : `Approve & Move to Clients (${selectedSubscriptionIds.length} subscriptions)`}
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-[#F1F5F9] pb-2">
      <span className="text-xs text-[#90A1B9]">{label}</span>
      <span className="text-sm text-[#0F172B]">{value}</span>
    </div>
  );
}
