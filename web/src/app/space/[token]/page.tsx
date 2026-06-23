'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type {
  DesignSharePayload,
  DesignShareSpace,
  DesignShareStatusLane,
  DesignShareTask,
  TaskPriority,
  TaskTypeField,
} from '@squadhub/shared';
import {
  LANE_LABEL,
  computePlanUsage,
  countByLane,
  formatHours,
  rollupTimeHistory,
} from '../../../lib/designShareRollups';

type TabKey = 'dashboard' | 'reports' | 'completed';

// Monochrome pills with a single colored status dot — matches the UpSquad
// website's mostly-black/white language where colour is used sparingly.
const LANE_COLORS: Record<DesignShareStatusLane, { fg: string; bg: string; dot: string }> = {
  progress: { fg: '#0A0A0A', bg: '#F5F5F2', dot: '#0A0A0A' },
  review: { fg: '#0A0A0A', bg: '#F5F5F2', dot: '#8B7DF7' },
  queued: { fg: '#525252', bg: '#F5F5F2', dot: '#C4C4C4' },
  done: { fg: '#0A0A0A', bg: '#F5F5F2', dot: '#2BB673' },
};

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

function dueLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function DesignSpaceSharePage() {
  const params = useParams();
  const token = (params?.token as string) || '';

  const [payload, setPayload] = useState<DesignSharePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('dashboard');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setPayload({ valid: false });
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/design-share/${token}`);
      const data = await res.json();
      setPayload(data?.success && data.data ? (data.data as DesignSharePayload) : { valid: false });
    } catch {
      setPayload({ valid: false });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="ds-bg ds-center">
        <p className="ds-muted">Loading…</p>
        <style jsx global>{styles}</style>
      </div>
    );
  }

  if (!payload || !payload.valid) {
    const disabled = payload?.disabled;
    return (
      <div className="ds-bg ds-center">
        <div className="ds-card ds-state">
          <h1 className="ds-state-title">{disabled ? 'Link paused' : 'Link unavailable'}</h1>
          <p className="ds-muted">
            {disabled
              ? 'This shared workspace has been temporarily disabled. Please check back later or ask your contact for access.'
              : 'This link is invalid or is no longer available. Please ask your contact for a new link.'}
          </p>
        </div>
        <style jsx global>{styles}</style>
      </div>
    );
  }

  const client = payload.client;
  const spaces = payload.spaces || [];

  if (spaces.length === 0) {
    return (
      <div className="ds-bg ds-center">
        <div className="ds-card ds-state">
          <h1 className="ds-state-title">{client?.name || 'Workspace'}</h1>
          <p className="ds-muted">No spaces have been set up for this client yet. Please check back soon.</p>
        </div>
        <style jsx global>{styles}</style>
      </div>
    );
  }

  const selectedSpace = spaces.find((s) => s.id === selectedSpaceId) || spaces[0];

  return (
    <div className="ds-bg">
      <header className="ds-header">
        <div className="ds-header-inner">
          <div className="ds-header-row">
            <div className="ds-header-id">
              <p className="ds-eyebrow">
                <span className="ds-eyebrow-dot" />
                Client workspace
              </p>
              <h1 className="ds-title">{client?.name || 'Workspace'}</h1>
            </div>
            {spaces.length > 1 ? (
              <SpaceSwitcher
                spaces={spaces}
                selectedId={selectedSpace.id}
                onSelect={setSelectedSpaceId}
              />
            ) : (
              <span className="ds-space-tag">{selectedSpace.name}</span>
            )}
          </div>
        </div>
        <nav className="ds-tabs" role="tablist">
          {(['dashboard', 'reports', 'completed'] as TabKey[]).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              className="ds-tab"
              data-active={tab === k}
              onClick={() => setTab(k)}
            >
              {k === 'dashboard' ? 'Dashboard' : k === 'reports' ? 'Reports' : 'Completed'}
            </button>
          ))}
        </nav>
      </header>

      <main className="ds-main">
        {tab === 'dashboard' && <DashboardTab space={selectedSpace} />}
        {tab === 'reports' && <ReportsTab space={selectedSpace} />}
        {tab === 'completed' && <CompletedTab space={selectedSpace} />}
      </main>

      <button className="ds-fab" onClick={() => setSheetOpen(true)} aria-label="New request">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span>New request</span>
      </button>

      {sheetOpen && (
        <RequestSheet
          token={token}
          space={selectedSpace}
          onClose={() => setSheetOpen(false)}
          onSubmitted={() => {
            setSheetOpen(false);
            load();
          }}
        />
      )}

      <style jsx global>{styles}</style>
    </div>
  );
}

function SpaceSwitcher({
  spaces,
  selectedId,
  onSelect,
}: {
  spaces: DesignShareSpace[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = spaces.find((s) => s.id === selectedId) || spaces[0];
  return (
    <div className="ds-switch">
      <button
        type="button"
        className="ds-switch-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="ds-switch-name">{selected.name}</span>
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <>
          <div className="ds-switch-overlay" onClick={() => setOpen(false)} />
          <div className="ds-switch-menu" role="listbox">
            {spaces.map((s) => (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={s.id === selectedId}
                className="ds-switch-item"
                data-active={s.id === selectedId}
                onClick={() => {
                  onSelect(s.id);
                  setOpen(false);
                }}
              >
                <span className="ds-switch-name">{s.name}</span>
                {s.id === selectedId && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatusPill({ lane }: { lane: DesignShareStatusLane }) {
  const c = LANE_COLORS[lane];
  return (
    <span className="ds-pill" style={{ color: c.fg, background: c.bg }}>
      <span className="ds-pill-dot" style={{ background: c.dot }} />
      {LANE_LABEL[lane]}
    </span>
  );
}

function TaskCard({ task }: { task: DesignShareTask }) {
  const hrs = (task.time_tracked || 0) / 3600;
  const due = dueLabel(task.due_date);
  return (
    <div className="ds-task">
      <div className="ds-task-top">
        <StatusPill lane={task.status} />
        {task.category && <span className="ds-tag">{task.category}</span>}
      </div>
      <p className="ds-task-title">{task.title}</p>
      <div className="ds-task-meta">
        {hrs > 0 && (
          <span className="ds-meta-item" title="Hours tracked">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" strokeLinecap="round" />
            </svg>
            {formatHours(hrs)}
          </span>
        )}
        {due && (
          <span className="ds-meta-item" title="Due date">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="17" rx="2" />
              <path d="M3 9h18M8 3v3M16 3v3" strokeLinecap="round" />
            </svg>
            {due}
          </span>
        )}
        {task.assignees.length > 0 && (
          <span className="ds-assignees">
            {task.assignees.slice(0, 3).map((a, i) => (
              <span
                key={i}
                className="ds-avatar"
                title={a.display_name || ''}
                style={
                  a.avatar_url
                    ? { backgroundImage: `url(${a.avatar_url})`, backgroundSize: 'cover' }
                    : undefined
                }
              >
                {!a.avatar_url && initials(a.display_name)}
              </span>
            ))}
            {task.assignees[0]?.display_name && (
              <span className="ds-assignee-name">
                {task.assignees[0].display_name.split(' ')[0]}
                {task.assignees.length > 1 ? ` +${task.assignees.length - 1}` : ''}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function DashboardTab({ space }: { space: DesignShareSpace }) {
  const tasks = space.tasks;
  const counts = countByLane(tasks);
  const usage = computePlanUsage(space.time_summary, space.plan);
  const active = tasks.filter((t) => t.status !== 'done');
  const groups: DesignShareStatusLane[] = ['progress', 'review', 'queued'];

  return (
    <>
      <section className="ds-kpis">
        <div className="ds-kpi" data-dark="true">
          <span className="ds-kpi-val">{counts.progress}</span>
          <span className="ds-kpi-label">In progress</span>
        </div>
        <div className="ds-kpi">
          <span className="ds-kpi-val">{active.length}</span>
          <span className="ds-kpi-label">Open items</span>
        </div>
      </section>

      {space.plan.weekly_hours ? (
        <section className="ds-card ds-usage">
          <UsageRow label="This week" used={usage.usedWeek} allot={usage.weeklyHours} />
          <UsageRow label="This month" used={usage.usedMonth} allot={usage.monthlyHours} />
        </section>
      ) : null}

      <section className="ds-list">
        {active.length === 0 ? (
          <p className="ds-empty">No active tasks right now.</p>
        ) : (
          groups.map((lane) => {
            const items = active.filter((t) => t.status === lane);
            if (items.length === 0) return null;
            return (
              <div key={lane} className="ds-group">
                <h2 className="ds-group-head">
                  {LANE_LABEL[lane]} <span className="ds-count">{items.length}</span>
                </h2>
                {items.map((t) => (
                  <TaskCard key={t.id} task={t} />
                ))}
              </div>
            );
          })
        )}
      </section>
    </>
  );
}

function UsageRow({ label, used, allot }: { label: string; used: number; allot: number }) {
  const pct = allot > 0 ? Math.min(100, Math.round((used / allot) * 100)) : 0;
  return (
    <div className="ds-usage-row">
      <div className="ds-usage-top">
        <span>{label}</span>
        <span className="ds-usage-num">
          {formatHours(used)} {allot > 0 && <span className="ds-muted">/ {allot}h</span>}
        </span>
      </div>
      <div className="ds-bar">
        <div className="ds-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ReportsTab({ space }: { space: DesignShareSpace }) {
  const plan = space.plan;
  const usage = computePlanUsage(space.time_summary, plan);
  const history = useMemo(
    () => rollupTimeHistory(space.time_summary, plan),
    [space.time_summary, plan],
  );

  return (
    <>
      <section className="ds-card ds-usage">
        <UsageRow label="Today" used={usage.usedToday} allot={usage.dailyHours} />
        <UsageRow label="This week" used={usage.usedWeek} allot={usage.weeklyHours} />
        <UsageRow label="This month" used={usage.usedMonth} allot={usage.monthlyHours} />
      </section>

      <BarSection title="Daily" subtitle="Last 14 days" rows={history.days.map((d) => ({
        label: d.label,
        actual: d.actualHours,
        allot: d.allotHours,
        muted: d.weekend,
        highlight: d.today,
      }))} />

      <BarSection title="Weekly" subtitle="Last 10 weeks" rows={history.weeks.map((w) => ({
        label: w.label,
        actual: w.actualHours,
        allot: w.allotHours,
        highlight: w.current,
      }))} />

      <BarSection title="Monthly" subtitle="Last 6 months" rows={history.months.map((m) => ({
        label: m.label,
        actual: m.actualHours,
        allot: m.allotHours,
        highlight: m.current,
      }))} />
    </>
  );
}

function BarSection({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: { label: string; actual: number; allot: number; muted?: boolean; highlight?: boolean }[];
}) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.actual, r.allot)));
  return (
    <section className="ds-card">
      <div className="ds-section-head">
        <h2 className="ds-section-title">{title}</h2>
        <span className="ds-muted ds-section-sub">{subtitle}</span>
      </div>
      <div className="ds-barlist">
        {rows.map((r, i) => (
          <div key={i} className="ds-barrow" data-highlight={!!r.highlight}>
            <span className="ds-barrow-label" data-muted={!!r.muted}>{r.label}</span>
            <div className="ds-barrow-track">
              <div
                className="ds-barrow-fill"
                style={{ width: `${Math.min(100, (r.actual / max) * 100)}%` }}
              />
            </div>
            <span className="ds-barrow-val">{r.actual > 0 ? formatHours(r.actual) : '—'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CompletedTab({ space }: { space: DesignShareSpace }) {
  const done = space.tasks.filter((t) => t.status === 'done');
  return (
    <section className="ds-list">
      {done.length === 0 ? (
        <p className="ds-empty">No completed tasks yet.</p>
      ) : (
        <div className="ds-group">
          <h2 className="ds-group-head">
            Completed <span className="ds-count">{done.length}</span>
          </h2>
          {done.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </div>
      )}
    </section>
  );
}

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'none', label: 'No preference' },
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

// Uploads a recorded voice note onto a just-created request task: presign →
// direct PUT to R2 → confirm. Mirrors the internal task-attachments flow.
async function uploadVoiceNote(token: string, taskId: string, file: File): Promise<void> {
  const contentType = file.type || 'audio/webm';
  const pres = await fetch(`/design-share/${token}/voice-note/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task_id: taskId,
      filename: file.name,
      content_type: contentType,
      file_size: file.size,
    }),
  });
  const pd = await pres.json();
  if (!pd.success) throw new Error(pd.error || 'presign failed');

  const put = await fetch(pd.data.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!put.ok) throw new Error('upload failed');

  const conf = await fetch(`/design-share/${token}/voice-note/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task_id: taskId,
      object_key: pd.data.key,
      file_name: file.name,
      mime_type: contentType,
    }),
  });
  const cd = await conf.json();
  if (!cd.success) throw new Error(cd.error || 'confirm failed');
}

// In-browser voice recorder (MediaRecorder), mirroring the internal New Design
// Task form's recorder. Records one note; supports preview + remove/re-record.
function VoiceRecorder({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(0);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const start = async () => {
    setErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const mr = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        const ext = mr.mimeType.includes('webm') ? 'webm' : 'ogg';
        const f = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: mr.mimeType });
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(URL.createObjectURL(blob));
        onChange(f);
      };
      mr.start(250);
      recRef.current = mr;
      startRef.current = Date.now();
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 200);
    } catch {
      setErr('Microphone access was blocked. Check your browser permissions.');
    }
  };

  const stop = () => {
    recRef.current?.stop();
    recRef.current = null;
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const remove = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    onChange(null);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div className="ds-field">
      <label className="ds-field-label">
        Voice note <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span>
      </label>
      {file && previewUrl ? (
        <div className="ds-voice-row">
          <audio src={previewUrl} controls className="ds-audio" />
          <button type="button" className="ds-voice-del" onClick={remove} aria-label="Remove voice note">
            ✕
          </button>
        </div>
      ) : recording ? (
        <button type="button" className="ds-voice-btn recording" onClick={stop}>
          <span className="ds-voice-pulse" />
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(elapsed)}</span> · Stop
        </button>
      ) : (
        <button type="button" className="ds-voice-btn" onClick={start}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
            <path d="M19 10v2a7 7 0 01-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
          </svg>
          Record voice note
        </button>
      )}
      {err && <p className="ds-voice-err">{err}</p>}
    </div>
  );
}

function RequestSheet({
  token,
  space,
  onClose,
  onSubmitted,
}: {
  token: string;
  space: DesignShareSpace;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const fields = space.fields;
  const isVideo = space.is_video;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('none');
  const [dueDate, setDueDate] = useState('');
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [voiceFailed, setVoiceFailed] = useState(false);
  const [error, setError] = useState('');

  // Mirrors the internal form: drop empty values so they don't persist.
  const setField = (key: string, v: unknown) =>
    setCustom((prev) => {
      const next = { ...prev };
      if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) {
        delete next[key];
        if (Array.isArray(v) && v.length === 0) delete next[`${key}_other`];
      } else next[key] = v;
      return next;
    });

  const toggleMulti = (key: string, value: string, allowOther: boolean) =>
    setCustom((prev) => {
      const arr = Array.isArray(prev[key]) ? [...(prev[key] as string[])] : [];
      const i = arr.indexOf(value);
      if (i >= 0) arr.splice(i, 1);
      else arr.push(value);
      const next = { ...prev };
      if (arr.length) next[key] = arr;
      else delete next[key];
      if (allowOther && value === '__other__' && i >= 0) delete next[`${key}_other`];
      return next;
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!title.trim() || !description.trim()) {
      setError('Please add a title and a short description.');
      return;
    }
    const missing = fields.find((f) => {
      if (!f.is_required) return false;
      const v = custom[f.key];
      return v == null || v === '' || (Array.isArray(v) && v.length === 0);
    });
    if (missing) {
      setError(`Please fill in "${missing.label}".`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/design-share/${token}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          space_id: space.id,
          title: title.trim(),
          description: description.trim(),
          priority: priority !== 'none' ? priority : undefined,
          due_date: dueDate || undefined,
          custom: Object.keys(custom).length ? custom : undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      // Voice note is best-effort — the request itself already succeeded, so a
      // failed upload should not block the success state.
      const taskId = data.data?.id as string | undefined;
      if (taskId && voiceFile) {
        try {
          await uploadVoiceNote(token, taskId, voiceFile);
        } catch (e) {
          console.error('Voice note upload failed:', e);
          setVoiceFailed(true);
        }
      }
      setDone(true);
    } catch {
      setError('Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ds-sheet-backdrop" onClick={onClose}>
      <div className="ds-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="ds-sheet-grip" />
        {done ? (
          <div className="ds-sheet-done">
            <div className="ds-done-check">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="ds-sheet-title">Request sent</h2>
            <p className="ds-muted">Your request has been added to the workspace. The team will pick it up shortly.</p>
            {voiceFailed && (
              <p className="ds-voice-warn">
                Your request was sent, but the voice note couldn&apos;t be attached. You can mention
                the details in the brief instead.
              </p>
            )}
            <button className="ds-btn-primary" onClick={onSubmitted}>Done</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2 className="ds-sheet-title">New {isVideo ? 'video' : 'design'} request</h2>
            <p className="ds-muted ds-sheet-sub">Tell the team what you need. They&apos;ll see it in the workspace.</p>
            {error && <div className="ds-error">{error}</div>}

            <label className="ds-field-label">Title</label>
            <input
              className="ds-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={isVideo ? 'e.g. Launch reel edit' : 'e.g. Instagram carousel for launch'}
              maxLength={200}
              autoFocus
            />

            <label className="ds-field-label">Brief</label>
            <textarea
              className="ds-input ds-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                isVideo
                  ? 'Describe the video — goal, story, tone, and what a great result looks like.'
                  : 'Describe what you want — goals, context, and what success looks like.'
              }
              rows={4}
              maxLength={5000}
            />

            <VoiceRecorder file={voiceFile} onChange={setVoiceFile} />

            {fields.map((f) => (
              <DesignFieldInput
                key={f.id}
                field={f}
                value={custom[f.key]}
                otherValue={custom[`${f.key}_other`] as string | undefined}
                onScalar={(v) => setField(f.key, v)}
                onToggleMulti={(v) => toggleMulti(f.key, v, f.allow_other)}
                onOther={(v) => setField(`${f.key}_other`, v)}
              />
            ))}

            <div className="ds-field-row2">
              <div>
                <label className="ds-field-label">Priority</label>
                <select
                  className="ds-input"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="ds-field-label">Needed by</label>
                <input
                  type="date"
                  className="ds-input"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>

            <div className="ds-sheet-actions">
              <button type="button" className="ds-btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="ds-btn-primary" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// Renders one design/video brief field, matching the internal New Design Task
// form's widgets and producing the same metadata.custom value shape.
function DesignFieldInput({
  field,
  value,
  otherValue,
  onScalar,
  onToggleMulti,
  onOther,
}: {
  field: TaskTypeField;
  value: unknown;
  otherValue: string | undefined;
  onScalar: (v: unknown) => void;
  onToggleMulti: (v: string) => void;
  onOther: (v: string) => void;
}) {
  const labelEl = (
    <label className="ds-field-label">
      {field.label}
      {field.is_required && <span className="ds-req-star">*</span>}
    </label>
  );

  if (field.field_type === 'multi_select') {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    const otherOn = selected.includes('__other__');
    return (
      <div className="ds-field">
        {labelEl}
        <div className="ds-fchips">
          {field.options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button
                type="button"
                key={o.value}
                className="ds-fchip"
                data-on={on}
                onClick={() => onToggleMulti(o.value)}
              >
                {on ? `✓ ${o.label}` : o.label}
              </button>
            );
          })}
          {field.allow_other && (
            <button
              type="button"
              className="ds-fchip"
              data-on={otherOn}
              onClick={() => onToggleMulti('__other__')}
            >
              {otherOn ? '✓ Other' : 'Other'}
            </button>
          )}
        </div>
        {otherOn && (
          <input
            className="ds-input"
            style={{ marginTop: 8 }}
            value={otherValue || ''}
            onChange={(e) => onOther(e.target.value)}
            placeholder="Tell us more…"
            maxLength={200}
          />
        )}
      </div>
    );
  }

  if (field.field_type === 'select') {
    const current = typeof value === 'string' ? value : '';
    return (
      <div className="ds-field">
        {labelEl}
        <select className="ds-input" value={current} onChange={(e) => onScalar(e.target.value)}>
          <option value="">Select…</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
          {field.allow_other && <option value="__other__">Other</option>}
        </select>
        {current === '__other__' && (
          <input
            className="ds-input"
            style={{ marginTop: 8 }}
            value={otherValue || ''}
            onChange={(e) => onOther(e.target.value)}
            placeholder="Tell us more…"
            maxLength={200}
          />
        )}
      </div>
    );
  }

  if (field.field_type === 'textarea') {
    return (
      <div className="ds-field">
        {labelEl}
        <textarea
          className="ds-input ds-textarea"
          value={(value as string) || ''}
          onChange={(e) => onScalar(e.target.value)}
          placeholder={field.placeholder || ''}
          rows={3}
          maxLength={4000}
        />
      </div>
    );
  }

  if (field.field_type === 'checkbox') {
    return (
      <div className="ds-field">
        <label className="ds-check">
          <input type="checkbox" checked={!!value} onChange={(e) => onScalar(e.target.checked)} />
          {field.label}
          {field.is_required && <span className="ds-req-star">*</span>}
        </label>
      </div>
    );
  }

  // text | url | number | date
  const type = field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : field.field_type === 'url' ? 'url' : 'text';
  return (
    <div className="ds-field">
      {labelEl}
      <input
        className="ds-input"
        type={type}
        value={(value as string | number) ?? ''}
        onChange={(e) =>
          onScalar(field.field_type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)
        }
        placeholder={field.placeholder || ''}
        maxLength={field.field_type === 'url' ? 500 : 1000}
      />
    </div>
  );
}

const styles = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,600;0,700;0,800;1,700&family=Inter:wght@400;500;600;700&family=Sometype+Mono:wght@400;500&display=swap');
:root { color-scheme: light; }
* { box-sizing: border-box; }
.ds-bg {
  min-height: 100dvh;
  background:
    radial-gradient(ellipse 70% 45% at 12% 0%, rgba(0,0,0,0.035) 0%, transparent 60%),
    linear-gradient(180deg, #FAFAFA 0%, #FFFFFF 40%);
  color: #0A0A0A;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-feature-settings: 'cv11','ss01','ss03';
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  line-height: 1.65;
  padding-bottom: calc(100px + env(safe-area-inset-bottom, 0px));
}
.ds-center { display: flex; align-items: center; justify-content: center; padding: 24px; min-height: 100dvh; flex-direction: column; }
.ds-muted { color: #A3A3A3; }
.ds-state { text-align: center; max-width: 400px; background: #fff; border: 1px solid rgba(0,0,0,0.07); border-radius: 24px; padding: 36px 28px; box-shadow: 0 18px 50px -28px rgba(0,0,0,0.22); }
.ds-state-title { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 8px; color: #0A0A0A; }
.ds-state .ds-muted { color: #525252; line-height: 1.6; font-size: 14px; }

.ds-header {
  position: sticky; top: 0; z-index: 20;
  background:
    linear-gradient(to right, rgba(10,10,10,0.045) 1px, transparent 1px) 0 0 / 44px 44px,
    linear-gradient(to bottom, rgba(10,10,10,0.045) 1px, transparent 1px) 0 0 / 44px 44px,
    rgba(250,250,250,0.86);
  backdrop-filter: saturate(180%) blur(12px);
  -webkit-backdrop-filter: saturate(180%) blur(12px);
  border-bottom: 1px solid rgba(0,0,0,0.07);
  padding-top: env(safe-area-inset-top, 0px);
}
.ds-header-inner { max-width: 640px; margin: 0 auto; padding: 18px 18px 10px; }
.ds-header-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.ds-header-id { min-width: 0; }
.ds-space-tag { flex-shrink: 0; align-self: center; font-family: 'Sometype Mono', monospace; font-size: 11px; font-weight: 500; letter-spacing: 0.04em; color: #525252; background: rgba(0,0,0,0.04); border: 1px solid rgba(0,0,0,0.08); border-radius: 999px; padding: 6px 12px; white-space: nowrap; }
.ds-switch { position: relative; flex-shrink: 0; align-self: center; }
.ds-switch-btn { display: inline-flex; align-items: center; gap: 8px; max-width: 190px; background: #fff; border: 1px solid rgba(0,0,0,0.12); border-radius: 999px; padding: 9px 13px; font-size: 13px; font-weight: 600; color: #0A0A0A; cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,0.04); font-family: 'Inter', sans-serif; transition: border-color .15s; }
.ds-switch-btn:hover { border-color: rgba(0,0,0,0.28); }
.ds-switch-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ds-switch-overlay { position: fixed; inset: 0; z-index: 24; }
.ds-switch-menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 25; min-width: 200px; max-width: 260px; background: #fff; border: 1px solid rgba(0,0,0,0.1); border-radius: 16px; padding: 6px; box-shadow: 0 18px 44px -18px rgba(0,0,0,0.3); display: flex; flex-direction: column; gap: 2px; }
.ds-switch-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; text-align: left; background: transparent; border: 0; border-radius: 11px; padding: 10px 12px; font-size: 13.5px; font-weight: 500; color: #0A0A0A; cursor: pointer; font-family: 'Inter', sans-serif; }
.ds-switch-item:hover { background: rgba(0,0,0,0.04); }
.ds-switch-item[data-active="true"] { font-weight: 700; }
.ds-eyebrow {
  display: inline-flex; align-items: center; gap: 8px; margin: 0 0 7px;
  font-family: 'Sometype Mono', monospace; font-size: 11px; font-weight: 500;
  letter-spacing: 0.16em; text-transform: uppercase; color: #A3A3A3;
}
.ds-eyebrow-dot { position: relative; width: 7px; height: 7px; border-radius: 999px; background: #FFFF99; box-shadow: 0 0 0 1px rgba(0,0,0,0.18); }
.ds-eyebrow-dot::after { content: ''; position: absolute; inset: 0; border-radius: 999px; background: #FFFF99; animation: ds-ping 1.9s cubic-bezier(0,0,0.2,1) infinite; }
@keyframes ds-ping { 75%, 100% { transform: scale(2.4); opacity: 0; } }
.ds-title { font-family: 'Plus Jakarta Sans', sans-serif; margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.05; color: #0A0A0A; }
.ds-tabs { max-width: 640px; margin: 6px auto 0; padding: 0 14px; display: flex; gap: 6px; }
.ds-tab {
  flex: 1; appearance: none; border: 0; background: transparent; cursor: pointer;
  padding: 11px 8px 13px; font-size: 13.5px; font-weight: 600; color: #A3A3A3;
  border-bottom: 2px solid transparent; transition: color .15s, border-color .15s;
  font-family: 'Inter', sans-serif;
}
.ds-tab[data-active="true"] { color: #0A0A0A; border-bottom-color: #0A0A0A; }

.ds-main { max-width: 640px; margin: 0 auto; padding: 18px 14px 0; display: flex; flex-direction: column; gap: 16px; }

.ds-card { background: #fff; border: 1px solid rgba(0,0,0,0.06); border-radius: 20px; padding: 18px; box-shadow: 0 18px 44px -30px rgba(0,0,0,0.22); }

.ds-kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.ds-kpi {
  background: #fff; border: 1px solid rgba(0,0,0,0.06); border-radius: 18px; padding: 16px 13px;
  display: flex; flex-direction: column; gap: 5px; box-shadow: 0 14px 34px -26px rgba(0,0,0,0.22);
}
.ds-kpi[data-dark="true"] { background: #0A0A0A; border-color: #0A0A0A; box-shadow: 0 20px 44px -22px rgba(0,0,0,0.55); }
.ds-kpi[data-dark="true"] .ds-kpi-val { color: #fff; }
.ds-kpi[data-dark="true"] .ds-kpi-label { color: rgba(255,255,255,0.55); }
.ds-kpi-val { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 26px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; color: #0A0A0A; }
.ds-kpi-label { font-size: 11.5px; color: #A3A3A3; font-weight: 500; }

.ds-usage { display: flex; flex-direction: column; gap: 15px; }
.ds-usage-row { display: flex; flex-direction: column; gap: 8px; }
.ds-usage-top { display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; color: #0A0A0A; }
.ds-usage-num { font-variant-numeric: tabular-nums; }
.ds-bar { height: 8px; border-radius: 999px; background: #F0F0EE; overflow: hidden; }
.ds-bar-fill { height: 100%; border-radius: 999px; background: #0A0A0A; }

.ds-list { display: flex; flex-direction: column; gap: 20px; }
.ds-group { display: flex; flex-direction: column; gap: 10px; }
.ds-group-head { font-family: 'Sometype Mono', monospace; margin: 2px 2px; font-size: 11px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: #A3A3A3; display: flex; align-items: center; gap: 8px; }
.ds-count { font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 600; color: #525252; background: rgba(0,0,0,0.05); border-radius: 999px; padding: 1px 8px; letter-spacing: 0; }
.ds-empty { text-align: center; color: #A3A3A3; font-size: 14px; padding: 36px 0; }

.ds-task { background: #fff; border: 1px solid rgba(0,0,0,0.06); border-radius: 16px; padding: 14px 15px; box-shadow: 0 12px 30px -26px rgba(0,0,0,0.22); transition: transform .2s ease, box-shadow .2s ease; }
.ds-task:active { transform: translateY(1px); }
.ds-task-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.ds-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(0,0,0,0.06); }
.ds-pill-dot { width: 6px; height: 6px; border-radius: 999px; }
.ds-tag { font-family: 'Sometype Mono', monospace; font-size: 10px; font-weight: 500; letter-spacing: 0.04em; color: #525252; background: rgba(0,0,0,0.04); border: 1px solid rgba(0,0,0,0.06); border-radius: 7px; padding: 3px 8px; text-transform: uppercase; }
.ds-task-title { font-family: 'Plus Jakarta Sans', sans-serif; margin: 0; font-size: 15px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.35; color: #0A0A0A; }
.ds-task-meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 10px; }
.ds-meta-item { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #A3A3A3; font-variant-numeric: tabular-nums; }
.ds-assignees { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }
.ds-avatar {
  width: 22px; height: 22px; border-radius: 999px; background: #EDEDED; color: #525252;
  font-size: 9.5px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center;
  border: 1.5px solid #fff; margin-left: -8px; background-position: center;
}
.ds-avatar:first-child { margin-left: 0; }
.ds-assignee-name { font-size: 12px; color: #525252; font-weight: 500; }

.ds-section-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px; }
.ds-section-title { font-family: 'Plus Jakarta Sans', sans-serif; margin: 0; font-size: 15px; font-weight: 700; letter-spacing: -0.01em; color: #0A0A0A; }
.ds-section-sub { font-family: 'Sometype Mono', monospace; font-size: 10px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; color: #A3A3A3; }
.ds-barlist { display: flex; flex-direction: column; gap: 9px; }
.ds-barrow { display: grid; grid-template-columns: 86px 1fr 52px; align-items: center; gap: 10px; }
.ds-barrow[data-highlight="true"] .ds-barrow-label { color: #0A0A0A; font-weight: 700; }
.ds-barrow-label { font-size: 12px; color: #525252; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ds-barrow-label[data-muted="true"] { color: #C4C4C4; }
.ds-barrow-track { height: 7px; border-radius: 999px; background: #F0F0EE; overflow: hidden; }
.ds-barrow-fill { height: 100%; border-radius: 999px; background: #0A0A0A; min-width: 2px; }
.ds-barrow-val { font-size: 12px; color: #0A0A0A; text-align: right; font-variant-numeric: tabular-nums; }

.ds-fab {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(20px + env(safe-area-inset-bottom, 0px)); z-index: 30;
  display: inline-flex; align-items: center; gap: 8px;
  background: #0A0A0A; color: #fff; border: 1px solid #0A0A0A; border-radius: 999px;
  padding: 14px 22px; font-size: 14px; font-weight: 600; cursor: pointer;
  box-shadow: 0 14px 30px -10px rgba(0,0,0,0.5); transition: transform .25s ease, box-shadow .25s ease;
  font-family: 'Inter', sans-serif;
}
.ds-fab:hover { transform: translateX(-50%) translateY(-2px); box-shadow: 0 20px 38px -12px rgba(0,0,0,0.55); }
.ds-fab:active { transform: translateX(-50%) scale(0.98); }

.ds-sheet-backdrop {
  position: fixed; inset: 0; z-index: 40; background: rgba(10,10,10,0.5);
  -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
  display: flex; align-items: flex-end; justify-content: center;
}
.ds-sheet {
  width: 100%; max-width: 560px; background: #fff;
  border-radius: 26px 26px 0 0; padding: 10px 20px calc(22px + env(safe-area-inset-bottom, 0px));
  max-height: 92dvh; overflow-y: auto; animation: ds-slide-up .24s cubic-bezier(0.3,0.85,0.4,1);
  border: 1px solid rgba(0,0,0,0.06);
}
@keyframes ds-slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
.ds-sheet-grip { width: 40px; height: 4px; border-radius: 999px; background: #E5E5E5; margin: 4px auto 16px; }
.ds-sheet-title { font-family: 'Plus Jakarta Sans', sans-serif; margin: 0 0 4px; font-size: 20px; font-weight: 800; letter-spacing: -0.02em; color: #0A0A0A; }
.ds-sheet-sub { margin: 0 0 14px; font-size: 13px; color: #A3A3A3; }
.ds-field-label { display: block; font-size: 12.5px; font-weight: 600; color: #0A0A0A; margin: 14px 0 7px; }
.ds-field { margin-top: 4px; }
.ds-field-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ds-req-star { color: #d4351c; margin-left: 2px; }
.ds-fchips { display: flex; flex-wrap: wrap; gap: 7px; }
.ds-fchip { min-height: 36px; padding: 7px 14px; border-radius: 999px; font-size: 13px; font-weight: 500; background: #fff; color: #0A0A0A; border: 1px solid rgba(0,0,0,0.12); cursor: pointer; transition: border-color .15s, background-color .15s, color .15s, box-shadow .15s; }
.ds-fchip:hover { border-color: rgba(0,0,0,0.28); }
.ds-fchip[data-on="true"] { background: #0A0A0A; color: #fff; border-color: #0A0A0A; box-shadow: 0 6px 16px -8px rgba(0,0,0,0.4); }
.ds-check { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500; color: #0A0A0A; cursor: pointer; margin-top: 14px; }
.ds-voice-btn { display: inline-flex; align-items: center; gap: 8px; background: #fff; border: 1px solid rgba(0,0,0,0.12); color: #0A0A0A; border-radius: 999px; padding: 11px 18px; font-size: 14px; font-weight: 600; cursor: pointer; transition: border-color .15s, color .15s, box-shadow .15s; box-shadow: 0 2px 10px rgba(0,0,0,0.04); }
.ds-voice-btn:hover { border-color: rgba(0,0,0,0.28); }
.ds-voice-btn.recording { border-color: #d4351c; color: #d4351c; }
.ds-voice-pulse { width: 9px; height: 9px; border-radius: 999px; background: #d4351c; animation: ds-pulse 1s infinite; }
@keyframes ds-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
.ds-voice-row { display: flex; align-items: center; gap: 10px; }
.ds-audio { flex: 1; min-width: 0; height: 38px; }
.ds-voice-del { flex-shrink: 0; width: 36px; height: 36px; border-radius: 999px; border: 1px solid rgba(0,0,0,0.12); background: #fff; color: #A3A3A3; cursor: pointer; font-size: 13px; }
.ds-voice-del:hover { border-color: #d4351c; color: #d4351c; }
.ds-voice-err { color: #b91c1c; font-size: 12px; margin-top: 6px; }
.ds-voice-warn { color: #8a6d00; background: #fffdf0; border: 1px solid #FFFF99; border-radius: 12px; padding: 10px 12px; font-size: 12.5px; margin-top: 12px; line-height: 1.45; }
select.ds-input { appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23A3A3A3' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 13px center; padding-right: 36px; }
.ds-input {
  width: 100%; border: 1px solid rgba(0,0,0,0.12); border-radius: 14px; padding: 13px 14px;
  font-size: 16px; color: #0A0A0A; background: #fff; transition: border-color .15s, box-shadow .15s;
  font-family: 'Inter', sans-serif;
}
.ds-input:focus { outline: none; border-color: #0A0A0A; box-shadow: 0 0 0 3px rgba(10,10,10,0.08); }
.ds-input::placeholder { color: #A3A3A3; }
.ds-textarea { resize: none; line-height: 1.5; }
.ds-sheet-actions { display: flex; gap: 10px; margin-top: 20px; }
.ds-btn-primary {
  flex: 1; background: #0A0A0A; color: #fff; border: 1px solid #0A0A0A; border-radius: 999px;
  padding: 14px; font-size: 15px; font-weight: 600; cursor: pointer;
  box-shadow: 0 10px 24px -10px rgba(0,0,0,0.5); transition: transform .25s ease, box-shadow .25s ease;
}
.ds-btn-primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 16px 30px -12px rgba(0,0,0,0.55); }
.ds-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
.ds-btn-ghost { background: #fff; color: #0A0A0A; border: 1px solid rgba(0,0,0,0.12); border-radius: 999px; padding: 14px 20px; font-size: 15px; font-weight: 600; cursor: pointer; }
.ds-error { background: #fff5f5; border: 1px solid #f3c2c2; color: #b91c1c; border-radius: 12px; padding: 10px 12px; font-size: 13px; font-weight: 500; margin-bottom: 4px; }
.ds-sheet-done { text-align: center; padding: 12px 0 6px; }
.ds-done-check { width: 62px; height: 62px; border-radius: 999px; background: #FFFF99; color: #0A0A0A; display: flex; align-items: center; justify-content: center; margin: 4px auto 14px; box-shadow: 0 0 0 6px rgba(255,255,153,0.35); }

@media (min-width: 560px) {
  .ds-fab { left: auto; right: max(24px, calc(50vw - 280px + 14px)); transform: none; }
  .ds-fab:hover { transform: translateY(-2px); }
  .ds-fab:active { transform: translateY(0) scale(0.98); }
}
`;
