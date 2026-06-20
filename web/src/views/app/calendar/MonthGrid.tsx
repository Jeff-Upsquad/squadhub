import { useMemo, useState } from 'react';
import type { Task } from '@squadhub/shared';
import { getTaskStatusCategory } from '@squadhub/shared';
import {
  DND_TASK_ID,
  buildMonthCells,
  cellKey,
  groupTasksByDay,
  priorityLevel,
  weekdayLabels,
} from './calendarUtils';

interface Props {
  monthAnchor: Date;          // any date in the displayed month
  todayKey: string;           // YYYY-MM-DD meaning "today"
  tasks: Task[];              // all candidate tasks (placed by work/due date)
  weekStartsOn: number;       // 0=Sun … 6=Sat
  onDropTask: (taskId: string, day: Date) => void;
  onOpenTask: (taskId: string) => void;
  onOpenDay: (day: Date) => void;
}

const MAX_CHIPS = 3;

function isDone(status?: string | null): boolean {
  if (!status) return false;
  if (status === 'done' || status === 'closed') return true;
  return getTaskStatusCategory(status) === 'closed';
}

export default function MonthGrid({ monthAnchor, todayKey, tasks, weekStartsOn, onDropTask, onOpenTask, onOpenDay }: Props) {
  const cells = useMemo(() => buildMonthCells(monthAnchor, weekStartsOn), [monthAnchor, weekStartsOn]);
  const labels = useMemo(() => weekdayLabels(weekStartsOn), [weekStartsOn]);
  const byDay = useMemo(() => groupTasksByDay(tasks), [tasks]);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const currentMonth = monthAnchor.getMonth();

  return (
    <div className="cal-month">
      <div className="cal-month-weekhead">
        {labels.map((w, i) => (
          <div key={i} className="cal-weekday">{w}</div>
        ))}
      </div>
      <div className="cal-month-grid">
        {cells.map((day) => {
          const key = cellKey(day);
          const items = byDay.get(key) ?? [];
          const inMonth = day.getMonth() === currentMonth;
          const isToday = key === todayKey;
          const overflow = items.length - MAX_CHIPS;
          return (
            <div
              key={key}
              className="cal-day"
              data-outside={!inMonth || undefined}
              data-today={isToday || undefined}
              data-past={(inMonth && key < todayKey) || undefined}
              data-dragover={dragOver === key || undefined}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(key); }}
              onDragLeave={() => setDragOver((c) => (c === key ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const taskId = e.dataTransfer.getData(DND_TASK_ID);
                if (taskId) onDropTask(taskId, day);
              }}
              onClick={() => onOpenDay(day)}
            >
              <div className="cal-day-num">
                <span>{day.getDate()}</span>
              </div>
              <div className="cal-day-chips">
                {items.slice(0, MAX_CHIPS).map(({ task, source }) => (
                  <div
                    key={task.id}
                    className="cal-chip"
                    draggable
                    data-level={priorityLevel(task.priority)}
                    data-due={source === 'due' || undefined}
                    data-done={isDone((task as Task & { status?: string | null }).status) || undefined}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      e.dataTransfer.setData(DND_TASK_ID, task.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={(e) => { e.stopPropagation(); onOpenTask(task.id); }}
                    title={`${task.title}${source === 'due' ? ' · due this day' : ''}`}
                  >
                    <span className="cal-chip-dot" />
                    <span className="cal-chip-title">{task.title}</span>
                  </div>
                ))}
                {overflow > 0 && (
                  <button
                    type="button"
                    className="cal-day-more"
                    onClick={(e) => { e.stopPropagation(); onOpenDay(day); }}
                  >
                    +{overflow} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
