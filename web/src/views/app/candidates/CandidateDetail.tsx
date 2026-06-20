import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Candidate, CandidateOnboardingProgress } from '@squadhub/shared';
import api from '../../../services/api';
import { showToast } from '../../../components/Toast';
import {
  TONE_CLASS,
  Chip,
  stagesFor,
  initials,
  formatPhone,
  cleanPhone,
  FIELD_LABELS,
  formatFieldValue,
} from './helpers';
import NotesSection from './NotesSection';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-divider bg-surface p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground-muted">{title}</h3>
      {children}
    </section>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-foreground-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
    </div>
  );
}

const ONBOARDING_STAGES = [
  { key: 'signed_up', label: 'Sign-up' },
  { key: 'onboarding_completed', label: 'Onboarding Course' },
  { key: 'basic_profile_completed', label: 'Basic Profile' },
  { key: 'job_profile_completed', label: 'Job Profile' },
  { key: 'portfolio_completed', label: 'Portfolio' },
] as const;

function OnboardingProgress({ progress }: { progress: CandidateOnboardingProgress }) {
  return (
    <div className="flex items-start">
      {ONBOARDING_STAGES.map((stage, i) => {
        const done = progress[stage.key];
        const isLast = i === ONBOARDING_STAGES.length - 1;
        const isBypassed = stage.key === 'onboarding_completed' && progress.onboarding_bypassed === true;
        return (
          <div key={stage.key} className="relative flex flex-1 flex-col items-center">
            {/* Connector to the next step (drawn from this circle's centre). */}
            {!isLast && (
              <span className={`absolute left-1/2 top-3 h-0.5 w-full ${done ? 'bg-emerald-300' : 'bg-divider'}`} />
            )}
            {/* Circle */}
            <span className="relative z-10 flex h-6 w-6 items-center justify-center">
              {done ? (
                <svg className="h-6 w-6 text-emerald-500" viewBox="0 0 24 24" fill="currentColor">
                  <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                </svg>
              ) : (
                <span className="h-6 w-6 rounded-full border-2 border-divider bg-surface" />
              )}
            </span>
            {/* Label below */}
            <span className={`mt-2 px-1 text-center text-[11px] font-medium leading-tight ${done ? 'text-foreground' : 'text-foreground-dim'}`}>
              {stage.label}
            </span>
            {isBypassed && (
              <span className="mt-1 inline-flex items-center rounded-full bg-[var(--color-accent)]/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--color-accent)]">
                Bypassed
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function errMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string } } };
  return e?.response?.data?.error || fallback;
}

export default function CandidateDetail({ candidateId, onClose }: { candidateId: string; onClose?: () => void }) {
  const queryClient = useQueryClient();
  const { data: lead, isLoading } = useQuery<Candidate>({
    queryKey: ['candidate', candidateId],
    queryFn: async () => (await api.get(`/candidates/${candidateId}`)).data,
    enabled: !!candidateId,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['candidate', candidateId] });
    queryClient.invalidateQueries({ queryKey: ['candidates'] });
    queryClient.invalidateQueries({ queryKey: ['candidates-counts'] });
  };

  // Inline archive flow: clicking the "Archived" stage reveals a reason box.
  const [archiving, setArchiving] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');

  const statusMutation = useMutation({
    mutationFn: async (vars: { status: string; archive_reason?: string }) => {
      await api.patch(`/candidates/${candidateId}/status`, vars);
    },
    onSuccess: () => { showToast('Stage updated'); setArchiving(false); setArchiveReason(''); refresh(); },
    onError: (err) => showToast(errMessage(err, 'Failed to update stage')),
  });

  const handleStage = (value: string, currentStatus: string) => {
    if (value === currentStatus || statusMutation.isPending) return;
    if (value === 'archived') { setArchiving(true); return; }
    setArchiving(false);
    statusMutation.mutate({ status: value });
  };

  const deleteMutation = useMutation({
    mutationFn: async () => { await api.delete(`/candidates/${candidateId}`); },
    onSuccess: () => { showToast('Candidate moved to recycle bin'); refresh(); onClose?.(); },
    onError: (err) => showToast(errMessage(err, 'Failed to delete candidate')),
  });

  const restoreMutation = useMutation({
    mutationFn: async () => { await api.patch(`/candidates/${candidateId}/restore`); },
    onSuccess: () => { showToast('Candidate restored'); refresh(); },
    onError: (err) => showToast(errMessage(err, 'Failed to restore candidate')),
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--color-accent)] border-t-transparent" />
      </div>
    );
  }
  if (!lead) return <div className="p-6 text-sm text-foreground-muted">Candidate not found</div>;

  const linkPhone = cleanPhone(lead.phone);
  const formDataEntries = Object.entries(lead.form_data || {});
  // Deep-link into the SquadHire CRM, keyed by phone (mirrors SquadHire admin).
  const crmUrl = `https://shcrm.squadhub.in/app/leads/lookup?phone=${linkPhone}`;
  const stages = stagesFor(lead.form_type);

  return (
    <div className="space-y-5">
      {/* Identity */}
      <div className="rounded-xl border border-divider bg-surface p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-lg font-semibold text-white">
            {initials(lead.name)}
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-foreground">{lead.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <Chip tone="gray">{lead.form_type}</Chip>
              {lead.linked_talent ? <Chip tone="green">Signed up</Chip> : <Chip tone="gray">Not signed up</Chip>}
              {lead.auto_approved && <Chip tone="violet">Auto-approved</Chip>}
              {lead.deleted_at && <Chip tone="red">Deleted</Chip>}
              <span className="text-foreground-muted">
                Applied {new Date(lead.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <a href={`tel:+${linkPhone}`} className="inline-flex items-center gap-1 text-foreground hover:text-[var(--color-accent)]">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                {formatPhone(lead.phone)}
              </a>
              <a
                href={crmUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline"
                title="Open this candidate in the SquadHire CRM"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" /></svg>
                CRM
              </a>
              {lead.email && (
                <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 text-foreground hover:text-[var(--color-accent)]">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  {lead.email}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stages */}
      <Section title="Stages">
        <div className="flex flex-wrap gap-1.5">
          {stages.map((s) => {
            const active = s.value === lead.status;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => handleStage(s.value, lead.status)}
                disabled={active || statusMutation.isPending}
                title={active ? 'Current stage' : `Move to ${s.label}`}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                  active
                    ? `border-transparent ${TONE_CLASS[s.tone]} ring-2 ring-inset ring-[var(--color-accent)]`
                    : 'border-divider bg-surface text-foreground hover:bg-canvas'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Inline archive reason (revealed when "Archived" is clicked) */}
        {archiving && lead.status !== 'archived' && (
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-canvas p-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-foreground-muted">Archive reason (optional)</label>
              <input
                value={archiveReason}
                onChange={(e) => setArchiveReason(e.target.value)}
                placeholder="Why is this candidate being archived?"
                className="block w-full rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-dim focus:border-[var(--color-accent)] focus:outline-none"
              />
            </div>
            <button
              onClick={() => statusMutation.mutate({ status: 'archived', archive_reason: archiveReason || undefined })}
              disabled={statusMutation.isPending}
              className="rounded-lg border border-red-400/40 bg-surface px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-500/5 disabled:opacity-50"
            >
              {statusMutation.isPending ? 'Archiving…' : 'Confirm archive'}
            </button>
            <button
              onClick={() => { setArchiving(false); setArchiveReason(''); }}
              className="rounded-lg px-3 py-2 text-sm text-foreground-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        )}

        {lead.status === 'archived' && lead.archive_reason && (
          <p className="mt-3 text-xs text-foreground-muted">
            Archived — <span className="font-medium">{lead.archive_reason.replace(/_/g, ' ')}</span>
          </p>
        )}
        {lead.admin_notes && (
          <div className="mt-3 rounded-lg bg-canvas px-3 py-2">
            <p className="text-xs font-medium uppercase text-foreground-muted">Admin Note</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{lead.admin_notes}</p>
          </div>
        )}
      </Section>

      {/* Onboarding progress */}
      {lead.onboarding_progress && (
        <Section title="Onboarding Progress">
          <OnboardingProgress progress={lead.onboarding_progress} />
        </Section>
      )}

      {/* Notes */}
      <Section title="Notes">
        <NotesSection candidateId={lead.id} />
      </Section>

      {/* Application details (read-only) */}
      {formDataEntries.length > 0 && (
        <Section title="Application Details">
          <dl className="grid gap-4 sm:grid-cols-2">
            {formDataEntries.map(([key, value]) => {
              const isWide = key === 'education' || key === 'experience_details';
              return (
                <div key={key} className={isWide ? 'sm:col-span-2' : ''}>
                  <KV label={FIELD_LABELS[key] || key.replace(/_/g, ' ')}>
                    {key === 'portfolio_link' || key === 'resume_url' ? (
                      <a href={String(value)} target="_blank" rel="noopener noreferrer" className="break-all text-[var(--color-accent)] underline">
                        {String(value)}
                      </a>
                    ) : (
                      formatFieldValue(key, value)
                    )}
                  </KV>
                </div>
              );
            })}
          </dl>
          {lead.resume_url && (
            <div className="mt-4 border-t border-divider pt-3">
              <a href={lead.resume_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-accent)] hover:underline">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                Download Resume
              </a>
            </div>
          )}
        </Section>
      )}

      {/* Campaign tracking (read-only) */}
      {(lead.utm_source || lead.utm_medium || lead.utm_campaign) && (
        <Section title="Campaign Tracking">
          <div className="grid gap-3 sm:grid-cols-3">
            {lead.utm_source && <KV label="Source">{lead.utm_source}</KV>}
            {lead.utm_medium && <KV label="Medium">{lead.utm_medium}</KV>}
            {lead.utm_campaign && <KV label="Campaign">{lead.utm_campaign}</KV>}
          </div>
        </Section>
      )}

      {/* Danger zone */}
      <Section title="Danger Zone">
        {lead.deleted_at ? (
          <div className="space-y-3">
            <p className="text-sm text-foreground-muted">This candidate is in the recycle bin.</p>
            <button
              onClick={() => restoreMutation.mutate()}
              disabled={restoreMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-divider bg-surface px-3 py-2 text-sm font-medium text-foreground hover:bg-canvas disabled:opacity-50"
            >
              Restore Candidate
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-foreground-muted">Move this candidate to the recycle bin. They can be restored later.</p>
            <button
              onClick={() => { if (window.confirm('Move this candidate to the recycle bin? You can restore them later.')) deleteMutation.mutate(); }}
              disabled={deleteMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/40 bg-surface px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-500/5 disabled:opacity-50"
            >
              Delete Candidate
            </button>
          </div>
        )}
      </Section>
    </div>
  );
}
