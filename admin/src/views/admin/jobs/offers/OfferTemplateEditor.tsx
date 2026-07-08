'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  JobProfile,
  OfferCompensationRow,
  OfferLetterTemplate,
  OfferTemplateSection,
  OfferTemplateSignatory,
} from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';

// Offer-letter templates — CANONICAL on SquadHub (contract §1). Admin CRUD at
// /admin/job-offer-templates; SquadHire's business composer pulls these via
// the signed integration GET. Exactly one live default (partial unique index);
// the very first list read lazily seeds the default extracted from the sample
// offer letter.

const inputCls =
  'w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none';

export default function OfferTemplateEditor() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  const { data: templatesRes, isLoading } = useQuery({
    queryKey: ['admin-job-offer-templates'],
    queryFn: () => api.get('/admin/job-offer-templates').then((r) => r.data),
  });
  const templates: OfferLetterTemplate[] = templatesRes?.data || [];

  const { data: profilesRes } = useQuery({
    queryKey: ['admin-job-profiles'],
    queryFn: () => api.get('/admin/jobs/job-profiles').then((r) => r.data),
  });
  const jobProfiles: JobProfile[] = profilesRes?.data || [];

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  // Draft state — reseeded whenever the selection changes.
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [jobProfileId, setJobProfileId] = useState('');
  const [sections, setSections] = useState<OfferTemplateSection[]>([]);
  const [compensationSchema, setCompensationSchema] = useState<OfferCompensationRow[]>([]);
  const [signatory, setSignatory] = useState<OfferTemplateSignatory>({});

  useEffect(() => {
    setPreviewHtml(null);
    if (creating) {
      setName('');
      setDescription('');
      setJobProfileId('');
      // A fresh template starts from the default's skeleton when available.
      const seed = templates.find((t) => t.is_default);
      setSections(seed ? seed.sections.map((s) => ({ ...s })) : [{ key: 'offer', title: 'Offer of Employment', body_html: '<p>Hi {{candidate_name}},</p>' }]);
      setCompensationSchema(seed ? seed.compensation_schema.map((r) => ({ ...r })) : []);
      setSignatory(seed?.signatory ? { ...seed.signatory } : {});
      return;
    }
    if (selected) {
      setName(selected.name);
      setDescription(selected.description ?? '');
      setJobProfileId(selected.job_profile_id ?? '');
      setSections(selected.sections.map((s) => ({ ...s })));
      setCompensationSchema(selected.compensation_schema.map((r) => ({ ...r })));
      setSignatory({ ...selected.signatory });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, creating, templatesRes]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-job-offer-templates'] });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        job_profile_id: jobProfileId || null,
        sections: sections.filter((s) => s.key.trim()),
        compensation_schema: compensationSchema.filter((r) => r.key.trim() && r.component.trim()),
        signatory,
      };
      const res = creating
        ? await api.post('/admin/job-offer-templates', body)
        : await api.patch(`/admin/job-offer-templates/${selectedId}`, body);
      return res.data?.data as OfferLetterTemplate;
    },
    onSuccess: (saved) => {
      invalidate();
      setCreating(false);
      setSelectedId(saved.id);
      showToast('Template saved.', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to save the template', 'error');
    },
  });

  const setDefault = useMutation({
    mutationFn: (id: string) => api.post(`/admin/job-offer-templates/${id}/set-default`),
    onSuccess: () => {
      invalidate();
      showToast('Default template updated.', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to set the default', 'error');
    },
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/job-offer-templates/${id}`),
    onSuccess: () => {
      invalidate();
      setSelectedId(null);
      showToast('Template archived.', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to archive the template', 'error');
    },
  });

  const preview = useMutation({
    mutationFn: () => api.post(`/admin/job-offer-templates/${selectedId}/preview`, {}),
    onSuccess: (res) => setPreviewHtml(res.data?.data?.body_html ?? null),
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Preview failed', 'error');
    },
  });

  const editorOpen = creating || !!selected;

  return (
    <div className="flex h-full flex-col sh-surface">
      <div className="px-6 pt-6 pb-4">
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-[var(--color-sh-warm-border)] pb-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2.5">
              <h1 className="sh-display text-2xl leading-none sm:text-[28px]">Offer Templates</h1>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-sh-warm-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-bold text-[var(--color-sh-ink)]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-sh-lime)' }} />
                {templates.length} template{templates.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="max-w-xl text-[13px] text-[var(--color-sh-ink-muted)]">
              Offer-letter skeletons with {'{{merge}}'} fields — canonical here; the SquadHire business composer
              pulls them and edits sections + package per offer before sending.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedId(null);
              setCreating(true);
            }}
            className="sh-btn-primary sh-btn-primary-sm shrink-0"
          >
            + New template
          </button>
        </header>
      </div>

      <div className="flex flex-1 gap-5 overflow-hidden px-6 pb-8">
        {/* List */}
        <div className="w-72 shrink-0 space-y-1.5 overflow-y-auto">
          {isLoading ? (
            <p className="py-4 text-center text-xs text-foreground-dim">Loading…</p>
          ) : (
            templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setCreating(false);
                  setSelectedId(t.id);
                }}
                className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                  selectedId === t.id && !creating ? 'border-ink bg-[#F2FCBC]/40' : 'border-divider bg-surface hover:border-ink'
                }`}
              >
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="truncate">{t.name}</span>
                  {t.is_default && (
                    <span className="shrink-0 rounded-full bg-[#D1FAE5] px-2 py-0.5 text-[10px] font-semibold text-[#065F46]">Default</span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-foreground-muted">
                  {t.job_profile_id
                    ? `Linked: ${jobProfiles.find((p) => p.id === t.job_profile_id)?.title ?? 'job profile'}`
                    : 'Generic'}
                  {' · '}
                  {t.sections.length} sections
                </p>
              </button>
            ))
          )}
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-y-auto">
          {!editorOpen ? (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-divider">
              <p className="text-sm text-foreground-dim">Pick a template to edit, or create a new one.</p>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) {
                  showToast('Template name is required.', 'error');
                  return;
                }
                if (sections.length === 0) {
                  showToast('At least one section is required.', 'error');
                  return;
                }
                save.mutate();
              }}
              className="space-y-5 pb-8"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-foreground">{creating ? 'New template' : selected?.name}</h2>
                {!creating && selected && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => preview.mutate()}
                      disabled={preview.isPending}
                      className="rounded-md border border-divider px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground disabled:opacity-50"
                    >
                      {preview.isPending ? 'Rendering…' : 'Preview'}
                    </button>
                    {!selected.is_default && (
                      <>
                        <button
                          type="button"
                          onClick={() => setDefault.mutate(selected.id)}
                          disabled={setDefault.isPending}
                          className="rounded-md border border-divider px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground disabled:opacity-50"
                        >
                          Set as default
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Archive template "${selected.name}"?`)) archive.mutate(selected.id);
                          }}
                          disabled={archive.isPending}
                          className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                        >
                          Archive
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">Name</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">Linked job profile</label>
                  <select value={jobProfileId} onChange={(e) => setJobProfileId(e.target.value)} className={inputCls}>
                    <option value="">— Generic (any job) —</option>
                    {jobProfiles.map((p) => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Description</label>
                <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
              </div>

              {/* Merge fields (informational) */}
              {selected && selected.merge_fields.length > 0 && !creating && (
                <div>
                  <p className="mb-1 text-xs font-medium text-foreground">Merge fields</p>
                  <div className="flex flex-wrap gap-1">
                    {selected.merge_fields.map((f) => (
                      <code key={f.key} className="rounded bg-canvas px-1.5 py-0.5 text-[10px] text-foreground-muted" title={`${f.label} (${f.source})`}>
                        {'{{'}{f.key}{'}}'}
                      </code>
                    ))}
                  </div>
                </div>
              )}

              {/* Sections */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium text-foreground">Sections</p>
                  <button
                    type="button"
                    onClick={() => setSections((prev) => [...prev, { key: `section_${prev.length + 1}`, title: '', body_html: '' }])}
                    className="rounded-md border border-dashed border-divider px-2.5 py-1 text-[11px] font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground"
                  >
                    + Add section
                  </button>
                </div>
                <div className="space-y-2">
                  {sections.map((s, i) => (
                    <div key={i} className="rounded-lg border border-divider bg-surface p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <input
                          type="text"
                          value={s.key}
                          onChange={(e) => setSections((prev) => prev.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                          placeholder="key"
                          className="w-40 rounded-md border border-divider bg-surface px-2.5 py-1.5 font-mono text-xs text-foreground focus:border-accent focus:outline-none"
                        />
                        <input
                          type="text"
                          value={s.title}
                          onChange={(e) => setSections((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                          placeholder="Section title"
                          className={inputCls}
                        />
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            disabled={i === 0}
                            aria-label="Move up"
                            onClick={() =>
                              setSections((prev) => {
                                const next = [...prev];
                                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                                return next;
                              })
                            }
                            className="rounded p-1 text-foreground-dim transition hover:bg-canvas hover:text-foreground disabled:opacity-30"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={i === sections.length - 1}
                            aria-label="Move down"
                            onClick={() =>
                              setSections((prev) => {
                                const next = [...prev];
                                [next[i], next[i + 1]] = [next[i + 1], next[i]];
                                return next;
                              })
                            }
                            className="rounded p-1 text-foreground-dim transition hover:bg-canvas hover:text-foreground disabled:opacity-30"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            aria-label="Remove section"
                            onClick={() => setSections((prev) => prev.filter((_, j) => j !== i))}
                            className="rounded p-1 text-red-500 transition hover:bg-red-50"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <textarea
                        rows={4}
                        value={s.body_html}
                        onChange={(e) => setSections((prev) => prev.map((x, j) => (j === i ? { ...x, body_html: e.target.value } : x)))}
                        placeholder="<p>Body HTML with {{merge_fields}}…</p>"
                        className={`${inputCls} resize-y font-mono text-xs`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Compensation schema */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium text-foreground">Compensation table rows</p>
                  <button
                    type="button"
                    onClick={() => setCompensationSchema((prev) => [...prev, { key: `row_${prev.length + 1}`, component: '', cadence: 'per_month' }])}
                    className="rounded-md border border-dashed border-divider px-2.5 py-1 text-[11px] font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground"
                  >
                    + Add row
                  </button>
                </div>
                <div className="space-y-1.5">
                  {compensationSchema.map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={r.key}
                        onChange={(e) => setCompensationSchema((prev) => prev.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                        placeholder="key"
                        className="w-32 rounded-md border border-divider bg-surface px-2.5 py-1.5 font-mono text-xs text-foreground focus:border-accent focus:outline-none"
                      />
                      <input
                        type="text"
                        value={r.component}
                        onChange={(e) => setCompensationSchema((prev) => prev.map((x, j) => (j === i ? { ...x, component: e.target.value } : x)))}
                        placeholder="Component label (e.g. Training Period)"
                        className={inputCls}
                      />
                      <select
                        value={r.cadence}
                        onChange={(e) => setCompensationSchema((prev) => prev.map((x, j) => (j === i ? { ...x, cadence: e.target.value as 'per_month' | 'per_annum' } : x)))}
                        className="w-36 rounded-md border border-divider bg-surface px-2.5 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
                      >
                        <option value="per_month">Per month</option>
                        <option value="per_annum">Per annum</option>
                      </select>
                      <button
                        type="button"
                        aria-label="Remove row"
                        onClick={() => setCompensationSchema((prev) => prev.filter((_, j) => j !== i))}
                        className="rounded p-1 text-red-500 transition hover:bg-red-50"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Signatory */}
              <div>
                <p className="mb-2 text-xs font-medium text-foreground">Signatory</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <input
                    type="text"
                    value={signatory.name ?? ''}
                    onChange={(e) => setSignatory((s) => ({ ...s, name: e.target.value }))}
                    placeholder="Name"
                    className={inputCls}
                  />
                  <input
                    type="text"
                    value={signatory.title ?? ''}
                    onChange={(e) => setSignatory((s) => ({ ...s, title: e.target.value }))}
                    placeholder="Title"
                    className={inputCls}
                  />
                  <input
                    type="text"
                    value={signatory.signature_image_url ?? ''}
                    onChange={(e) => setSignatory((s) => ({ ...s, signature_image_url: e.target.value }))}
                    placeholder="Signature image URL"
                    className={inputCls}
                  />
                </div>
              </div>

              {previewHtml && (
                <div className="rounded-lg border border-divider bg-white p-4">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground-dim">Preview (sample values)</p>
                  <div
                    className="max-w-none text-[13px] leading-relaxed text-[#222] [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-bold"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-divider pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setSelectedId(null);
                  }}
                  className="rounded-md border border-divider px-4 py-2 text-sm font-medium text-foreground-muted transition hover:text-foreground"
                >
                  Cancel
                </button>
                <button type="submit" disabled={save.isPending} className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
                  {save.isPending ? 'Saving…' : creating ? 'Create template' : 'Save template'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
