import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TaskTimeEntry, TimerSession } from '@squadhub/shared';
import api from '../../services/api';
import { useActiveWorkBlockRun } from '../../hooks/useWorkBlocks';
import { usePMStore } from '../../stores/pmStore';
import { useTimeStats } from '../../hooks/useTimer';
import TimeActivityCalendar from './TimeActivityCalendar';
import { attendanceActivities, taskActivities } from './activityModel';

export default function TimeActivityPanel({ workspaceId, context, onClose }: { workspaceId: string; context: string; onClose: () => void }) {
  return <TimeActivityCalendar onClose={onClose} renderData={(from, to, now) => <CalendarData workspaceId={workspaceId} context={context} from={from} to={to} now={now} onClose={onClose} />} />;
}

function CalendarData({ workspaceId, context, from, to, now, onClose }: { onClose: () => void; workspaceId: string; context: string; from: number; to: number; now: number }) {
  const scope = { workspaceId, context };
  const stats = useTimeStats(scope);
  const params = { workspace_id: workspaceId, context, from: new Date(from).toISOString(), to: new Date(to).toISOString() };
  const sessions = useQuery<TimerSession[]>({
    queryKey: ['timer-sessions', workspaceId, context, from, to],
    queryFn: async () => (await api.get('/timer/sessions', { params })).data.data,
    refetchInterval: 30000,
  });
  const entries = useQuery<TaskTimeEntry[]>({
    queryKey: ['task-time-entries', 'calendar', workspaceId, from, to],
    queryFn: async () => (await api.get('/pm/tasks/my-time-entries', { params })).data.data,
    refetchInterval: 30000,
  });
  const activeBlock = useActiveWorkBlockRun();
  const timers = usePMStore(s => s.timers);
  const segmentStart = usePMStore(s => s.timerSegmentStart);
  const commitment = stats.data?.data?.office_timing?.office_hours_total_seconds || 0;
  const events = useMemo(() => {
    const all = [...attendanceActivities(sessions.data || [], commitment, now), ...taskActivities(entries.data || [])];
    for (const timer of timers) {
      const start = segmentStart ?? timer.startedAt;
      all.push({ id: `live:${timer.taskId}`, kind: 'task', title: timer.taskTitle, start, end: now,
        seconds: Math.max(0, (now - start) / 1000 / timers.length), live: true, taskId: timer.taskId, source: 'Running task timer' });
    }
    const block = activeBlock.data;
    if (block && !block.run.ended_at) all.push({ id: `block:${block.run.id}`, kind: 'block', title: block.task.title,
      start: Date.parse(block.run.started_at), end: now, seconds: Math.max(0, (now - Date.parse(block.run.started_at)) / 1000), live: true, taskId: block.task.id, source: 'Running work block' });
    return all;
  }, [sessions.data, entries.data, commitment, now, timers, segmentStart, activeBlock.data]);
  return <TimeActivityCalendar.Data events={events} commitment={commitment}
    onOpenTask={id => { usePMStore.getState().setActiveTask(id); onClose(); }}
    loading={sessions.isPending || entries.isPending || stats.isPending || activeBlock.isPending}
    error={sessions.isError || entries.isError || stats.isError || activeBlock.isError}
    onRetry={() => { void sessions.refetch(); void entries.refetch(); void stats.refetch(); void activeBlock.refetch(); }} />;
}
