import { useMemo } from 'react';
import type { Task } from '@squadhub/shared';
import { useMyTasksSummary } from './useMyTasksSummary';
import { useUpdateTask } from './useTasks';
import { usePMStore } from '../stores/pmStore';
import { useLearningStore } from '../stores/learningStore';
import { formatWhen } from '../views/app/pm/taskHelpers';
import { isFutureDay, isTaskFocused } from '../lib/taskGrouping';
import api from '../services/api';

// One normalized row for a Home "disappearing card". Every card maps its tasks
// into this shape so SecondaryCardRow / SecondaryCardPanel stay source-agnostic.
export interface SecondaryCardItem {
  id: string;
  title: string;
  whenText: string;       // "Today" / "Overdue · Jun 12" / "" when undated
  overdue: boolean;
  kind: string;
  task: Task;             // raw task, so the panel can group by space/list/etc.
  open?: () => void;      // row click (opens the task)
  toggleDone?: () => void;// inline "complete" affordance
}

export interface SecondaryCardData {
  items: SecondaryCardItem[];
  isLoading: boolean;
}

export interface SecondaryCardsResult {
  urgent: SecondaryCardData;
  recordings: SecondaryCardData;
  meetings: SecondaryCardData;
  calls: SecondaryCardData;
  // Resource "send as task" cards — driven by the mirror task's source_kind,
  // which is set from the source Resources item's (kind, track). See migration
  // 166 + server/services/lmsTaskSends.ts (sourceKindForItem).
  courses: SecondaryCardData;
  sops: SecondaryCardData;
  posts: SecondaryCardData;
}

// Label names (case-insensitive, singular or plural) per label-driven card.
const RECORDING_LABELS = ['recording', 'recordings'];
const MEETING_LABELS = ['meeting', 'meetings'];
const CALL_LABELS = ['call', 'calls'];

function taskHasLabel(t: Task, names: string[]): boolean {
  return (t.tags ?? []).some((tag) => names.includes((tag.name || '').trim().toLowerCase()));
}

// True when any of the task's dates (due / work / start) is today or in the past
// (overdue) in the given tz. A null date never qualifies; a future date doesn't.
function hasDateTodayOrOverdue(t: Task, tz: string): boolean {
  return [t.due_date, t.work_date, t.start_date].some((d) => !!d && !isFutureDay(d, tz));
}

// All of the four Home "disappearing cards", derived from a single
// /pm/tasks/my fetch. Each card resolves to already-filtered items + loading.
export function useSecondaryCards(): SecondaryCardsResult {
  const { data, isLoading } = useMyTasksSummary();
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const setActiveSecondaryCard = usePMStore((s) => s.setActiveSecondaryCard);
  const updateTask = useUpdateTask(null);
  const setLearningTarget = useLearningStore((s) => s.setLearningTarget);
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  return useMemo<SecondaryCardsResult>(() => {
    const empty: SecondaryCardData = { items: [], isLoading };
    if (!data) return {
      urgent: empty, recordings: empty, meetings: empty, calls: empty,
      courses: empty, sops: empty, posts: empty,
    };

    // Union every bucket (these cards are lenses over ALL my tasks, not the
    // starred focus list), deduped by id.
    const merged = [
      ...data.overdue, ...data.today, ...data.tomorrow,
      ...data.upcoming, ...data.later, ...(data.focused ?? []),
    ];
    const seen = new Set<string>();
    const all = merged.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));

    const toItem = (t: Task, kind: string): SecondaryCardItem => {
      const when = formatWhen(t.due_date || t.work_date || t.start_date);
      return {
        id: t.id,
        title: t.title,
        whenText: when.text,
        overdue: when.state === 'overdue',
        kind,
        task: t,
        open: async () => {
          if (t.source_kind === 'course' || t.source_kind === 'sop' || t.source_kind === 'post') {
            try {
              const res = await api.get(`/lms/task-target?task_id=${t.id}`);
              const target = res.data.data as { item_id: string; lesson_id: string | null; section_anchor: string | null };
              if (target?.item_id) {
                setLearningTarget({ itemId: target.item_id, lessonId: target.lesson_id, sectionAnchor: target.section_anchor });
                setActiveSecondaryCard(null);
                window.dispatchEvent(new CustomEvent('squadhub:open-resource'));
                return;
              }
            } catch { /* fall through to normal task open */ }
          }
          setActiveSecondaryCard(null);
          setActiveTask(t.id);
        },
        toggleDone: () => updateTask.mutate({ id: t.id, status: 'done' }),
      };
    };

    // Urgent: every urgent-priority task regardless of dates — except one whose
    // work_date is in the future, which is held back until that day arrives.
    const urgent = all
      .filter((t) => t.priority === 'urgent' && !isFutureDay(t.work_date, tz))
      .map((t) => toItem(t, 'urgent'));

    // Label cards: carry the label AND are starred OR have a today/overdue date.
    // Like Urgent, a task whose work_date is in the future is held back until
    // that day arrives — even when starred.
    const labelCard = (names: string[], kind: string) =>
      all
        .filter((t) =>
          taskHasLabel(t, names) &&
          !isFutureDay(t.work_date, tz) &&
          (isTaskFocused(t) || hasDateTodayOrOverdue(t, tz)),
        )
        .map((t) => toItem(t, kind));

    // Resource cards: every incorporated resource task of that source_kind,
    // regardless of date (like Urgent), except one whose work_date is still in
    // the future. `all` already excludes done tasks (my-tasks include_done=false).
    const sourceCard = (kind: string) =>
      all
        .filter((t) => t.source_kind === kind && !isFutureDay(t.work_date, tz))
        .map((t) => toItem(t, kind));

    return {
      urgent: { items: urgent, isLoading },
      recordings: { items: labelCard(RECORDING_LABELS, 'recordings'), isLoading },
      meetings: { items: labelCard(MEETING_LABELS, 'meetings'), isLoading },
      calls: { items: labelCard(CALL_LABELS, 'calls'), isLoading },
      courses: { items: sourceCard('course'), isLoading },
      sops: { items: sourceCard('sop'), isLoading },
      posts: { items: sourceCard('post'), isLoading },
    };
  }, [data, isLoading, tz, setActiveTask, setActiveSecondaryCard, updateTask, setLearningTarget]);
}
