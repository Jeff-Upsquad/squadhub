'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type {
  DesignSharePayload,
  DesignSharePlan,
  DesignShareStatusLane,
  DesignShareTask,
} from '@squadhub/shared';
import {
  LANE_LABEL,
  computePlanUsage,
  countByLane,
  formatHours,
  rollupTimeHistory,
  totalHoursSpent,
} from '../../../lib/designShareRollups';

type TabKey = 'dashboard' | 'reports' | 'completed';

// Stable fallback so memo deps don't see a fresh object literal each render.
const NULL_PLAN: DesignSharePlan = { daily_hours: null, weekly_hours: null, monthly_hours: null };

const LANE_COLORS: Record<DesignShareStatusLane, { fg: string; bg: string; dot: string }> = {
  progress: { fg: '#1d4ed8', bg: '#eff6ff', dot: '#2563eb' },
  review: { fg: '#6d28d9', bg: '#f5f3ff', dot: '#7c3aed' },
  queued: { fg: '#475569', bg: '#f1f5f9', dot: '#64748b' },
  done: { fg: '#15803d', bg: '#f0fdf4', dot: '#16a34a' },
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

  const tasks = payload.tasks || [];
  const space = payload.space;

  return (
    <div className="ds-bg">
      <header className="ds-header">
        <div className="ds-header-inner">
          <p className="ds-eyebrow">{space?.is_video ? 'Video workspace' : 'Design workspace'}</p>
          <h1 className="ds-title">{space?.name || 'Workspace'}</h1>
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
        {tab === 'dashboard' && <DashboardTab payload={payload} tasks={tasks} />}
        {tab === 'reports' && <ReportsTab payload={payload} />}
        {tab === 'completed' && <CompletedTab tasks={tasks} />}
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

function DashboardTab({ payload, tasks }: { payload: DesignSharePayload; tasks: DesignShareTask[] }) {
  const counts = countByLane(tasks);
  const usage = computePlanUsage(payload.time_summary || [], payload.plan || NULL_PLAN);
  const totalHrs = totalHoursSpent(tasks);
  const active = tasks.filter((t) => t.status !== 'done');
  const groups: DesignShareStatusLane[] = ['progress', 'review', 'queued'];

  return (
    <>
      <section className="ds-kpis">
        <div className="ds-kpi">
          <span className="ds-kpi-val">{counts.progress}</span>
          <span className="ds-kpi-label">In progress</span>
        </div>
        <div className="ds-kpi">
          <span className="ds-kpi-val">{formatHours(totalHrs)}</span>
          <span className="ds-kpi-label">Total hours</span>
        </div>
        <div className="ds-kpi">
          <span className="ds-kpi-val">{active.length}</span>
          <span className="ds-kpi-label">Open items</span>
        </div>
      </section>

      {payload.plan?.weekly_hours ? (
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

function ReportsTab({ payload }: { payload: DesignSharePayload }) {
  const plan = payload.plan || NULL_PLAN;
  const usage = computePlanUsage(payload.time_summary || [], plan);
  const history = useMemo(
    () => rollupTimeHistory(payload.time_summary || [], plan),
    [payload.time_summary, plan],
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

function CompletedTab({ tasks }: { tasks: DesignShareTask[] }) {
  const done = tasks.filter((t) => t.status === 'done');
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

function RequestSheet({
  token,
  onClose,
  onSubmitted,
}: {
  token: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!title.trim() || !description.trim()) {
      setError('Please add a title and a short description.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/design-share/${token}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
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
            <button className="ds-btn-primary" onClick={onSubmitted}>Done</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2 className="ds-sheet-title">New request</h2>
            <p className="ds-muted ds-sheet-sub">Tell the team what you need. They&apos;ll see it in the workspace.</p>
            {error && <div className="ds-error">{error}</div>}
            <label className="ds-field-label">Title</label>
            <input
              className="ds-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Instagram carousel for launch"
              maxLength={200}
              autoFocus
            />
            <label className="ds-field-label">Description</label>
            <textarea
              className="ds-input ds-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the work, references, deadlines…"
              rows={4}
              maxLength={5000}
            />
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

const styles = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
.ds-bg {
  min-height: 100dvh;
  background: #f6f7f9;
  color: #0f172a;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px));
}
.ds-center { display: flex; align-items: center; justify-content: center; padding: 24px; min-height: 100dvh; flex-direction: column; }
.ds-muted { color: #64748b; }
.ds-state { text-align: center; max-width: 380px; }
.ds-state-title { font-size: 18px; font-weight: 700; margin: 0 0 8px; }

.ds-header {
  position: sticky; top: 0; z-index: 20;
  background: rgba(255,255,255,0.92);
  backdrop-filter: saturate(180%) blur(10px);
  border-bottom: 1px solid #e7eaee;
  padding-top: env(safe-area-inset-top, 0px);
}
.ds-header-inner { max-width: 640px; margin: 0 auto; padding: 16px 18px 10px; }
.ds-eyebrow { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #94a3b8; }
.ds-title { margin: 2px 0 0; font-size: 22px; font-weight: 750; letter-spacing: -0.02em; }
.ds-tabs { max-width: 640px; margin: 0 auto; padding: 0 12px; display: flex; gap: 4px; }
.ds-tab {
  flex: 1; appearance: none; border: 0; background: transparent; cursor: pointer;
  padding: 10px 8px 12px; font-size: 13.5px; font-weight: 600; color: #64748b;
  border-bottom: 2px solid transparent; transition: color .15s, border-color .15s;
}
.ds-tab[data-active="true"] { color: #0f172a; border-bottom-color: #0f172a; }

.ds-main { max-width: 640px; margin: 0 auto; padding: 16px 14px 0; display: flex; flex-direction: column; gap: 14px; }

.ds-card { background: #fff; border: 1px solid #e7eaee; border-radius: 16px; padding: 16px; box-shadow: 0 1px 2px rgba(15,23,42,0.04); }

.ds-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.ds-kpi {
  background: #fff; border: 1px solid #e7eaee; border-radius: 16px; padding: 14px 12px;
  display: flex; flex-direction: column; gap: 4px; box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
.ds-kpi-val { font-size: 24px; font-weight: 750; letter-spacing: -0.02em; line-height: 1; }
.ds-kpi-label { font-size: 11.5px; color: #64748b; font-weight: 500; }

.ds-usage { display: flex; flex-direction: column; gap: 14px; }
.ds-usage-row { display: flex; flex-direction: column; gap: 7px; }
.ds-usage-top { display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; }
.ds-usage-num { font-variant-numeric: tabular-nums; }
.ds-bar { height: 8px; border-radius: 999px; background: #eef1f4; overflow: hidden; }
.ds-bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg,#3b82f6,#6366f1); }

.ds-list { display: flex; flex-direction: column; gap: 18px; }
.ds-group { display: flex; flex-direction: column; gap: 10px; }
.ds-group-head { margin: 2px 2px; font-size: 13px; font-weight: 700; color: #334155; display: flex; align-items: center; gap: 8px; }
.ds-count { font-size: 11px; font-weight: 600; color: #64748b; background: #eef1f4; border-radius: 999px; padding: 1px 8px; }
.ds-empty { text-align: center; color: #94a3b8; font-size: 13.5px; padding: 32px 0; }

.ds-task { background: #fff; border: 1px solid #e7eaee; border-radius: 14px; padding: 13px 14px; box-shadow: 0 1px 2px rgba(15,23,42,0.03); }
.ds-task-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 7px; }
.ds-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; }
.ds-pill-dot { width: 6px; height: 6px; border-radius: 999px; }
.ds-tag { font-size: 10.5px; font-weight: 600; color: #475569; background: #f1f5f9; border-radius: 6px; padding: 2px 7px; text-transform: capitalize; }
.ds-task-title { margin: 0; font-size: 14.5px; font-weight: 600; line-height: 1.35; }
.ds-task-meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 9px; }
.ds-meta-item { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #64748b; font-variant-numeric: tabular-nums; }
.ds-assignees { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }
.ds-avatar {
  width: 22px; height: 22px; border-radius: 999px; background: #e2e8f0; color: #475569;
  font-size: 9.5px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center;
  border: 1.5px solid #fff; margin-left: -8px; background-position: center;
}
.ds-avatar:first-child { margin-left: 0; }
.ds-assignee-name { font-size: 12px; color: #475569; font-weight: 500; }

.ds-section-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
.ds-section-title { margin: 0; font-size: 14px; font-weight: 700; }
.ds-section-sub { font-size: 11.5px; }
.ds-barlist { display: flex; flex-direction: column; gap: 9px; }
.ds-barrow { display: grid; grid-template-columns: 86px 1fr 52px; align-items: center; gap: 10px; }
.ds-barrow[data-highlight="true"] .ds-barrow-label { color: #0f172a; font-weight: 700; }
.ds-barrow-label { font-size: 12px; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ds-barrow-label[data-muted="true"] { color: #b0b8c4; }
.ds-barrow-track { height: 7px; border-radius: 999px; background: #eef1f4; overflow: hidden; }
.ds-barrow-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg,#3b82f6,#6366f1); min-width: 2px; }
.ds-barrow-val { font-size: 12px; color: #334155; text-align: right; font-variant-numeric: tabular-nums; }

.ds-fab {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(18px + env(safe-area-inset-bottom, 0px)); z-index: 30;
  display: inline-flex; align-items: center; gap: 8px;
  background: #0f172a; color: #fff; border: 0; border-radius: 999px;
  padding: 13px 20px; font-size: 14px; font-weight: 650; cursor: pointer;
  box-shadow: 0 8px 24px rgba(15,23,42,0.28);
}
.ds-fab:active { transform: translateX(-50%) scale(0.97); }

.ds-sheet-backdrop {
  position: fixed; inset: 0; z-index: 40; background: rgba(15,23,42,0.45);
  display: flex; align-items: flex-end; justify-content: center;
}
.ds-sheet {
  width: 100%; max-width: 560px; background: #fff;
  border-radius: 22px 22px 0 0; padding: 10px 20px calc(22px + env(safe-area-inset-bottom, 0px));
  max-height: 92dvh; overflow-y: auto; animation: ds-slide-up .22s ease-out;
}
@keyframes ds-slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
.ds-sheet-grip { width: 40px; height: 4px; border-radius: 999px; background: #d8dee6; margin: 4px auto 14px; }
.ds-sheet-title { margin: 0 0 4px; font-size: 18px; font-weight: 750; }
.ds-sheet-sub { margin: 0 0 14px; font-size: 13px; }
.ds-field-label { display: block; font-size: 12.5px; font-weight: 600; color: #334155; margin: 12px 0 6px; }
.ds-input {
  width: 100%; border: 1px solid #d8dee6; border-radius: 12px; padding: 12px 13px;
  font-size: 16px; color: #0f172a; background: #fbfcfd; transition: border-color .15s, box-shadow .15s;
}
.ds-input:focus { outline: none; border-color: #0f172a; background: #fff; box-shadow: 0 0 0 3px rgba(15,23,42,0.08); }
.ds-input::placeholder { color: #9aa5b1; }
.ds-textarea { resize: none; line-height: 1.45; }
.ds-sheet-actions { display: flex; gap: 10px; margin-top: 18px; }
.ds-btn-primary {
  flex: 1; background: #0f172a; color: #fff; border: 0; border-radius: 12px;
  padding: 13px; font-size: 15px; font-weight: 650; cursor: pointer;
}
.ds-btn-primary:disabled { opacity: 0.55; cursor: not-allowed; }
.ds-btn-ghost { background: #f1f5f9; color: #334155; border: 0; border-radius: 12px; padding: 13px 18px; font-size: 15px; font-weight: 600; cursor: pointer; }
.ds-error { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 10px; padding: 10px 12px; font-size: 13px; font-weight: 500; margin-bottom: 4px; }
.ds-sheet-done { text-align: center; padding: 10px 0 6px; }
.ds-done-check { width: 60px; height: 60px; border-radius: 999px; background: #ecfdf3; color: #16a34a; display: flex; align-items: center; justify-content: center; margin: 4px auto 12px; }

@media (min-width: 560px) {
  .ds-fab { left: auto; right: max(24px, calc(50vw - 280px + 14px)); transform: none; }
  .ds-fab:active { transform: scale(0.97); }
}
`;
