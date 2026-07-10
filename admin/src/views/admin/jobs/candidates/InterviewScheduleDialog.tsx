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
  // Interview slot = one date + a start/end time window on that day.
  const [interviewDate, setInterviewDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [minutes, setMinutes] = useState('30');
  const [provider, setProvider] = useState(PROVIDERS[0]);
  const [meetingLink, setMeetingLink] = useState('');
  const [locationId, setLocationId] = useState('');
  // Inline "add a new venue" — so admins aren't dead-ended when none are saved.
  const [addingLocation, setAddingLocation] = useState(false);
  const [newLoc, setNewLoc] = useState({ label: '', address: '', city: '', region: '', google_maps_url: '' });

  const businessProfileId = card.job_profile?.business_profile_id ?? card.business_profile?.id ?? null;
  const { data: locationsRes } = useQuery({
    queryKey: ['admin-job-business-locations', businessProfileId],
    queryFn: () =>
      api.get(`/admin/jobs/business-profiles/${businessProfileId}/locations`).then((r) => r.data),
    enabled: !!businessProfileId && mode === 'physical',
  });
  const locations: BusinessLocation[] = locationsRes?.data || [];

  const createLocation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/admin/jobs/business-profiles/${businessProfileId}/locations`, {
        label: newLoc.label.trim(),
        address: newLoc.address.trim(),
        city: newLoc.city.trim() || undefined,
        region: newLoc.region.trim() || undefined,
        google_maps_url: newLoc.google_maps_url.trim() || undefined,
      });
      return data.data as BusinessLocation;
    },
    onSuccess: (loc) => {
      qc.invalidateQueries({ queryKey: ['admin-job-business-locations', businessProfileId] });
      setLocationId(loc.id);
      setAddingLocation(false);
      setNewLoc({ label: '', address: '', city: '', region: '', google_maps_url: '' });
      showToast('Location saved.', 'success');
    },
    onError: (err: any) => showToast(err?.response?.data?.error || 'Failed to save the location', 'error'),
  });

  // Capacity preview: floor(window / minutes) — mirrors the Profiles-side
  // computation (00104), purely informational here.
  const capacity = useMemo(() => {
    if (!interviewDate || !startTime || !endTime) return null;
    const start = new Date(`${interviewDate}T${startTime}`).getTime();
    const end = new Date(`${interviewDate}T${endTime}`).getTime();
    const mins = Number(minutes);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(mins) || mins <= 0) return null;
    return Math.floor((end - start) / 60000 / mins);
  }, [interviewDate, startTime, endTime, minutes]);

  const toggleCandidate = (id: string) =>
    setCandidateIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const schedule = useMutation({
    mutationFn: () => {
      const roundNum = Math.round(Number(roundNumber));
      return api.post(`/admin/job-cards/${card.id}/call-for-interview`, {
        // Send the actual (live) candidate ids the dialog is showing — the
        // server must not re-resolve "all shortlisted" from its stale mirror.
        candidate_ids: allShortlisted ? shortlisted.map((c) => c.external_candidate_id) : candidateIds,
        round_number: Number.isFinite(roundNum) && roundNum >= 1 ? roundNum : 1,
        round_label: roundLabel.trim() || undefined,
        mode,
        window_start: new Date(`${interviewDate}T${startTime}`).toISOString(),
        window_end: new Date(`${interviewDate}T${endTime}`).toISOString(),
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
    !!interviewDate &&
    !!startTime &&
    !!endTime &&
    endTime > startTime &&
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
              {!addingLocation && locations.length > 0 ? (
                <>
                  <div className="flex items-center gap-2">
                    <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputCls}>
                      <option value="">Pick a location</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.label} — {[l.address, l.city].filter(Boolean).join(', ')}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setAddingLocation(true)}
                      className="shrink-0 whitespace-nowrap rounded-md border border-divider px-3 py-2 text-sm font-medium text-foreground-muted transition hover:text-foreground"
                    >
                      + Add
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-foreground-dim">
                    The venue snapshot (address + Google Maps link) is frozen into the round. Candidates get a reminder a day before.
                  </p>
                </>
              ) : (
                <div className="space-y-2 rounded-md border border-divider p-3">
                  {locations.length === 0 && (
                    <p className="text-[11px] text-foreground-dim">No saved venues yet — add one below.</p>
                  )}
                  <input
                    type="text"
                    value={newLoc.label}
                    onChange={(e) => setNewLoc((s) => ({ ...s, label: e.target.value }))}
                    placeholder="Venue name (e.g. Head office)"
                    className={inputCls}
                  />
                  <input
                    type="text"
                    value={newLoc.address}
                    onChange={(e) => setNewLoc((s) => ({ ...s, address: e.target.value }))}
                    placeholder="Full address"
                    className={inputCls}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={newLoc.city}
                      onChange={(e) => setNewLoc((s) => ({ ...s, city: e.target.value }))}
                      placeholder="City"
                      className={inputCls}
                    />
                    <input
                      type="text"
                      value={newLoc.region}
                      onChange={(e) => setNewLoc((s) => ({ ...s, region: e.target.value }))}
                      placeholder="State / region"
                      className={inputCls}
                    />
                  </div>
                  <input
                    type="text"
                    value={newLoc.google_maps_url}
                    onChange={(e) => setNewLoc((s) => ({ ...s, google_maps_url: e.target.value }))}
                    placeholder="Google Maps link (optional)"
                    className={inputCls}
                  />
                  <div className="flex items-center justify-end gap-2 pt-1">
                    {locations.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setAddingLocation(false)}
                        className="rounded-md px-3 py-1.5 text-sm font-medium text-foreground-muted transition hover:text-foreground"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => createLocation.mutate()}
                      disabled={!newLoc.label.trim() || !newLoc.address.trim() || createLocation.isPending}
                      className="rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                    >
                      {createLocation.isPending ? 'Saving…' : 'Save & use'}
                    </button>
                  </div>
                  <p className="text-[11px] text-foreground-dim">
                    Saved to this business so you can reuse it. The snapshot is frozen into the round; candidates get a reminder a day before.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Window + capacity */}
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Interview date</label>
            <input type="date" value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)} className={inputCls} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Start time</label>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">End time</label>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Minutes / interview</label>
              <input type="number" min={5} max={240} value={minutes} onChange={(e) => setMinutes(e.target.value)} className={inputCls} />
            </div>
          </div>
          {startTime && endTime && endTime <= startTime && (
            <p className="text-[11px] text-red-500">End time must be after the start time.</p>
          )}
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
