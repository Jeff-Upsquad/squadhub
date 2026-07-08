'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BrandProfile, BusinessProfile, JobCard, JobProfile } from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import BusinessProfileForm from './BusinessProfileForm';
import BusinessLocationsEditor from './BusinessLocationsEditor';
import BrandProfileForm from './BrandProfileForm';
import JobProfileForm from './JobProfileForm';

// Onboarding builder — the 3-step profile hierarchy behind a job card:
//   1. Business Profile (required parent, exactly ONE per lead) + saved
//      interview locations — brands and locations multiply beneath it,
//      the business itself doesn't
//   2. Brand Profile   (optional, 0..n per business)
//   3. Job Profile     (linked to the business OR one of its brands)
// Finishing attaches the job profile to the card (new → onboarding) via
// POST /admin/job-cards/:id/attach-profile.

type Step = 1 | 2 | 3;

const STEP_META: Record<Step, { title: string; blurb: string }> = {
  1: { title: 'Business profile', blurb: 'The required parent — everything a candidate should know about the business, plus saved interview venues.' },
  2: { title: 'Brand profile', blurb: 'Optional — add brands when the job belongs to a specific brand under the business.' },
  3: { title: 'Job profile', blurb: 'The role itself, with candidate preference rules and SquadHire categories.' },
};

export default function OnboardingPanel({
  card,
  onClose,
  onAttached,
}: {
  card: JobCard;
  onClose: () => void;
  onAttached: () => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [creatingBusiness, setCreatingBusiness] = useState(false);
  const [editingBusiness, setEditingBusiness] = useState(false);
  const [brandForm, setBrandForm] = useState<{ open: boolean; brand: BrandProfile | null }>({ open: false, brand: null });
  const [jobProfileForm, setJobProfileForm] = useState<{ open: boolean; profile: JobProfile | null }>({ open: false, profile: null });

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  // A lead has exactly ONE business profile — find the card's lead/client one
  // and auto-select it. The list endpoint returns all, filter client-side.
  const { data: businessesRes, isLoading: businessesLoading } = useQuery({
    queryKey: ['admin-job-business-profiles'],
    queryFn: () => api.get('/admin/jobs/business-profiles').then((r) => r.data),
  });
  const businesses: BusinessProfile[] = businessesRes?.data || [];
  const leadBusinesses = businesses.filter(
    (b) =>
      (card.lead_submission_id && b.lead_submission_id === card.lead_submission_id) ||
      (card.client_id && b.client_id === card.client_id),
  );

  // If the card is already mid-onboarding, resume with its profile's business.
  useEffect(() => {
    if (!businessId && card.job_profile?.business_profile_id) {
      setBusinessId(card.job_profile.business_profile_id);
    }
  }, [businessId, card.job_profile]);

  // Legacy data may hold duplicate business profiles for one lead. Fetch each
  // candidate's detail (same queryKey as the detail query below, so the cache
  // is shared) and auto-select the best one: most dependents
  // (brands + locations + job profiles), tiebreak newest. The rest are
  // silently ignored — data cleanup is handled elsewhere.
  const leadBusinessQueries = useQueries({
    queries: leadBusinesses.map((b) => ({
      queryKey: ['admin-job-business-profile', b.id],
      queryFn: () => api.get(`/admin/jobs/business-profiles/${b.id}`).then((r) => r.data),
    })),
  });
  const resolvingLeadBusiness =
    businessesLoading || (leadBusinesses.length > 0 && leadBusinessQueries.some((q) => q.isPending));

  useEffect(() => {
    if (businessId || creatingBusiness || resolvingLeadBusiness || leadBusinesses.length === 0) return;
    const dependents = (i: number) => {
      const d: BusinessProfile | undefined = leadBusinessQueries[i]?.data?.data;
      return (d?.brands?.length ?? 0) + (d?.locations?.length ?? 0) + (d?.job_profiles?.length ?? 0);
    };
    let best = 0;
    for (let i = 1; i < leadBusinesses.length; i++) {
      const gap = dependents(i) - dependents(best);
      if (gap > 0 || (gap === 0 && leadBusinesses[i].created_at > leadBusinesses[best].created_at)) best = i;
    }
    setBusinessId(leadBusinesses[best].id);
  }, [businessId, creatingBusiness, resolvingLeadBusiness, leadBusinesses, leadBusinessQueries]);

  // Detail (locations + brands + job profiles) for the chosen business.
  const { data: businessRes } = useQuery({
    queryKey: ['admin-job-business-profile', businessId],
    queryFn: () => api.get(`/admin/jobs/business-profiles/${businessId}`).then((r) => r.data),
    enabled: !!businessId,
  });
  const business: BusinessProfile | null = businessRes?.data || null;
  const brands = business?.brands ?? [];
  const locations = business?.locations ?? [];
  const jobProfiles = business?.job_profiles ?? [];

  const attach = useMutation({
    mutationFn: (jobProfileId: string) =>
      api.post(`/admin/job-cards/${card.id}/attach-profile`, { job_profile_id: jobProfileId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-job-cards'] });
      showToast('Job profile attached — the card moved to Onboarding.', 'success');
      onAttached();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to attach the job profile', 'error');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-3xl flex-col bg-surface shadow-2xl">
        {/* Header + stepper */}
        <div className="border-b border-divider px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-[family-name:var(--font-display)] text-base font-semibold text-foreground">
                Onboarding · {card.customer_company || card.customer_name || 'Job card'}
              </h3>
              <p className="text-xs text-foreground-muted">{STEP_META[step].blurb}</p>
            </div>
            <button onClick={onClose} className="rounded-md p-1 text-foreground-dim transition hover:bg-canvas hover:text-foreground">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {([1, 2, 3] as Step[]).map((s) => {
              const enabled = s === 1 || !!businessId;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={!enabled}
                  onClick={() => enabled && setStep(s)}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    step === s
                      ? 'border-ink bg-sh-lime-soft text-sh-ink'
                      : enabled
                        ? 'border-divider text-foreground-muted hover:border-ink hover:text-foreground'
                        : 'border-divider text-foreground-dim opacity-50'
                  }`}
                >
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-canvas text-[10px]">{s}</span>
                  {STEP_META[s].title}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* ── Step 1: business profile ─────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              {creatingBusiness || (editingBusiness && business) ? (
                <BusinessProfileForm
                  profile={editingBusiness ? business : null}
                  leadSubmissionId={card.lead_submission_id}
                  clientId={card.client_id}
                  onSaved={(saved) => {
                    setBusinessId(saved.id);
                    setCreatingBusiness(false);
                    setEditingBusiness(false);
                  }}
                  onCancel={() => {
                    setCreatingBusiness(false);
                    setEditingBusiness(false);
                  }}
                />
              ) : (
                <>
                  {resolvingLeadBusiness || (businessId && !business) ? (
                    <p className="py-4 text-center text-xs text-foreground-dim">Loading…</p>
                  ) : businessId && business ? (
                    // The lead's ONE business profile — auto-selected, no picking.
                    <div className="space-y-4 rounded-lg border border-divider bg-surface-alt p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{business.name}</p>
                          <p className="mt-0.5 truncate text-xs text-foreground-muted">
                            {[business.industry, business.company_size && `${business.company_size} people`].filter(Boolean).join(' · ') || '—'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEditingBusiness(true)}
                          className="shrink-0 rounded-md border border-divider px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground"
                        >
                          Edit profile
                        </button>
                      </div>
                      <BusinessLocationsEditor businessProfileId={business.id} />
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-foreground">Business profile</p>
                        <button
                          type="button"
                          onClick={() => setCreatingBusiness(true)}
                          className="rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
                        >
                          + New business profile
                        </button>
                      </div>
                      <p className="rounded-lg border border-dashed border-divider px-4 py-6 text-center text-xs text-foreground-dim">
                        No business profile yet — create the one for this lead.
                      </p>
                    </>
                  )}

                  <div className="flex justify-end border-t border-divider pt-4">
                    <button
                      type="button"
                      disabled={!businessId}
                      onClick={() => setStep(2)}
                      className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                    >
                      Continue to brands →
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Step 2: brand profiles (optional) ────────────────────── */}
          {step === 2 && businessId && (
            <div className="space-y-4">
              {brandForm.open ? (
                <BrandProfileForm
                  businessProfileId={businessId}
                  brand={brandForm.brand}
                  onSaved={() => setBrandForm({ open: false, brand: null })}
                  onCancel={() => setBrandForm({ open: false, brand: null })}
                />
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">Brands under {business?.name || 'this business'}</p>
                    <button
                      type="button"
                      onClick={() => setBrandForm({ open: true, brand: null })}
                      className="rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
                    >
                      + New brand
                    </button>
                  </div>
                  {brands.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-divider px-4 py-6 text-center text-xs text-foreground-dim">
                      No brands — that&apos;s fine, the job can hang directly off the business.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {brands.map((b) => (
                        <li key={b.id} className="flex items-center justify-between rounded-lg border border-divider bg-surface px-4 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">{b.name}</p>
                            <p className="truncate text-xs text-foreground-muted">{b.industry || '—'}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setBrandForm({ open: true, brand: b })}
                            className="rounded-md px-2 py-1 text-xs font-medium text-foreground-muted transition hover:bg-canvas hover:text-foreground"
                          >
                            Edit
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex justify-between border-t border-divider pt-4">
                    <button type="button" onClick={() => setStep(1)} className="rounded-md border border-divider px-4 py-2 text-sm font-medium text-foreground-muted transition hover:text-foreground">
                      ← Back
                    </button>
                    <button type="button" onClick={() => setStep(3)} className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90">
                      Continue to job profile →
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Step 3: job profile + attach ─────────────────────────── */}
          {step === 3 && businessId && (
            <div className="space-y-4">
              {jobProfileForm.open ? (
                <JobProfileForm
                  businessProfileId={businessId}
                  brands={brands}
                  locations={locations}
                  cardRoleServiceType={card.role_service_type}
                  profile={jobProfileForm.profile}
                  onSaved={(saved) => {
                    setJobProfileForm({ open: false, profile: null });
                    // Creating a fresh profile flows straight into attach.
                    if (!jobProfileForm.profile) attach.mutate(saved.id);
                  }}
                  onCancel={() => setJobProfileForm({ open: false, profile: null })}
                />
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">Job profiles of {business?.name || 'this business'}</p>
                    <button
                      type="button"
                      onClick={() => setJobProfileForm({ open: true, profile: null })}
                      className="rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
                    >
                      + New job profile
                    </button>
                  </div>
                  {jobProfiles.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-divider px-4 py-6 text-center text-xs text-foreground-dim">
                      No job profiles yet — create one to attach to this card.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {jobProfiles.map((p) => {
                        const attached = card.job_profile_id === p.id;
                        return (
                          <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-divider bg-surface px-4 py-3">
                            <div className="min-w-0">
                              <p className="flex items-center gap-2 truncate text-sm font-semibold text-foreground">
                                {p.title}
                                {attached && (
                                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">Attached</span>
                                )}
                                {p.status === 'archived' && (
                                  <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold text-foreground-dim">Archived</span>
                                )}
                              </p>
                              <p className="truncate text-xs text-foreground-muted">
                                {[
                                  p.brand_profile_id ? brands.find((b) => b.id === p.brand_profile_id)?.name : null,
                                  p.employment_type.replace('_', ' '),
                                  p.work_mode,
                                  (p.squadhire_category_ids ?? []).length === 0 ? '⚠ no SquadHire categories' : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setJobProfileForm({ open: true, profile: p })}
                                className="rounded-md px-2 py-1 text-xs font-medium text-foreground-muted transition hover:bg-canvas hover:text-foreground"
                              >
                                Edit
                              </button>
                              {!attached && (
                                <button
                                  type="button"
                                  onClick={() => attach.mutate(p.id)}
                                  disabled={attach.isPending}
                                  className="rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                                >
                                  {attach.isPending ? 'Attaching…' : 'Attach to card'}
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className="flex justify-between border-t border-divider pt-4">
                    <button type="button" onClick={() => setStep(2)} className="rounded-md border border-divider px-4 py-2 text-sm font-medium text-foreground-muted transition hover:text-foreground">
                      ← Back
                    </button>
                    {card.job_profile_id && (
                      <button type="button" onClick={onClose} className="rounded-md border border-divider px-4 py-2 text-sm font-medium text-foreground-muted transition hover:text-foreground">
                        Done
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
