import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type {
  ClientSubmission,
  ClientSubmissionBrand,
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
import AdminLeadCardsSection from './AdminLeadCardsSection';
import AdminLeadJobCardsSection from './AdminLeadJobCardsSection';
import { openLeadInCRM } from '../../../utils/squadCrm';
import {
  lookupSquadhireBusiness,
  openSquadhireBusiness,
  type SquadhireBusinessMatch,
} from '../../../utils/squadHire';

const SERVICE_TYPE_LABEL: Record<string, string> = {
  designer: 'Designers',
  video_editor: 'Editors',
  designer_video_editor: 'Designer + Editor',
};

const PLAN_ORDER: SubscriptionPlan[] = ['Starter', 'Basic', 'Plus', 'Pro', 'Personal'];
const TIERS: SubscriptionTier[] = ['Junior', 'Pro', 'Top Talents'];
const TIER_COLOR: Record<SubscriptionTier, string> = {
  Junior: 'bg-canvas text-foreground-muted',
  Pro: 'bg-indigo-100 text-indigo-700',
  'Top Talents': 'bg-yellow-100 text-yellow-700',
};

type SubmissionWithStaged = ClientSubmission & {
  selected_subscriptions?: ClientSubmissionSubscription[];
};

export default function NewClientsModule() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);

  const { data: submissionsRes, isLoading } = useQuery({
    queryKey: ['admin-submissions'],
    queryFn: () => api.get('/admin/clients/submissions').then((r) => r.data),
  });
  const submissions: SubmissionWithStaged[] = submissionsRes?.data || [];

  // Deep-link support: ?submission=<id> auto-opens that submission once
  // the list has loaded. Only fires once per param value so closing the
  // slider doesn't immediately re-open it from the URL.
  const submissionParam = searchParams.get('submission');
  const handledParam = useRef<string | null>(null);
  useEffect(() => {
    if (!submissionParam) { handledParam.current = null; return; }
    if (handledParam.current === submissionParam) return;
    if (submissions.some((s) => s.id === submissionParam)) {
      setSelectedSubmissionId(submissionParam);
      handledParam.current = submissionParam;
    }
  }, [submissionParam, submissions]);

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

  // Reuses the same query key as AdminLeadCardsSection so the cache is shared
  // and we don't double-fetch. Needed here so the Convert button can enable
  // when the contact has Assigned cards but no staged subs.
  const { data: selectedCardsRes } = useQuery({
    queryKey: ['admin-submission-cards', selectedSubmissionId],
    queryFn: () =>
      api
        .get('/admin/subscription-cards', { params: { submission_id: selectedSubmissionId } })
        .then((r) => r.data),
    enabled: !!selectedSubmissionId,
  });
  const selectedCards: { state: string }[] = selectedCardsRes?.data || [];
  const assignedCardCount = selectedCards.filter((c) => c.state === 'assigned').length;

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
      // Auto-staging from Assigned cards back-fills submission_subscription_id
      // on those cards, so refresh the per-contact card list too.
      queryClient.invalidateQueries({ queryKey: ['admin-submission-cards'] });
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

  // Resolve + persist SquadHire business user for the Connections deep-link.
  // Passing submission_id lets the server use/store squadhire_business_user_id.
  const { data: hireMatch } = useQuery<SquadhireBusinessMatch>({
    queryKey: [
      'contact-squadhire-business',
      selectedSubmission?.id,
      selectedSubmission?.email,
      selectedSubmission?.contact_number,
    ],
    queryFn: () =>
      lookupSquadhireBusiness({
        email: selectedSubmission!.email,
        phone: selectedSubmission!.contact_number,
        submission_id: selectedSubmission!.id,
      }),
    enabled: !!selectedSubmission,
    staleTime: 2 * 60 * 1000,
  });

  const { data: contactDiag } = useQuery<{
    conflicts: Array<{ kind: string; message: string; email_id: string | null; phone_id: string | null }>;
  }>({
    queryKey: ['contact-identity-diagnosis', selectedSubmission?.id],
    queryFn: () =>
      api
        .get(`/admin/clients/submissions/${selectedSubmission!.id}/identity-diagnosis`)
        .then((r) => r.data.data),
    enabled: !!selectedSubmission,
    staleTime: 2 * 60 * 1000,
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Contacts</h1>
        <p className="mt-1 text-sm text-foreground-muted">Track contact pipeline and assign subscriptions</p>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search contacts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground placeholder-foreground-dim focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-foreground-dim">Loading...</p>
      ) : grouped.length === 0 ? (
        <div className="rounded-lg border border-divider bg-surface py-12 text-center">
          <p className="text-sm text-foreground-dim">{search ? 'No matching contacts.' : 'No contacts yet.'}</p>
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
                  <span className="text-xs text-foreground-dim">({group.items.length})</span>
                </div>
                <div className="space-y-2">
                  {group.items.map((sub) => {
                    const countryName = countries.find((c) => c.id === sub.country_id)?.name;
                    return (
                      <button
                        key={sub.id}
                        onClick={() => setSelectedSubmissionId(sub.id)}
                        className="flex w-full items-center justify-between rounded-lg border border-divider bg-surface px-5 py-4 text-left transition hover:shadow-sm"
                      >
                        <div className="flex items-center gap-4">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 text-sm font-semibold">
                            {sub.business_name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-foreground">{sub.business_name}</p>
                              {countryName && (
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                  {countryName}
                                </span>
                              )}
                              {(sub.selected_subscriptions?.length ?? 0) > 0 && (
                                <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-foreground-muted">
                                  {sub.selected_subscriptions!.length} sub{sub.selected_subscriptions!.length === 1 ? '' : 's'}
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-foreground-muted">
                              {sub.contact_person}{sub.designation ? ` - ${sub.designation}` : ''}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-foreground-dim">
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

      <SliderPanel open={!!selectedSubmission} onClose={closeSlider} title="Contact" width="w-[520px]">
        {selectedSubmission && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openLeadInCRM({
                  submission_id: selectedSubmission.id,
                  phone: selectedSubmission.contact_number,
                  email: selectedSubmission.email,
                })}
                title="Open this contact in Squad CRM"
                className="inline-flex items-center gap-1.5 rounded-md border border-divider bg-surface px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-alt transition"
              >
                Open in Squad CRM
                <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </button>
              {hireMatch?.found && (hireMatch.admin_url || (hireMatch.squadhireAdminUrl && hireMatch.business_user_id)) ? (
                <button
                  type="button"
                  onClick={() => openSquadhireBusiness(hireMatch)}
                  title={
                    hireMatch.company_name
                      ? `Open ${hireMatch.company_name} in SquadHire${hireMatch.matched_by ? ` (matched by ${hireMatch.matched_by})` : ''}`
                      : 'Open business user in SquadHire'
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border border-divider bg-surface px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-alt transition"
                >
                  Open in SquadHire
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  title="No matching business user in SquadHire"
                  className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-divider bg-surface px-2.5 py-1.5 text-xs font-semibold text-foreground-dim opacity-50"
                >
                  Open in SquadHire
                </button>
              )}
            </div>

            {(contactDiag?.conflicts?.length ?? 0) > 0 && (
              <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="text-xs font-semibold text-amber-900">Identity conflicts</p>
                {contactDiag!.conflicts.map((c, i) => (
                  <p key={i} className="text-xs text-amber-800">
                    <span className="font-medium uppercase tracking-wide">{c.kind.replace('_', ' ')}</span>
                    {' — '}
                    {c.message}
                  </p>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Pipeline</h4>
              <LeadStatusChips
                value={selectedSubmission.status as SubmissionStatus}
                onChange={(s) => statusMutation.mutate({ id: selectedSubmission.id, status: s })}
                loading={statusMutation.isPending}
              />
              {statusError && <p className="text-xs text-red-600">{statusError}</p>}
            </div>

            {(() => {
              const status = selectedSubmission.status as SubmissionStatus;
              if (status === 'converted' || status === 'onboarding' || status === 'closed') return null;
              const disabledReason = !selectedCountry
                ? 'Set a billing country first'
                : selectedSubs.length === 0 && assignedCardCount === 0
                  ? 'Add a subscription or assign a card first'
                  : null;
              const canConvert = !disabledReason;
              return (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    disabled={!canConvert || statusMutation.isPending}
                    onClick={() => {
                      statusMutation.mutate(
                        { id: selectedSubmission.id, status: 'converted' },
                        { onSuccess: () => closeSlider() },
                      );
                    }}
                    title={disabledReason || 'Materialise this contact into a client and copy its subscriptions over.'}
                    className="w-full rounded-md bg-[#15803D] px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#166534] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {statusMutation.isPending ? 'Converting…' : 'Convert to Client'}
                  </button>
                  {disabledReason && (
                    <p className="text-center text-[11px] text-foreground-dim">{disabledReason}</p>
                  )}
                </div>
              );
            })()}

            <AdminLeadSubscriptionsSection
              submissionId={selectedSubmission.id}
              country={selectedCountry}
              countries={countries}
              selected={selectedSubs}
              disabled={subsLocked}
            />

            <AdminLeadCardsSection submissionId={selectedSubmission.id} />

            <AdminLeadJobCardsSection submissionId={selectedSubmission.id} />

            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Sales Attribution</h4>
              <div>
                <label className="mb-1 block text-xs text-foreground-muted">Primary Sales Person</label>
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
                  className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
                >
                  <option value="">— Not assigned —</option>
                  {salesPeople.map((p) => (
                    <option key={p.id} value={p.id}>{p.display_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground-muted">Secondary Sales Person</label>
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
                  className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
                >
                  <option value="">— None —</option>
                  {salesPeople.filter((p) => p.id !== editPrimary).map((p) => (
                    <option key={p.id} value={p.id}>{p.display_name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Business Details</h4>
              <InfoRow label="Business Name" value={selectedSubmission.business_name} />
              <InfoRow label="Country" value={selectedCountry?.name || 'Not set'} />
              <InfoRow label="Contact Person" value={selectedSubmission.contact_person} />
              {selectedSubmission.designation && <InfoRow label="Designation" value={selectedSubmission.designation} />}
              <InfoRow label="Contact Number" value={selectedSubmission.contact_number} />
              <InfoRow label="Email" value={selectedSubmission.email} />
              {selectedSubmission.business_address && <InfoRow label="Business Address" value={selectedSubmission.business_address} />}
              <InfoRow label="GST Registered" value={selectedSubmission.gst_registered ? 'Yes' : 'No'} />
              {selectedSubmission.gst_number && <InfoRow label="GST Number" value={selectedSubmission.gst_number} />}
              {selectedSubmission.accounts_email && <InfoRow label="Accounts Email" value={selectedSubmission.accounts_email} />}
              <InfoRow label="Submitted" value={new Date(selectedSubmission.created_at).toLocaleString('en-IN')} />
            </div>

            {selectedSubmission.brands && selectedSubmission.brands.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Brands</h4>
                  <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-foreground-muted">
                    {selectedSubmission.brands.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {selectedSubmission.brands.map((b) => (
                    <BrandCard key={b.id} brand={b} countries={countries} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </SliderPanel>
    </div>
  );
}

// Map the upsquad-style service_type label stored on subscription_cards
// back to a display string. Mirrors the BrandServiceType slug map above,
// since cards use the label-form ("Designers"/"Editors"/"Designer plus
// Editor") while brand.service_type uses the slug form.
const CARD_SERVICE_TYPE_LABEL: Record<string, string> = {
  Designers: 'Designers',
  Editors: 'Editors',
  'Designer plus Editor': 'Designer + Editor',
};

function BrandCard({ brand, countries }: { brand: ClientSubmissionBrand; countries: Country[] }) {
  const talentCountry = brand.country_id ? countries.find((c) => c.id === brand.country_id)?.name : null;
  const serviceLabel = brand.service_type ? SERVICE_TYPE_LABEL[brand.service_type] || brand.service_type : null;

  // Per-role requirement details live on subscription_cards now. Only show
  // cards that actually have something to display, so the section stays
  // tight when contacts skip the optional fields.
  const cards = (brand.cards || []).filter(
    (c) => c.requirement_note || c.requirement_voice_url || c.hours_note,
  );
  // Fallback to the legacy brand-level requirement_note for older rows
  // that pre-date the per-role split (migration 083 onwards).
  const showLegacyRequirement = cards.length === 0 && !!brand.requirement_note;

  return (
    <div className="rounded-lg border border-divider bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground">{brand.brand_name}</p>
          {serviceLabel && (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
              {serviceLabel}
            </span>
          )}
        </div>
        <span className="text-[10px] text-foreground-dim">
          Updated {new Date(brand.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
        </span>
      </div>
      <div className="space-y-1.5">
        {brand.business_nature && <InfoRow label="Business Nature" value={brand.business_nature} />}
        {brand.business_note && <InfoRow label="About the Business" value={brand.business_note} />}
        {brand.business_location && <InfoRow label="Business Location" value={brand.business_location} />}
        {showLegacyRequirement && (
          <InfoRow label="Requirement" value={brand.requirement_note!} />
        )}
        {cards.length > 0 && (
          <div className="space-y-2 pt-1">
            {cards.map((c) => (
              <div key={c.id} className="rounded border border-divider bg-surface-alt p-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
                  {(c.service_type && CARD_SERVICE_TYPE_LABEL[c.service_type]) || c.service_type || 'Role'}
                </p>
                {c.requirement_note && <InfoRow label="Requirement" value={c.requirement_note} />}
                {c.requirement_voice_url && (
                  <div className="border-b border-divider pb-2">
                    <span className="text-xs text-foreground-dim">Voice note</span>
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <audio
                      controls
                      preload="none"
                      src={c.requirement_voice_url}
                      className="mt-1.5 h-9 w-full"
                    />
                  </div>
                )}
                {c.hours_note && <InfoRow label="Hours" value={c.hours_note} />}
              </div>
            ))}
          </div>
        )}
        {talentCountry && <InfoRow label="Talent Country" value={talentCountry} />}
        {brand.target_regions && brand.target_regions.length > 0 && (
          <InfoRow label="Regions" value={brand.target_regions.join(', ')} />
        )}
        {brand.target_languages && brand.target_languages.length > 0 && (
          <InfoRow label="Languages" value={brand.target_languages.join(', ')} />
        )}
        {brand.working_days && brand.working_days.length > 0 && (
          <InfoRow label="Working Days" value={brand.working_days.join(', ')} />
        )}
        {brand.target_tiers && brand.target_tiers.length > 0 && (
          <InfoRow label="Target Tiers" value={brand.target_tiers.join(', ')} />
        )}
      </div>
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
    return <p className="rounded-lg border border-divider bg-surface p-3 text-xs text-foreground-dim">Pick a country first.</p>;
  }
  if (activeSubs.length === 0) {
    return <p className="rounded-lg border border-divider bg-surface p-3 text-xs text-foreground-dim">No active subscriptions.</p>;
  }

  const sym = country.currency === 'INR' ? '\u20B9' : '$';
  const locale = country.currency === 'INR' ? 'en-IN' : 'en-US';

  return (
    <div className="max-h-80 space-y-3 overflow-y-auto rounded-lg border border-divider bg-surface p-2">
      {activeSubs.map((sub) => {
        const allPlans = (sub.plans || []).filter((p) => p.is_active);
        const priced: SubscriptionPlanRow[] = allPlans.filter((p) =>
          (p.pricing || []).some((pr) => pr.country_id === country.id),
        );

        if (priced.length === 0) {
          return (
            <div key={sub.id}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-dim">{sub.name}</p>
              <p className="px-2 py-1 text-[11px] text-foreground-dim">No plans priced for {country.name}.</p>
            </div>
          );
        }

        return (
          <div key={sub.id}>
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-dim">{sub.name}</p>
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
                          selectedPlanIds.includes(p.id) ? 'bg-blue-50' : 'hover:bg-surface-alt'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedPlanIds.includes(p.id)}
                          onChange={() => onToggle(p.id)}
                          className="rounded border-divider text-accent focus:ring-accent"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">{p.plan}</p>
                          <p className="text-xs text-foreground-dim">
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
    <div className="flex justify-between border-b border-divider pb-2">
      <span className="text-xs text-foreground-dim">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}
