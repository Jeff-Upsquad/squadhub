import { useMemo } from 'react';
import { useMyTasksSummary } from './useMyTasksSummary';
import { useUpdateTask } from './useTasks';
import { useDueCourses } from './useLms';
import { useMyMeetings, useMarkMeetingDone } from './useMeetings';
import { usePMStore } from '../stores/pmStore';
import { formatWhen } from '../views/app/pm/taskHelpers';

// One normalized row for a secondary "type" card. Every card source maps its
// records into this shape, so SecondaryCardRow and SecondaryCardPanel stay
// source-agnostic. Each `useItems` hook is responsible for applying the
// governing rule (NOT completed AND due today/overdue) before returning items.
export type SecondaryCardKind = 'routine' | 'course' | 'meeting';

export interface SecondaryCardItem {
  id: string;
  title: string;
  whenText: string;       // "Today" / "Overdue · Jun 12" / "Today · 3:00 PM"
  overdue: boolean;
  kind: SecondaryCardKind;
  open?: () => void;      // row click (e.g. open the task)
  toggleDone?: () => void;// optional inline "complete" affordance
}

export interface SecondaryCardData {
  items: SecondaryCardItem[];
  isLoading: boolean;
}

// Routines: recurring-task INSTANCES (recurring_parent_id set) the user has
// due today or overdue. Done tasks are already excluded server-side
// (include_done=false) and only the today/overdue buckets are read, so the
// rule holds without extra filtering here.
export function useRoutineCardItems(): SecondaryCardData {
  const { data, isLoading } = useMyTasksSummary();
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const setActiveSecondaryCard = usePMStore((s) => s.setActiveSecondaryCard);
  const updateTask = useUpdateTask(null);

  const items = useMemo<SecondaryCardItem[]>(() => {
    if (!data) return [];
    const out: SecondaryCardItem[] = [];
    const seen = new Set<string>();
    const buckets: Array<[typeof data.overdue, boolean]> = [
      [data.overdue, true],
      [data.today, false],
    ];
    for (const [bucket, overdue] of buckets) {
      for (const t of bucket) {
        if (!t.recurring_parent_id) continue;
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        const when = formatWhen(t.due_date || t.work_date || t.start_date);
        out.push({
          id: t.id,
          title: t.title,
          whenText: when.text || (overdue ? 'Overdue' : 'Today'),
          overdue,
          kind: 'routine',
          open: () => { setActiveSecondaryCard(null); setActiveTask(t.id); },
          toggleDone: () => updateTask.mutate({ id: t.id, status: 'done' }),
        });
      }
    }
    return out;
  }, [data, setActiveTask, setActiveSecondaryCard, updateTask]);

  return { items, isLoading };
}

// Courses: non-completed LMS assignments due today/overdue. Completion is
// lesson-driven, so these rows are display-only (no inline toggle).
export function useCourseCardItems(): SecondaryCardData {
  const { data, isLoading } = useDueCourses();

  const items = useMemo<SecondaryCardItem[]>(() => {
    if (!data) return [];
    return data.map((a) => {
      const when = formatWhen(a.due_date);
      return {
        id: a.id,
        title: a.item?.title || 'Course',
        whenText: when.text,
        overdue: when.state === 'overdue',
        kind: 'course' as const,
      };
    });
  }, [data]);

  return { items, isLoading };
}

// Meetings: scheduled meetings due today/overdue. Marking done removes the row.
export function useMeetingCardItems(): SecondaryCardData {
  const { data, isLoading } = useMyMeetings();
  const markDone = useMarkMeetingDone();

  const items = useMemo<SecondaryCardItem[]>(() => {
    if (!data) return [];
    return data.map((m) => {
      const when = formatWhen(m.scheduled_at);
      return {
        id: m.id,
        title: m.title,
        whenText: when.text,
        overdue: when.state === 'overdue',
        kind: 'meeting' as const,
        toggleDone: () => markDone.mutate(m.id),
      };
    });
  }, [data, markDone]);

  return { items, isLoading };
}
