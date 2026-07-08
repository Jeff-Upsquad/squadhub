'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BusinessLocation, JobCard, JobCardCandidate, JobInterviewMode } from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';

// Call for interview — schedules a round for shortlisted candidates via the
// signed proxy (POST /admin/job-cards/:id/call-for-interview). Capacity =
// window ÷ minutes is computed canonically on the Profiles side; the preview
// here mirrors the same floor() so the admin sees it while scheduling.
// Virtual: provider + meeting link (revealed to a candidate only on "Start
// Interview"). Physical: a saved business location from the dropdown.

const PROVIDERS = ['Google Meet', 'Zoom', 'Microsoft Teams', 'Other'];

export default function InterviewScheduleDialog({
  card,
  shortlisted,
  defaultCandidateIds,
  onClose,
}: {
  card: JobCard;
  /** Candidates eligible for this round (shortlisted bucket). */
  shortlisted: JobCardCandidate[];
  /** Pre-ticked candidates (e.g. opened from a candidate row). */
  defaultCandidateIds?: string[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [allShortlisted, setAllShortlisted] = useState(!defaultCandidateIds?.length);
  const [candidateIds, setCandidateIds] = useState<string[]>(defaultCandidateIds ?? []);
  const [roundNumber, setRoundNumber] = useState('1');
  const [roundLabel, setRoundLabel] = useState('');
  const [mode, setMode] = useState<JobInterviewMode>('virtual');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [minutes, setMinutes] = useState('30');
  const [provider, setProvider] = useState(PROVIDERS[0]);
  const [meetingLink, setMeetingLink] = useState('');
  const [locationId, setLocationId] = useState('');

  const businessProfileId = card.job_profile?.business_profile_id ?? card.business_profile?.id ?? null;
  const { data: locationsRes } = useQuery({
    queryKey: ['admin-job-business-locations', businessProfileId],
    queryFn: () =>
      api.get(`/admin/jobs/business-profiles/${businessProfileId}/locations`).then((r) => r.data),
    enabled: !!businessProfileId && mode === 'physical',
  });
  const locations: BusinessLocation[] = locationsRes?.data || [];

  // Capacity preview: floor(window / minutes) — mirrors the Profiles-side
  // computation (00104), purely informational here.
  const capacity = useMemo(() => {
    if (!windowStart || !windowEnd) return null;
    const start = new Date(windowStart).getTime();
    const end = new Date(windowEnd).getTime();
    const mins = Number(minutes);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(mins) || mins <= 0) return null;
    return Math.floor((end - start) / 60000 / mins);
  }, [windowStart, windowEnd, minutes]);

  const toggleCandidate = (id: string) =>
    setCandidateIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const schedule = useMutation({
    mutationFn: () => {
      const roundNum = Math.round(Number(roundNumber));
      return api.post(`/admin/job-cards/${card.id}/call-for-interview`, {
        ...(allShortlisted ? { all_shortlisted: true } : { candidate_ids: candidateIds }),
        round_number: Number.isFinite(roundNum) && roundNum >= 1 ? roundNum : 1,
        round_label: roundLabel.trim() || undefined,
        mode,
        window_start: new Date(windowStart).toISOString(),
        window_end: new Date(windowEnd).toISOString(),
        minutes_per_interview: Math.round(Number(minutes)),
        ...(mode === 'virtual'
          ? { meeting_provider: provider, meeting_link: meetingLink.trim() }
          : { location_id: locationId }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-job-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-job-card-candidates', card.id] });
      showToast('Interview call sent — candidates are invited to accept or decline.', 'success');
      onClose();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to schedule the interview round', 'error');
    },
  });

  const canSubmit =
    (allShortlisted || candidateIds.length > 0) &&
    !!windowStart &&
    !!windowEnd &&
    Number(minutes) >= 5 &&
    (mode === 'virtual' ? !!meetingLink.trim() : !!locationId);

  const inputCls =
    'w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-divider bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-divider px-5 py-3.5">
          <h3 className="text-base font-semibold text-foreground">Call for interview</h3>
          <button onClick={onClose} className="rounded-md p-1 text-foreground-dim transition hover:bg-canvas hover:text-foreground">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Candidates */}
          <div>
            <p className="mb-1 text-xs font-medium text-foreground">Candidates</p>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={allShortlisted} onChange={(e) => setAllShortlisted(e.target.checked)} />
              All shortlisted candidates ({shortlisted.length})
            </label>
            {!allShortlisted && (
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-divider p-2">
                {shortlisted.length === 0 ? (
                  <p className="text-xs text-foreground-dim">No shortlisted candidates yet.</p>
                ) : (
                  shortlisted.map((c) => (
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Round number</label>
              <input type="number" min={1} max={20} value={roundNumber} onChange={(e) => setRoundNumber(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Round label</label>
              <input type="text" value={roundLabel} onChange={(e) => setRoundLabel(e.target.value)} placeholder="e.g. Portfolio Review" className={inputCls} />
            </div>
          </div>

          {/* Mode */}
          <div>
            <p className="mb-1 text-xs font-medium text-foreground">Interview type</p>
            <div className="flex items-center overflow-hidden rounded-md border border-divider text-sm font-medium">
              {(['virtual', 'physical'] as JobInterviewMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`flex-1 px-3 py-2 transition ${
                    mode === m ? 'bg-sh-lime-soft text-sh-ink' : 'bg-surface text-foreground-muted hover:text-foreground'
                  }`}
                >
                  {m === 'virtual' ? 'Virtual' : 'Physical (in person)'}
                </button>
              ))}
            </div>
          </div>

          {mode === 'virtual' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Provider</label>
                <select value={provider} onChange={(e) => setProvider(e.target.value)} className={inputCls}>
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Meeting link</label>
                <input type="text" value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} placeholder="https://meet.google.com/…" className={inputCls} />
                <p className="mt-1 text-[11px] text-foreground-dim">
                  Locked for candidates — revealed to each one only when you click Start Interview.
                </p>
              </div>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Location</label>
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputCls}>
                <option value="">{locations.length === 0 ? 'No saved locations — add one on the business profile' : 'Pick a location'}</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label} — {[l.address, l.city].filter(Boolean).join(', ')}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-foreground-dim">
                The venue snapshot (address + Google Maps link) is frozen into the round. Candidates get a reminder a day before.
              </p>
            </div>
          )}

          {/* Window + capacity */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Window start</label>
              <input type="datetime-local" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Window end</label>
              <input type="datetime-local" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Minutes / interview</label>
              <input type="number" min={5} max={240} value={minutes} onChange={(e) => setMinutes(e.target.value)} className={inputCls} />
            </div>
          </div>
          {capacity != null && (
            <p className="rounded-md bg-canvas px-3 py-2 text-xs text-foreground-muted">
              Capacity: <span className="font-semibold text-foreground">{capacity}</span> interview{capacity === 1 ? '' : 's'} fit in this
              window. Confirmations beyond capacity go to the waiting list (promoted on no-shows).
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-divider px-5 py-3.5">
          <button type="button" onClick={onClose} className="rounded-md border border-divider px-4 py-2 text-sm font-medium text-foreground-muted transition hover:text-foreground">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => schedule.mutate()}
            disabled={!canSubmit || schedule.isPending}
            className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {schedule.isPending ? 'Scheduling…' : 'Send interview call'}
          </button>
        </div>
      </div>
    </div>
  );
}
