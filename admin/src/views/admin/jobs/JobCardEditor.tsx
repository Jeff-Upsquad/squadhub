'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JobCard, JobRuleOverrides, JobSalaryPeriod, SubscriptionCardDistribution } from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import SliderPanel from '../clients/SliderPanel';
import RuleOverridesEditor from './RuleOverridesEditor';
import { Field, inputCls } from './onboarding/BusinessProfileForm';
import type { Country } from './PreferenceRulesEditor';

// Card editor — brief snapshot, package, openings, expiry, distribution, and
// the per-rule overrides over the linked job profile's preference_rules.
// PATCH /admin/job-cards/:id (a live published card re-delivers server-side).

export default function JobCardEditor({
  card,
  onClose,
}: {
  card: JobCard;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  const [customerName, setCustomerName] = useState(card.customer_name ?? '');
  const [customerCompany, setCustomerCompany] = useState(card.customer_company ?? '');
  const [customerEmail, setCustomerEmail] = useState(card.customer_email ?? '');
  const [customerPhone, setCustomerPhone] = useState(card.customer_phone ?? '');
  const [customerLocation, setCustomerLocation] = useState(card.customer_location ?? '');
  const [briefNote, setBriefNote] = useState(card.brief_note ?? '');
  const [packageMin, setPackageMin] = useState(card.package_min != null ? String(card.package_min) : '');
  const [packageMax, setPackageMax] = useState(card.package_max != null ? String(card.package_max) : '');
  const [packageCurrency, setPackageCurrency] = useState(card.package_currency ?? 'INR');
  const [packagePeriod, setPackagePeriod] = useState<JobSalaryPeriod>(card.package_period ?? 'monthly');
  const [packageNotes, setPackageNotes] = useState(card.package_notes ?? '');
  const [openings, setOpenings] = useState(String(card.openings_count ?? 1));
  const [expectedJoiningDate, setExpectedJoiningDate] = useState(card.expected_joining_date ?? '');
  const [expiresAt, setExpiresAt] = useState(card.expires_at ? card.expires_at.slice(0, 10) : '');
  const [distribution, setDistribution] = useState<SubscriptionCardDistribution>(card.distribution ?? 'broadcast');
  const [ruleOverrides, setRuleOverrides] = useState<JobRuleOverrides>(card.rule_overrides ?? {});

  const countriesQuery = useQuery({
    queryKey: ['admin-countries'],
    queryFn: () => api.get('/admin/countries').then((r) => r.data?.data || []),
  });
  const countries: Country[] = countriesQuery.data || [];

  const parseAmount = (raw: string): number | null => {
    if (!raw.trim()) return null;
    const n = Math.round(Number(raw));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const save = useMutation({
    mutationFn: () => {
      const openingsNum = Math.round(Number(openings));
      return api.patch(`/admin/job-cards/${card.id}`, {
        customer_name: customerName.trim() || null,
        customer_company: customerCompany.trim() || null,
        customer_email: customerEmail.trim() || null,
        customer_phone: customerPhone.trim() || null,
        customer_location: customerLocation.trim() || null,
        brief_note: briefNote.trim() || null,
        package_min: parseAmount(packageMin),
        package_max: parseAmount(packageMax),
        package_currency: packageCurrency.trim() || 'INR',
        package_period: packagePeriod,
        package_notes: packageNotes.trim() || null,
        ...(Number.isFinite(openingsNum) && openingsNum >= 1 ? { openings_count: openingsNum } : {}),
        expected_joining_date: expectedJoiningDate || null,
        expires_at: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
        rule_overrides: ruleOverrides,
        distribution,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-job-cards'] });
      showToast(
        card.state === 'published'
          ? 'Card saved — the SquadHire mirror re-delivers in the background.'
          : 'Card saved.',
        'success',
      );
      onClose();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to save the card', 'error');
    },
  });

  return (
    <SliderPanel open onClose={onClose} title="Edit job card" width="w-[560px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-5"
      >
        <section className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Customer</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Business name">
              <input type="text" value={customerCompany} onChange={(e) => setCustomerCompany(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Contact person">
              <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Email">
              <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Phone">
              <input type="text" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <Field label="Location">
            <input type="text" value={customerLocation} onChange={(e) => setCustomerLocation(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Brief note">
            <textarea rows={3} value={briefNote} onChange={(e) => setBriefNote(e.target.value)} className={`${inputCls} resize-none`} />
          </Field>
        </section>

        <section className="space-y-3 border-t border-divider pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Package & openings</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Package min">
              <input type="number" min={0} value={packageMin} onChange={(e) => setPackageMin(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Package max">
              <input type="number" min={0} value={packageMax} onChange={(e) => setPackageMax(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Currency">
              <input type="text" value={packageCurrency} onChange={(e) => setPackageCurrency(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Period">
              <select value={packagePeriod} onChange={(e) => setPackagePeriod(e.target.value as JobSalaryPeriod)} className={inputCls}>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual (CTC)</option>
              </select>
            </Field>
            <Field label="Openings">
              <input type="number" min={1} value={openings} onChange={(e) => setOpenings(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Expected joining date">
              <input type="date" value={expectedJoiningDate} onChange={(e) => setExpectedJoiningDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Card expires" hint="After this date the card auto-expires.">
              <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Distribution">
              <select value={distribution} onChange={(e) => setDistribution(e.target.value as SubscriptionCardDistribution)} className={inputCls}>
                <option value="broadcast">Broadcast (matched talents)</option>
                <option value="manual">Manual (hand-picked)</option>
              </select>
            </Field>
          </div>
          <Field label="Package notes">
            <textarea rows={2} value={packageNotes} onChange={(e) => setPackageNotes(e.target.value)} className={`${inputCls} resize-none`} />
          </Field>
        </section>

        <section className="space-y-3 border-t border-divider pt-4">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Rule overrides</h4>
            <p className="mt-1 text-[11px] text-foreground-dim">
              Per-rule overrides over the job profile&apos;s defaults — broadcast matches on the card&apos;s effective rules.
            </p>
          </div>
          {card.job_profile ? (
            <RuleOverridesEditor
              profileRules={card.job_profile.preference_rules ?? {}}
              overrides={ruleOverrides}
              onChange={setRuleOverrides}
              countries={countries}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-divider px-3 py-3 text-center text-xs text-foreground-dim">
              Attach a job profile first — overrides apply on top of its preference rules.
            </p>
          )}
        </section>

        <div className="flex items-center justify-end gap-2 border-t border-divider pt-4">
          <button type="button" onClick={onClose} className="rounded-md border border-divider px-4 py-2 text-sm font-medium text-foreground-muted transition hover:text-foreground">
            Cancel
          </button>
          <button type="submit" disabled={save.isPending} className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
            {save.isPending ? 'Saving…' : 'Save card'}
          </button>
        </div>
      </form>
    </SliderPanel>
  );
}
