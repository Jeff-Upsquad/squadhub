'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  JobCard,
  JobCardCandidate,
  JobOfferDeliveryMode,
  OfferLetterTemplate,
  OfferTemplateSection,
} from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';

// Offer composer — template pick + merge fields + compensation table +
// per-offer edited letter sections + preview + send. Sends to all
// interview-selected candidates in one click or to hand-picked ones; the
// letter is frozen on the Profiles side at send ({{candidate_name}} tokens
// filled per candidate) and mirrored back into job_offers.

type CompRowKey = 'training' | 'probation' | 'confirmed';

const COMP_ROWS: { key: CompRowKey; label: string }[] = [
  { key: 'training', label: 'Training Period' },
  { key: 'probation', label: 'Probation Period' },
  { key: 'confirmed', label: 'After Probation' },
];

type CompDraft = Record<CompRowKey, { amount: string; cadence: 'per_month' | 'per_annum' }>;

const inputCls =
  'w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none';

export default function OfferComposer({
  card,
  selectable,
  defaultCandidateIds,
  onClose,
}: {
  card: JobCard;
  /** Candidates eligible for an offer (interview-selected / interview bucket). */
  selectable: JobCardCandidate[];
  defaultCandidateIds?: string[];
  onClose: () => void;
}) {
  const qc = useQueryClient();

  const [allSelected, setAllSelected] = useState(!defaultCandidateIds?.length);
  const [candidateIds, setCandidateIds] = useState<string[]>(defaultCandidateIds ?? []);
  const [deliveryMode, setDeliveryMode] = useState<JobOfferDeliveryMode>('platform');
  const [templateId, setTemplateId] = useState<string>('');
  const [positionTitle, setPositionTitle] = useState(card.job_profile?.title ?? card.role_service_type ?? '');
  const [effectiveDate, setEffectiveDate] = useState(card.expected_joining_date ?? '');
  const [joinByDate, setJoinByDate] = useState(card.expected_joining_date ?? '');
  const [expiresAt, setExpiresAt] = useState('');
  const [currency, setCurrency] = useState(card.package_currency ?? 'INR');
  const [comp, setComp] = useState<CompDraft>({
    training: { amount: '', cadence: 'per_month' },
    probation: { amount: '', cadence: 'per_month' },
    confirmed: { amount: card.package_max != null ? String(card.package_max) : '', cadence: 'per_month' },
  });
  const [totalCtc, setTotalCtc] = useState('');
  const [sections, setSections] = useState<OfferTemplateSection[]>([]);
  const [note, setNote] = useState('');
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  const { data: templatesRes } = useQuery({
    queryKey: ['admin-job-offer-templates'],
    queryFn: () => api.get('/admin/job-offer-templates').then((r) => r.data),
  });
  const templates: OfferLetterTemplate[] = templatesRes?.data || [];

  // Default template: the one linked to this job profile, else the global default.
  useEffect(() => {
    if (templateId || templates.length === 0) return;
    const linked = card.job_profile_id ? templates.find((t) => t.job_profile_id === card.job_profile_id) : null;
    const fallback = templates.find((t) => t.is_default) ?? templates[0];
    setTemplateId((linked ?? fallback).id);
  }, [templates, templateId, card.job_profile_id]);

  const template = useMemo(() => templates.find((t) => t.id === templateId) ?? null, [templates, templateId]);

  // Seed the editable sections from the picked template (per-offer edits only —
  // the template itself is untouched).
  useEffect(() => {
    if (template) setSections(template.sections.map((s) => ({ ...s })));
    setPreviewHtml(null);
  }, [template]);

  const parseAmount = (raw: string): number | null => {
    if (!raw.trim()) return null;
    const n = Math.round(Number(raw));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const mergeValues = (): Record<string, string> => ({
    position: positionTitle,
    effective_date: effectiveDate,
    join_by_date: joinByDate,
    expiry_date: expiresAt,
    document_date: new Date().toDateString(),
    business_name: card.business_profile?.name ?? card.customer_company ?? '',
    brand_name: card.brand_profile?.name ?? '',
  });

  const preview = useMutation({
    mutationFn: () =>
      api.post(`/admin/job-offer-templates/${templateId}/preview`, { merge_values: mergeValues() }),
    onSuccess: (res) => {
      setPreviewHtml(res.data?.data?.body_html ?? null);
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Preview failed', 'error');
    },
  });

  const send = useMutation({
    mutationFn: () => {
      const compensation = {
        currency: currency.trim() || 'INR',
        ...Object.fromEntries(
          COMP_ROWS.map((row) => {
            const amount = parseAmount(comp[row.key].amount);
            return [row.key, amount != null ? { amount, cadence: comp[row.key].cadence } : null];
          }),
        ),
      };
      return api.post(`/admin/job-cards/${card.id}/offers`, {
        ...(allSelected ? { all_selected: true } : { candidate_ids: candidateIds }),
        delivery_mode: deliveryMode,
        template_id: deliveryMode === 'platform' ? templateId || null : null,
        position_title: positionTitle.trim() || undefined,
        effective_date: effectiveDate || undefined,
        join_by_date: joinByDate || undefined,
        expires_at: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : undefined,
        compensation,
        total_ctc: parseAmount(totalCtc) ?? undefined,
        ctc_currency: currency.trim() || 'INR',
        letter_sections: deliveryMode === 'platform' ? sections : undefined,
        note: note.trim() || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-job-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-job-card-candidates', card.id] });
      showToast(
        deliveryMode === 'platform'
          ? 'Offer letters sent — candidates can accept, decline, negotiate, or ask a question.'
          : 'Recorded as sent manually via email.',
        'success',
      );
      onClose();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to send the offers', 'error');
    },
  });

  const toggleCandidate = (id: string) =>
    setCandidateIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const canSend = allSelected || candidateIds.length > 0;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-2xl flex-col bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-divider px-5 py-4">
          <div>
            <h3 className="font-[family-name:var(--font-display)] text-base font-semibold text-foreground">Compose offer</h3>
            <p className="text-xs text-foreground-muted">
              Package is editable per send; the letter freezes when it goes out.
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-foreground-dim transition hover:bg-canvas hover:text-foreground">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Recipients */}
          <section>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-foreground-dim">Send to</p>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={allSelected} onChange={(e) => setAllSelected(e.target.checked)} />
              All interview-selected candidates in one click ({selectable.length})
            </label>
            {!allSelected && (
              <div className="mt-2 max-h-36 space-y-1 overflow-y-auto rounded-md border border-divider p-2">
                {selectable.length === 0 ? (
                  <p className="text-xs text-foreground-dim">No selected candidates yet.</p>
                ) : (
                  selectable.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={candidateIds.includes(c.external_candidate_id)}
                        onChange={() => toggleCandidate(c.external_candidate_id)}
                      />
                      {c.talent_name || c.talent_email || c.external_candidate_id.slice(0, 8)}
                    </label>
                  ))
                )}
              </div>
            )}
          </section>

          {/* Delivery */}
          <section>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-foreground-dim">Delivery</p>
            <div className="flex items-center overflow-hidden rounded-md border border-divider text-sm font-medium">
              {(
                [
                  { value: 'platform', label: 'Platform offer letter' },
                  { value: 'manual_email', label: 'Sent manually via email (record only)' },
                ] as { value: JobOfferDeliveryMode; label: string }[]
              ).map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setDeliveryMode(m.value)}
                  aria-pressed={deliveryMode === m.value}
                  className={`flex-1 px-3 py-2 transition ${
                    deliveryMode === m.value ? 'bg-sh-lime-soft text-sh-ink' : 'bg-surface text-foreground-muted hover:text-foreground'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </section>

          {/* Terms */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Terms</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Position title</label>
                <input type="text" value={positionTitle} onChange={(e) => setPositionTitle(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Offer expires</label>
                <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Effective date</label>
                <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Join by</label>
                <input type="date" value={joinByDate} onChange={(e) => setJoinByDate(e.target.value)} className={inputCls} />
              </div>
            </div>
          </section>

          {/* Compensation table */}
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-dim">Compensation</p>
            <div className="overflow-hidden rounded-lg border border-divider">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-canvas text-[11px] font-semibold uppercase tracking-wide text-foreground-dim">
                    <th className="px-3 py-2">Component</th>
                    <th className="px-3 py-2">Amount ({currency || 'INR'})</th>
                    <th className="px-3 py-2">Cadence</th>
                  </tr>
                </thead>
                <tbody>
                  {COMP_ROWS.map((row) => (
                    <tr key={row.key} className="border-t border-divider">
                      <td className="px-3 py-2 font-medium text-foreground">{row.label}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          value={comp[row.key].amount}
                          onChange={(e) => setComp((c) => ({ ...c, [row.key]: { ...c[row.key], amount: e.target.value } }))}
                          placeholder="—"
                          className="w-32 rounded-md border border-divider bg-surface px-2.5 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={comp[row.key].cadence}
                          onChange={(e) =>
                            setComp((c) => ({
                              ...c,
                              [row.key]: { ...c[row.key], cadence: e.target.value as 'per_month' | 'per_annum' },
                            }))
                          }
                          className="rounded-md border border-divider bg-surface px-2.5 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
                        >
                          <option value="per_month">Per month</option>
                          <option value="per_annum">Per annum</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Total CTC (annual)</label>
                <input type="number" min={0} value={totalCtc} onChange={(e) => setTotalCtc(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Currency</label>
                <input type="text" value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls} />
              </div>
            </div>
          </section>

          {/* Letter (platform only) */}
          {deliveryMode === 'platform' && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Offer letter</p>
                <button
                  type="button"
                  onClick={() => preview.mutate()}
                  disabled={!templateId || preview.isPending}
                  className="rounded-md border border-divider px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground disabled:opacity-50"
                >
                  {preview.isPending ? 'Rendering…' : 'Preview letter'}
                </button>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Template</label>
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={inputCls}>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.is_default ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              {template && template.merge_fields.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] text-foreground-dim">
                    Merge fields — {'{{candidate_name}}'} is filled per candidate at send time:
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {template.merge_fields.map((f) => (
                      <code key={f.key} className="rounded bg-canvas px-1.5 py-0.5 text-[10px] text-foreground-muted">
                        {'{{'}{f.key}{'}}'}
                      </code>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-2">
                {sections.map((s, i) => (
                  <details key={s.key} className="rounded-lg border border-divider bg-surface">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground">
                      {s.title || s.key}
                    </summary>
                    <div className="space-y-2 border-t border-divider p-3">
                      <input
                        type="text"
                        value={s.title}
                        onChange={(e) => setSections((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                        placeholder="Section title"
                        className={inputCls}
                      />
                      <textarea
                        rows={5}
                        value={s.body_html}
                        onChange={(e) => setSections((prev) => prev.map((x, j) => (j === i ? { ...x, body_html: e.target.value } : x)))}
                        className={`${inputCls} resize-y font-mono text-xs`}
                      />
                    </div>
                  </details>
                ))}
              </div>
              {previewHtml && (
                <div className="rounded-lg border border-divider bg-white p-4">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground-dim">Preview (sample values)</p>
                  {/* Letter preview renders on constant white "paper" in both modes — keep constant near-black text */}
                  <div
                    className="prose prose-sm max-w-none text-[13px] leading-relaxed text-neutral-800 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-bold"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              )}
            </section>
          )}

          <section>
            <label className="mb-1 block text-xs font-medium text-foreground">Note to the candidate (optional)</label>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputCls} resize-none`} />
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-divider px-5 py-3.5">
          <button type="button" onClick={onClose} className="rounded-md border border-divider px-4 py-2 text-sm font-medium text-foreground-muted transition hover:text-foreground">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => send.mutate()}
            disabled={!canSend || send.isPending}
            className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {send.isPending ? 'Sending…' : deliveryMode === 'platform' ? 'Send offer letter' : 'Record manual offer'}
          </button>
        </div>
      </div>
    </div>
  );
}
