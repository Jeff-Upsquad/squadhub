import { useEffect, useRef, useState } from 'react';
import type { Task } from '@squadhub/shared';
import { usePMStore, focusBucketForMinute } from '../../../stores/pmStore';
import { useAuthStore } from '../../../stores/authStore';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { usePersonalList } from '../../../hooks/useTasks';
import { useScheduleTaskOnDay } from '../../../hooks/useDayPlanner';
import { slotToWorkDateISO } from '../calendar/calendarUtils';
import TaskCreatePanel from '../pm/TaskCreatePanel';

// Click-and-drag on an empty stretch of a calendar column to create a task
// there: the dragged span becomes the task's estimate, its start becomes the
// work date + time, and the task lands on the calendar once it's saved.

export type SlotSelection = { date: string; start: number; dur: number };

const SNAP = 15;
const CLICK_DURATION = 30; // a plain click (no drag) creates a 30-minute slot
const DRAG_THRESHOLD_PX = 4;

const floorSnap = (m: number) => Math.floor(m / SNAP) * SNAP;
const ceilSnap = (m: number) => Math.ceil(m / SNAP) * SNAP;

export function useSlotDragCreate(pxPerMin = 1) {
  // `live` tracks an in-progress drag; `pending` is the finished selection
  // while the create panel is open. Either one renders the ghost block.
  const [live, setLive] = useState<SlotSelection | null>(null);
  const [pending, setPending] = useState<SlotSelection | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  // `topEl` is the element whose top edge is 12:00am for this column.
  const begin = (date: string, e: React.MouseEvent, topEl: HTMLElement | null) => {
    if (e.button !== 0 || !topEl || pending) return;
    e.preventDefault(); // no text selection while dragging
    const minuteAt = (clientY: number) =>
      Math.max(0, Math.min(1440, (clientY - topEl.getBoundingClientRect().top) / pxPerMin));
    const originY = e.clientY;
    const anchor = Math.min(1440 - SNAP, floorSnap(minuteAt(e.clientY)));
    let moved = false;
    let sel: SlotSelection = { date, start: anchor, dur: SNAP };
    setLive(sel);

    const onMove = (ev: MouseEvent) => {
      if (!moved && Math.abs(ev.clientY - originY) < DRAG_THRESHOLD_PX) return;
      moved = true;
      const m = minuteAt(ev.clientY);
      // Dragging down extends the end; dragging up moves the start earlier.
      const start = m >= anchor ? anchor : floorSnap(m);
      const end = m >= anchor ? Math.max(anchor + SNAP, ceilSnap(m)) : anchor + SNAP;
      sel = { date, start, dur: Math.min(1440, end) - start };
      setLive(sel);
    };
    const onUp = () => {
      cleanup();
      setLive(null);
      setPending(moved ? sel : { date, start: anchor, dur: Math.min(CLICK_DURATION, 1440 - anchor) });
    };
    const cleanup = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return { selection: live ?? pending, pending, begin, clear: () => setPending(null) };
}

// The create panel for a selected slot. Defaults to the user's private
// "My Tasks" list, assigned to them, with the slot's work date + estimate.
export function SlotCreatePanel({ slot, today, onClose }: { slot: SlotSelection; today: string; onClose: () => void }) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const me = useAuthStore((s) => s.user);
  const { data: personal, isLoading } = usePersonalList();
  const schedule = useScheduleTaskOnDay();
  const setFocusBucket = usePMStore((s) => s.setFocusBucket);

  // Wait for My Tasks so the list picker opens already set to it.
  if (isLoading) return null;

  const onCreated = (task: Task) => {
    // Put the new task on the calendar exactly where it was drawn.
    schedule.mutate({ task_id: task.id, plan_date: slot.date, start_minute: slot.start, duration_minutes: slot.dur });
    if (slot.date === today) setFocusBucket(task.id, focusBucketForMinute(slot.start));
  };

  return (
    <TaskCreatePanel
      pickable
      workspaceId={workspaceId}
      initialSpaceId={personal?.space?.id ?? null}
      initialListId={personal?.list?.id ?? null}
      initialDraft={{
        title: '',
        description: '',
        status: 'todo',
        priority: 'none',
        assignee_ids: me?.id ? [me.id] : [],
        work_date: slotToWorkDateISO(slot.date, slot.start),
        start_date: null,
        due_date: null,
        task_type_id: null,
        time_estimate: slot.dur,
        subtasks: [],
        checklists: [],
      }}
      onCreated={onCreated}
      onClose={onClose}
    />
  );
}
