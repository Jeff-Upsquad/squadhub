import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskDayPlan, TaskTimeEntry, TimerSession } from '@squadhub/shared';
import { attendanceActivities, clipActivity, combineTaskSegments, dayKey, dayPlanActivities, dayStart, isAttendance, layoutActivities, taskActivities, weekStart, type Activity } from '../activityModel';
const hour = 3600000;
const start = dayStart('2026-10-04');
function session(id: string, from: number, to: number | null, type: TimerSession['timer_type'] = 'work'): TimerSession {
  return { id, user_id: 'user', date: dayKey(from), timer_type: type, start_time: new Date(from).toISOString(), end_time: to === null ? null : new Date(to).toISOString(), duration_seconds: to === null ? null : (to - from) / 1000, is_auto_stopped: false, created_at: new Date(from).toISOString() };
}
function activity(id: string, from: number, to: number, seconds = (to - from) / 1000): Activity {
  return { id, kind: 'task', title: id, start: from, end: to, seconds };
}
test('IST days and Monday-based weeks do not depend on the machine timezone', () => {
  assert.equal(dayKey(Date.parse('2026-10-03T18:30:00Z')), '2026-10-04');
  assert.equal(weekStart('2026-10-04'), '2026-09-28');
});
test('breaks do not consume the work commitment and only excess work is overtime', () => {
  const events = attendanceActivities([
    session('morning', start + 9 * hour, start + 13 * hour),
    session('lunch', start + 13 * hour, start + 14 * hour, 'break'),
    session('afternoon', start + 14 * hour, start + 20 * hour),
  ], 9 * 3600, start + 21 * hour);
  assert.equal(events.filter(e => e.kind === 'work').reduce((s, e) => s + e.seconds, 0), 9 * 3600);
  assert.equal(events.find(e => e.kind === 'overtime')?.start, start + 19 * hour);
  assert.equal(events.find(e => e.kind === 'overtime')?.seconds, 3600);
  assert.equal(events.find(e => e.kind === 'break')?.seconds, 3600);
});
test('midnight sessions split and reset the commitment for each day', () => {
  const events = attendanceActivities([session('overnight', start + 22 * hour, start + 27 * hour)], 3600, start + 28 * hour);
  assert.deepEqual(events.map(e => [dayKey(e.start), e.kind, e.seconds]), [
    ['2026-10-04', 'work', 3600], ['2026-10-04', 'overtime', 3600],
    ['2026-10-05', 'work', 3600], ['2026-10-05', 'overtime', 7200],
  ]);
});
test('a running session ticks live and no commitment invents no overtime', () => {
  const events = attendanceActivities([session('live', start, null)], 0, start + hour);
  assert.equal(events.length, 1); assert.equal(events[0].live, true);
  assert.equal(events[0].seconds, 3600); assert.equal(events[0].kind, 'work');
});
test('range clipping preserves allocated task shares across midnight', () => {
  const event = activity('parallel', start + 23 * hour, start + 25 * hour, 3600);
  const first = clipActivity(event, start, start + 24 * hour)!;
  const second = clipActivity(event, start + 24 * hour, start + 48 * hour)!;
  assert.equal(first.seconds, 1800); assert.equal(second.seconds, 1800);
  assert.equal(clipActivity(event, start, start + 22 * hour), null);
});
test('concurrent sessions have independent columns and later sessions regain full width', () => {
  const events = layoutActivities([activity('a', 0, 100), activity('b', 10, 60), activity('c', 60, 90), activity('d', 100, 200)]);
  assert.deepEqual(events.map(e => [e.event.id, e.column, e.columns]), [['a', 0, 2], ['b', 1, 2], ['c', 1, 2], ['d', 0, 1]]);
});

test('short sequential entries reserve their visible footprint without changing credited time', () => {
  const events = [activity('a', 0, 60000), activity('b', 60000, 120000), activity('c', 120000, 180000)];
  const layout = layoutActivities(events, 27 * 60000);
  assert.deepEqual(layout.map(e => e.column), [0, 1, 2]);
  assert.deepEqual(layout.map(e => e.event.seconds), [60, 60, 60]);
});
test('contiguous split task timers combine into one continuous session with credited segments', () => {
  const segments = Array.from({ length: 55 }, (_, i) => {
    const taskIdx = Math.floor(i / 5);
    const segIdx = i % 5;
    return {
      ...activity(`split-${taskIdx}-${segIdx}`, start + segIdx * 60000, start + (segIdx + 1) * 60000, 30),
      taskId: `task-${taskIdx}`,
    };
  });
  const grouped = combineTaskSegments(segments);
  assert.equal(grouped.length, 11);
  assert.equal(grouped.reduce((sum, e) => sum + e.seconds, 0), 55 * 30);
  assert.equal(grouped.reduce((sum, e) => sum + (e.segments?.length || 1), 0), 55);
  assert.equal(combineTaskSegments(grouped).length, 11);
});
test('task sessions separated by a break remain distinct calendar entries so breaks appear', () => {
  const events = combineTaskSegments([
    { ...activity('first', start, start + 27 * 60000, 27 * 60), taskId: 'email-cleanup' },
    // 69m break between 12:27 AM and 1:36 AM
    { ...activity('second', start + 96 * 60000, start + 118 * 60000, 22 * 60), taskId: 'email-cleanup', live: true },
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0].start, start);
  assert.equal(events[0].end, start + 27 * 60000);
  assert.equal(events[0].seconds, 27 * 60);
  assert.equal(events[0].live, false);
  assert.equal(events[1].start, start + 96 * 60000);
  assert.equal(events[1].end, start + 118 * 60000);
  assert.equal(events[1].seconds, 22 * 60);
  assert.equal(events[1].live, true);
});
test('group clipping sums actual contiguous segments and excludes gaps outside bounds', () => {
  const grouped = combineTaskSegments([
    { ...activity('first', start + hour, start + 2 * hour, 1800), taskId: 'a' },
    { ...activity('second', start + 2 * hour, start + 3 * hour, 1200), taskId: 'a', live: true },
  ])[0];
  assert.equal(clipActivity(grouped, start + 3 * hour, start + 4 * hour), null);
  assert.equal(clipActivity(grouped, start + 1.5 * hour, start + 2.5 * hour)?.seconds, 1500);
  assert.equal(grouped.seconds, 3000);
  assert.equal(grouped.live, true);
});
test('tasks stay separate by identity and IST day; attendance and work-block runs stay separate', () => {
  const grouped = combineTaskSegments([
    { ...activity('overnight', start + 23 * hour, start + 25 * hour), taskId: 'a' },
    { ...activity('different', start + 23 * hour, start + 24 * hour), taskId: 'b', title: 'overnight' },
    { ...activity('work', start, start + hour), kind: 'work' },
    { ...activity('block-a', start, start + hour), taskId: 'block', kind: 'block' },
    { ...activity('block-b', start + hour, start + 2 * hour), taskId: 'block', kind: 'block' },
  ] as Activity[]);
  assert.equal(grouped.length, 6);
  assert.equal(grouped.filter(e => e.taskId === 'a').length, 2);
  assert.equal(grouped.filter(e => e.kind === 'block').length, 2);
});

test('eleven overlapping tasks remain eleven separate positioned cards with credited durations', () => {
  const tasks = Array.from({ length: 11 }, (_, i) => ({ ...activity(`task-${i}`, start + 20 * hour, start + 21 * hour, 300), taskId: `task-${i}` }));
  const layout = layoutActivities(combineTaskSegments(tasks), 27 * 60000);
  assert.equal(layout.length, 11);
  assert.deepEqual(layout.map(e => e.column), Array.from({ length: 11 }, (_, i) => i));
  assert.ok(layout.every(e => e.columns === 11 && e.event.seconds === 300));
  assert.ok(layout.every(e => e.event.start === start + 20 * hour && e.event.end === start + 21 * hour));
});

test('multiple breaks on the same task create distinct blocks and intermediate tasks do not overlap', () => {
  const events = combineTaskSegments([
    // Email cleanup: morning session 9:00 - 9:30
    { ...activity('ec-1', start + 9 * hour, start + 9.5 * hour, 1800), taskId: 'email-cleanup' },
    // Call kia during the break: 10:00 - 10:20
    { ...activity('call', start + 10 * hour, start + 10.33 * hour, 1200), taskId: 'call-kia' },
    // Email cleanup: afternoon session 11:00 - 11:45
    { ...activity('ec-2', start + 11 * hour, start + 11.75 * hour, 2700), taskId: 'email-cleanup' },
  ]);
  assert.equal(events.length, 3);
  const ecSessions = events.filter(e => e.taskId === 'email-cleanup');
  assert.equal(ecSessions.length, 2);
  assert.equal(ecSessions[0].start, start + 9 * hour);
  assert.equal(ecSessions[0].end, start + 9.5 * hour);
  assert.equal(ecSessions[1].start, start + 11 * hour);
  assert.equal(ecSessions[1].end, start + 11.75 * hour);

  const layout = layoutActivities(events);
  // Because the sessions don't overlap, all can sit in column 0!
  assert.ok(layout.every(l => l.column === 0 && l.columns === 1));
});

test('segments within 5s tolerance merge as contiguous while >5s gaps become separate sessions', () => {
  const events = combineTaskSegments([
    // Two segments within 3s of each other (e.g. parallel timer tick/sync)
    { ...activity('tick-1', start + hour, start + 1.25 * hour, 900), taskId: 't1' },
    { ...activity('tick-2', start + 1.25 * hour + 3000, start + 1.5 * hour, 900), taskId: 't1' },
    // A 10s pause/break
    { ...activity('after-break', start + 1.5 * hour + 10000, start + 2 * hour, 1800), taskId: 't1' },
  ]);
  assert.equal(events.length, 2);
  // First session merges tick-1 and tick-2
  assert.equal(events[0].start, start + hour);
  assert.equal(events[0].end, start + 1.5 * hour);
  assert.equal(events[0].seconds, 1800);
  assert.equal(events[0].segments?.length, 2);
  // Second session is after the 10s break
  assert.equal(events[1].start, start + 1.5 * hour + 10000);
  assert.equal(events[1].end, start + 2 * hour);
  assert.equal(events[1].seconds, 1800);
});

test('task activities flag manually logged entries with isManual', () => {
  const dummyTask = { id: 'task-1', title: 'Bedtime', list_id: 'list-1', time_tracked: 3600 };
  const entries: TaskTimeEntry[] = [
    {
      id: 'e1',
      task_id: 'task-1',
      user_id: 'u1',
      workspace_id: 'w1',
      started_at: new Date(start + hour).toISOString(),
      stopped_at: new Date(start + 2 * hour).toISOString(),
      duration_seconds: 3600,
      source: 'manual',
      created_at: new Date().toISOString(),
      task: dummyTask,
    },
    {
      id: 'e2',
      task_id: 'task-2',
      user_id: 'u1',
      workspace_id: 'w1',
      started_at: new Date(start + 2 * hour).toISOString(),
      stopped_at: new Date(start + 3 * hour).toISOString(),
      duration_seconds: 3600,
      source: 'timer',
      created_at: new Date().toISOString(),
      task: { id: 'task-2', title: 'Live work', list_id: 'list-1', time_tracked: 3600 },
    },
  ];

  const activities = taskActivities(entries);
  assert.equal(activities.length, 2);
  assert.equal(activities[0].isManual, true);
  assert.equal(activities[0].source, 'Manually logged');
  assert.equal(activities[1].isManual, false);
  assert.equal(activities[1].source, 'Task timer');
});

test('combineTaskSegments preserves isManual tag and does not merge manual entries with timer entries', () => {
  const manual = { ...activity('manual-entry', start + hour, start + 2 * hour, 3600), taskId: 'bedtime', isManual: true, source: 'Manually logged' };
  const timer = { ...activity('timer-entry', start + 2 * hour + 1000, start + 3 * hour, 3600), taskId: 'bedtime', isManual: false, source: 'Task timer' };

  const combined = combineTaskSegments([manual, timer]);
  assert.equal(combined.length, 2);
  assert.equal(combined[0].isManual, true);
  assert.equal(combined[0].source, 'Manually logged');
  assert.equal(combined[1].isManual, false);
  assert.equal(combined[1].source, 'Task timer');
});

test('dayPlanActivities maps day plans to day_plan activities with start, end, seconds, and task info', () => {
  const plans: TaskDayPlan[] = [
    {
      id: 'dp-1',
      task_id: 'task-100',
      user_id: 'u1',
      plan_date: '2026-10-04',
      start_minute: 600, // 10:00 AM
      duration_minutes: 45,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      task: { id: 'task-100', title: 'Prepare design spec', list_id: 'list-1', list: { id: 'list-1', name: 'Design / UX' }, priority: 'high', status_id: 's1', time_estimate: null },
    },
    {
      id: 'dp-2',
      task_id: 'task-200',
      user_id: 'u1',
      plan_date: '2026-10-04',
      start_minute: 0,
      duration_minutes: 1440, // all day sentinel
      all_day: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      virtual: true,
      task: { id: 'task-200', title: 'All day milestone task', list_id: 'list-2', priority: 'normal', status_id: 's2', time_estimate: null },
    },
    {
      id: 'dp-3',
      task_id: 'task-300',
      user_id: 'u1',
      plan_date: '2026-10-04',
      start_minute: 840, // 2:00 PM
      duration_minutes: 60,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      kind: 'group_block',
      container: { type: 'folder', id: 'f-1', name: 'Grouped tasks under QA' },
    },
  ];

  const activities = dayPlanActivities(plans);
  assert.equal(activities.length, 3);

  // Timed plan
  assert.equal(activities[0].id, 'plan:dp-1');
  assert.equal(activities[0].kind, 'day_plan');
  assert.equal(activities[0].title, 'Prepare design spec');
  assert.equal(activities[0].start, start + 10 * hour);
  assert.equal(activities[0].end, start + 10 * hour + 45 * 60000);
  assert.equal(activities[0].seconds, 45 * 60);
  assert.equal(activities[0].taskId, 'task-100');
  assert.equal(activities[0].project, 'Design / UX');
  assert.equal(activities[0].source, 'Day Planner');

  // All-day plan defaults to 9 AM with 30m duration and note
  assert.equal(activities[1].id, 'plan:dp-2');
  assert.equal(activities[1].kind, 'day_plan');
  assert.equal(activities[1].title, 'All day milestone task');
  assert.equal(activities[1].start, start + 9 * hour);
  assert.equal(activities[1].end, start + 9 * hour + 30 * 60000);
  assert.equal(activities[1].note, 'All day task');
  assert.equal(activities[1].source, 'Day Planner (scheduled)');

  // Group block
  assert.equal(activities[2].id, 'plan:dp-3');
  assert.equal(activities[2].kind, 'day_plan');
  assert.equal(activities[2].title, 'Grouped tasks under QA');
  assert.equal(activities[2].source, 'Day Planner group');
});

test('three sections partition divides attendance, day planner, and time tracker items', () => {
  const attendanceItem: Activity = { id: 'att-1', kind: 'work', title: 'Work session', start: start + 9 * hour, end: start + 12 * hour, seconds: 3 * 3600 };
  const breakItem: Activity = { id: 'att-2', kind: 'break', title: 'Lunch break', start: start + 12 * hour, end: start + 13 * hour, seconds: 3600 };
  const dayPlanItem: Activity = { id: 'dp-1', kind: 'day_plan', title: 'Scheduled review', start: start + 10 * hour, end: start + 11 * hour, seconds: 3600 };
  const taskItem: Activity = { id: 'task-1', kind: 'task', title: 'Logged coding', start: start + 9.5 * hour, end: start + 11.5 * hour, seconds: 2 * 3600 };
  const blockItem: Activity = { id: 'blk-1', kind: 'block', title: 'Sprint block', start: start + 14 * hour, end: start + 16 * hour, seconds: 2 * 3600 };

  const allItems = [attendanceItem, breakItem, dayPlanItem, taskItem, blockItem];

  const lane0 = allItems.filter(e => isAttendance(e.kind));
  const lane1 = allItems.filter(e => e.kind === 'day_plan');
  const lane2 = allItems.filter(e => !isAttendance(e.kind) && e.kind !== 'day_plan');

  assert.deepEqual(lane0.map(e => e.id), ['att-1', 'att-2']);
  assert.deepEqual(lane1.map(e => e.id), ['dp-1']);
  assert.deepEqual(lane2.map(e => e.id), ['task-1', 'blk-1']);
});


