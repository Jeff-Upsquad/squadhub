import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SquadBotJob, SquadBotActivityReport } from '@squadhub/shared';
import api from '../../../services/api';
import { errorMessage } from './shared';

const inputClass = 'w-full rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground';
const buttonClass = 'rounded-lg border border-divider px-3 py-2 text-sm text-foreground hover:bg-surface-alt disabled:opacity-40';
const outcomes = ['completed', 'failed', 'skipped', 'drafted'] as const;
const periods = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;

export default function JobsCard({ botId, paused }: { botId: string; paused: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<SquadBotJob | 'new' | null>(null);
  const [period, setPeriod] = useState<typeof periods[number]>('daily');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [jobId, setJobId] = useState('');
  const [page, setPage] = useState(0);
  const jobs = useQuery<SquadBotJob[]>({ queryKey: ['bot-jobs', botId], queryFn: () => api.get(`/admin/squad-bots/${botId}/jobs`).then(r => r.data.data) });
  const report = useQuery<SquadBotActivityReport>({
    queryKey: ['bot-activity', botId, period, date, jobId, page],
    queryFn: () => api.get(`/admin/squad-bots/${botId}/activity`, { params: { period, date, job_id: jobId || undefined, page } }).then(r => r.data.data),
    enabled: !!date, refetchInterval: 30000,
  });
  const save = useMutation({
    mutationFn: (job: Partial<SquadBotJob>) => job.id
      ? api.put(`/admin/squad-bots/${botId}/jobs/${job.id}`, job)
      : api.post(`/admin/squad-bots/${botId}/jobs`, job),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bot-jobs', botId] }); setEditing(null); },
  });
  const toggle = useMutation({
    mutationFn: (job: SquadBotJob) => api.patch(`/admin/squad-bots/${botId}/jobs/${job.id}`, { enabled: !job.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bot-jobs', botId] }),
  });
  const totals = outcomes.map(key => (report.data?.summary ?? []).reduce((sum, row) => sum + Number(row[key]), 0));
  return <section id="jobs" className="rounded-xl border border-divider bg-surface p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-base font-semibold text-foreground">Jobs & activity</h2><p className="mt-1 text-xs text-foreground-muted">Give this bot separate jobs and control where each one works.</p></div>
      <button className="rounded-lg bg-ink px-3 py-2 text-sm text-white" onClick={() => { save.reset(); setEditing('new'); }}>+ New job</button>
    </div>
    {paused && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">This bot is paused. Jobs keep their own on/off settings and resume when the bot resumes.</p>}
    <p className="mt-3 text-xs text-foreground-muted">The connected app runs these jobs and reports their results here.</p>
    {jobs.isPending ? <p className="py-5 text-sm text-foreground-muted">Loading jobs…</p> : jobs.isError ? <p role="alert" className="py-4 text-sm text-red-600">Could not load jobs. <button onClick={() => jobs.refetch()} className="underline">Retry</button></p> : !jobs.data?.length ? <div className="my-4 rounded-lg border border-dashed border-divider p-6 text-center"><p className="text-sm text-foreground">No jobs assigned yet</p><p className="mt-1 text-xs text-foreground-muted">Start with candidate replies, customer follow-ups, or a specific action.</p></div> :
      <div className="mt-4 divide-y divide-divider">{jobs.data.map(job => <div key={job.id} className="flex items-start justify-between gap-3 py-4">
        <div className="min-w-0"><button className="text-left text-sm font-semibold text-foreground hover:underline" onClick={() => { save.reset(); setEditing(job); }}>{job.name}</button>
          <p className="mt-1 text-xs text-foreground-muted">{job.kind === 'conversation' ? 'Conversation' : 'Action'} · {job.audience === 'any' ? 'Any audience' : job.audience}{job.pipeline_id && ` · Pipeline: ${job.pipeline_id}`}{job.stage_id && ` · Stage: ${job.stage_id}`}{!!job.person_ids.length && ` · ${job.person_ids.length} selected people`}</p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-foreground-muted">{job.instructions}</p>
          <button className="mt-2 text-xs text-foreground-muted underline" onClick={() => { setJobId(job.id); setPage(0); }}>View activity</button>
        </div>
        <button role="switch" aria-checked={job.enabled} aria-label={`${job.name} enabled`} disabled={toggle.isPending} onClick={() => toggle.mutate(job)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${job.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-canvas text-foreground-muted'}`}>{job.enabled ? 'On' : 'Off'}</button>
      </div>)}</div>}
    {toggle.isError && <p role="alert" className="text-sm text-red-600">{errorMessage(toggle.error, 'Could not change job')}</p>}
    {editing && <JobEditor key={editing === 'new' ? 'new' : editing.id} job={editing === 'new' ? null : editing} saving={save.isPending} error={save.isError ? errorMessage(save.error, 'Could not save job') : null} onSave={job => save.mutate(job)} onClose={() => setEditing(null)} />}
    <div className="mt-6 border-t border-divider pt-5">
      <h3 className="text-sm font-semibold text-foreground">Work summary</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="job-period">Summary period</label><select id="job-period" className={buttonClass} value={period} onChange={e => { setPeriod(e.target.value as typeof period); setPage(0); }}>{periods.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</select>
        <label className="sr-only" htmlFor="job-date">Date within period</label><input id="job-date" type="date" className={buttonClass} value={date} onChange={e => { setDate(e.target.value); setPage(0); }} />
        <label className="sr-only" htmlFor="job-filter">Filter by job</label><select id="job-filter" className={buttonClass} value={jobId} onChange={e => { setJobId(e.target.value); setPage(0); }}><option value="">All jobs</option>{jobs.data?.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</select>
        <button className={buttonClass} onClick={() => report.refetch()} disabled={!date || report.isFetching}>Refresh</button>
      </div>
      <p className="mt-2 text-xs text-foreground-dim">Calendar periods in UTC; weeks begin Monday. Choose a date to review an earlier period.</p>
      {!date ? <p className="mt-4 text-sm text-foreground-muted">Choose a date to see activity.</p> : report.isPending ? <p className="mt-4 text-sm text-foreground-muted">Loading activity…</p> : report.isError ? <p role="alert" className="mt-4 text-sm text-red-600">Could not load activity. Use Refresh to try again.</p> : <>
        <p className="mt-3 text-xs text-foreground-muted">{report.data?.start.slice(0, 10)} – {report.data && new Date(new Date(report.data.end).getTime() - 1).toISOString().slice(0, 10)}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{outcomes.map((key, i) => <div key={key} className="rounded-lg bg-canvas p-3"><p className="text-xl font-semibold text-foreground">{totals[i]}</p><p className="mt-1 text-xs capitalize text-foreground-muted">{key}</p></div>)}</div>
        <p className="mt-2 text-xs text-foreground-dim">Completed counts reported actions. AI calls and drafts do not count as completed work.</p>
        {!!report.data?.summary.length && !jobId && <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="py-2 text-foreground-muted">Job</th>{outcomes.map(o => <th key={o} className="px-2 capitalize text-foreground-muted">{o}</th>)}</tr></thead><tbody>{report.data.summary.map(row => <tr key={row.job_id} className="border-t border-divider"><td className="py-2 text-foreground">{jobs.data?.find(j => j.id === row.job_id)?.name ?? 'Job'}</td>{outcomes.map(o => <td key={o} className="px-2 text-foreground-muted">{row[o]}</td>)}</tr>)}</tbody></table></div>}
        <h3 className="mt-5 text-sm font-semibold text-foreground">Activity notes</h3>
        {!report.data?.activity.length ? <p className="py-4 text-sm text-foreground-muted">No activity reported for this period.</p> : <ul className="mt-2 divide-y divide-divider">{report.data.activity.map(a => <li key={a.id} className="py-3">
          <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-foreground">{a.job_name}</span><span className={`rounded-full px-2 py-0.5 text-xs capitalize ${a.outcome === 'failed' ? 'bg-red-50 text-red-700' : a.outcome === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-canvas text-foreground-muted'}`}>{a.outcome}</span><time className="text-xs text-foreground-dim">{new Date(a.created_at).toLocaleString()}</time></div>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground-muted">{a.note}</p>
          {a.target_url && <a href={a.target_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-medium text-foreground underline">Open where this happened ↗</a>}
        </li>)}</ul>}
        {!!report.data?.total && <div className="mt-3 flex items-center justify-between gap-2"><p className="text-xs text-foreground-muted">{page * 25 + 1}–{Math.min((page + 1) * 25, report.data.total)} of {report.data.total}</p><div className="flex gap-2"><button className={buttonClass} disabled={!page} onClick={() => setPage(p => p - 1)}>Previous</button><button className={buttonClass} disabled={(page + 1) * 25 >= report.data.total} onClick={() => setPage(p => p + 1)}>Next</button></div></div>}
      </>}
    </div>
  </section>;
}

function JobEditor({ job, saving, error, onSave, onClose }: { job: SquadBotJob | null; saving: boolean; error: string | null; onSave: (job: Partial<SquadBotJob>) => void; onClose: () => void }) {
  const [form, setForm] = useState({ name: job?.name ?? '', kind: job?.kind ?? 'conversation', instructions: job?.instructions ?? '', audience: job?.audience ?? 'any', pipeline_id: job?.pipeline_id ?? '', stage_id: job?.stage_id ?? '', enabled: job?.enabled ?? false });
  const [people, setPeople] = useState(job?.person_ids.join(', ') ?? '');
  const field = (label: string, key: 'name' | 'pipeline_id' | 'stage_id', placeholder: string) => <label className="block text-xs text-foreground-muted">{label}<input className={`${inputClass} mt-1`} placeholder={placeholder} value={form[key]} maxLength={key === 'name' ? 120 : 200} required={key === 'name'} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>;
  return <form className="mt-4 space-y-3 rounded-lg border border-divider bg-canvas p-4" onSubmit={e => { e.preventDefault(); onSave({ ...form, id: job?.id, name: form.name.trim(), person_ids: people.split(',').map(s => s.trim()).filter(Boolean), pipeline_id: form.pipeline_id.trim() || null, stage_id: form.stage_id.trim() || null }); }}>
    <h3 className="text-sm font-semibold text-foreground">{job ? 'Edit job' : 'New job'}</h3>
    {field('Job name', 'name', 'e.g. Reply to shortlisted candidates')}
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-foreground-muted">Job type<select className={`${inputClass} mt-1`} value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as typeof form.kind })}><option value="conversation">Chat / reply</option><option value="action">Take actions</option></select></label><label className="text-xs text-foreground-muted">Audience<select className={`${inputClass} mt-1`} value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value as typeof form.audience })}><option value="any">Any audience</option><option value="candidates">Candidates</option><option value="customers">Customers</option></select></label></div>
    <label className="block text-xs text-foreground-muted">Instructions<textarea rows={4} maxLength={20000} className={`${inputClass} mt-1`} value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })} placeholder="Describe who to contact, what to say or do, and when to hand over." /></label>
    <div className="grid gap-3 sm:grid-cols-2">{field('Pipeline ID (optional)', 'pipeline_id', 'All pipelines')}{field('Stage ID (optional)', 'stage_id', 'All stages')}</div>
    <label className="block text-xs text-foreground-muted">Specific people IDs (optional, comma separated)<input className={`${inputClass} mt-1`} value={people} onChange={e => setPeople(e.target.value)} placeholder="All people in the selected audience" /></label>
    <p className="text-xs text-foreground-dim">Use IDs from the connected app. All selected limits apply together; a stage requires a pipeline.</p>
    <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />Job on</label>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="flex justify-end gap-2"><button type="button" className={buttonClass} disabled={saving} onClick={onClose}>Cancel</button><button disabled={saving || !form.name.trim() || (!!form.stage_id.trim() && !form.pipeline_id.trim())} className="rounded-lg bg-ink px-4 py-2 text-sm text-white disabled:opacity-40">{saving ? 'Saving…' : 'Save job'}</button></div>
  </form>;
}
