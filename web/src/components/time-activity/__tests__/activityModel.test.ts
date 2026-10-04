import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TimerSession } from '@squadhub/shared';
import { attendanceActivities, clipActivity, dayKey, dayStart, layoutActivities, layoutActivityGroups, weekStart, type Activity } from '../activityModel';
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
test('dense bursts collapse into a selectable group and isolated entries retain full width', () => {
  const burst = Array.from({ length: 30 }, (_, i) => activity(`burst-${i}`, i * 60000, (i + 1) * 60000));
  const later = activity('later', 60 * 60000, 120 * 60000);
  const groups = layoutActivityGroups([...burst, later], 27 * 60000, 3);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].events, burst);
  assert.equal(groups[0].start, 0);
  assert.equal(groups[0].end, 30 * 60000);
  assert.equal(groups[0].columns, 1);
  assert.deepEqual(groups[1].events, [later]);
  assert.equal(groups[1].columns, 1);
});
test('ordinary overlaps stay separate, with grouping adapting to narrow lanes', () => {
  const events = [activity('a', 0, hour), activity('b', 0, hour)];
  const wide = layoutActivityGroups(events, 27 * 60000, 3);
  assert.equal(wide.length, 2);
  assert.deepEqual(wide.map(e => e.column), [0, 1]);
  const narrow = layoutActivityGroups(events, 27 * 60000, 1);
  assert.equal(narrow.length, 1);
  assert.equal(narrow[0].events.length, 2);
});
