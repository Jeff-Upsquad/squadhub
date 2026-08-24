'use client';

/**
 * Phone My Tasks — the Partner app's TasksScreen.kt, not the desktop personal
 * list. Assigned work across the workspace, bucketed Overdue / Today /
 * Tomorrow / Upcoming / Later, with All · Today · Overdue chips.
 */

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Task } from '@squadhub/shared';
import { useMyTasksSummary, type MyTasksBuckets } from '../hooks/useMyTasksSummary';
import { useUpdateTask } from '../hooks/useTasks';
import { usePMStore } from '../stores/pmStore';
import { MAvatar, MEmpty, MLoading } from './MobileKit';

type Filter = 'all' | 'today' | 'overdue';

function totalOpen(b: MyTasksBuckets) {
  return b.overdue.length + b.today.length + b.tomorrow.length + b.upcoming.length + b.later.length;
}

function sectionsFor(b: MyTasksBuckets, filter: Filter): { key: string; label: string; overdue?: boolean; rows: Task[] }[] {
  const all = [
    { key: 'overdue', label: 'Overdue', overdue: true, rows: b.overdue },
    { key: 'today', label: 'Today', rows: b.today },
    { key: 'tomorrow', label: 'Tomorrow', rows: b.tomorrow },
    { key: 'upcoming', label: 'Upcoming', rows: b.upcoming },
    { key: 'later', label: 'Later', rows: b.later },
  ];
  const scoped = filter === 'today' ? all.filter((s) => s.key === 'today')
    : filter === 'overdue' ? all.filter((s) => s.key === 'overdue')
    : all;
  return scoped.filter((s) => s.rows.length > 0);
}

function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function isDone(task: Task) {
  const s = (task as { status?: string }).status;
  return s === 'done' || s === 'closed';
}

export default function MobileMyTasks() {
  const { data: buckets, isLoading, isError, refetch } = useMyTasksSummary();
  const [filter, setFilter] = useState<Filter>('all');
  const sections = useMemo(
    () => (buckets ? sectionsFor(buckets, filter) : []),
    [buckets, filter],
  );
  const openCount = buckets ? totalOpen(buckets) : null;

  return (
    <div className="mmt">
      <div className="mtk-phone-head">
        <h1>My Tasks</h1>
        <p>{openCount == null ? 'Your work' : `${openCount} open · your work`}</p>
      </div>

      <div className="lv-scope-row">
        <button type="button" className="lv-scope-chip" data-on={filter === 'all' || undefined} onClick={() => setFilter('all')}>
          All{openCount != null && openCount > 0 && <span className="n">{openCount}</span>}
        </button>
        <button type="button" className="lv-scope-chip" data-on={filter === 'today' || undefined} onClick={() => setFilter('today')}>
          Today
        </button>
        <button
          type="button"
          className="lv-scope-chip"
          data-on={filter === 'overdue' || undefined}
          data-overdue={(buckets?.overdue.length ?? 0) > 0 ? '' : undefined}
          onClick={() => setFilter('overdue')}
        >
          Overdue
          {(buckets?.overdue.length ?? 0) > 0 && <span className="n">{buckets!.overdue.length}</span>}
        </button>
      </div>

      <div className="mmt-scroll">
        {isLoading && <MLoading />}
        {isError && (
          <MEmpty title="Couldn't load" body="Pull to try again, or tap retry." />
        )}
        {isError && (
          <p className="msh-hint">
            <button type="button" className="lv-scope-chip" onClick={() => refetch()}>Retry</button>
          </p>
        )}
        {!isLoading && !isError && sections.length === 0 && (
          <MEmpty
            title={filter === 'overdue' ? "You're all caught up." : filter === 'today' ? 'Nothing scheduled for today.' : 'No open tasks.'}
            body="Work assigned to you lands here."
          />
        )}
        {sections.map((s) => (
          <div key={s.key}>
            <div className="mmt-sec-head" data-overdue={s.overdue ? '' : undefined}>
              <b>{s.label}</b>
              <span>{s.rows.length}</span>
            </div>
            <div className="mmt-card" data-overdue={s.overdue ? '' : undefined}>
              {s.rows.map((t) => (
                <MobileTaskRow key={t.id} task={t} overdue={!!s.overdue} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileTaskRow({ task, overdue }: { task: Task; overdue: boolean }) {
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const updateTask = useUpdateTask(null);
  const qc = useQueryClient();
  const done = isDone(task);
  const assignee = task.assignees?.[0];
  const due = shortDate(task.due_date);
  const pri = task.priority === 'emergency' || task.priority === 'urgent' || task.priority === 'high'
    ? task.priority
    : null;

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateTask.mutate(
      { id: task.id, status: done ? 'todo' : 'done' } as never,
      { onSettled: () => { void qc.invalidateQueries({ queryKey: ['my-tasks-summary'] }); } },
    );
  };

  return (
    <div className="mmt-row" data-done={done || undefined} onClick={() => setActiveTask(task.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTask(task.id); } }}>
      <button
        type="button"
        className="mmt-check"
        data-done={done || undefined}
        data-p={pri || undefined}
        onClick={toggle}
        aria-label={done ? 'Mark incomplete' : 'Mark complete'}
      />
      <span className="mmt-row-body">
        <b>{task.title}</b>
      </span>
      {assignee && (
        <MAvatar name={assignee.display_name || assignee.email} url={assignee.avatar_url} size={22} />
      )}
      {due && (
        <span className="mmt-date" data-overdue={overdue ? '' : undefined}>{due}</span>
      )}
      {pri && <span className="mmt-flag" data-p={pri} aria-hidden />}
    </div>
  );
}
