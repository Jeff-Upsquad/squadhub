import { describe, it, expect } from 'vitest';
import {
  committedHoursForRange,
  dailyTargetForDate,
  istMonthBounds,
  istWeekBounds,
  type FolderPlanTimeline,
} from '../utils/folderCommittedHoursMath';

// Mid-month upgrade 1h/day → 2h/day, effective 2026-07-16 (old term ends 07-15).
// Working days = Mon–Fri.
const timeline: FolderPlanTimeline = {
  hasCard: true,
  workingDays: new Set([1, 2, 3, 4, 5]),
  segments: [
    { start: '2026-07-01', end: '2026-07-15', daily: 1, weekly: 5 },
    { start: '2026-07-16', end: null, daily: 2, weekly: 10 },
  ],
};

describe('period-aware committed hours', () => {
  it('blends a mid-month 1h→2h upgrade across working days', () => {
    // Jul 2026 has 23 working days; 11 fall on/before the 15th (×1h), 12 on/after
    // the 16th (×2h) → 11 + 24 = 35h. Between pure-1h (23) and pure-2h (46).
    expect(committedHoursForRange(timeline, '2026-07-01', '2026-07-31')).toBe(35);
  });

  it('resolves each day from the covering plan, 0 on weekends', () => {
    expect(dailyTargetForDate(timeline, '2026-07-15')).toBe(1); // last pre-change weekday
    expect(dailyTargetForDate(timeline, '2026-07-16')).toBe(2); // change day → new plan
    expect(dailyTargetForDate(timeline, '2026-07-04')).toBe(0); // Saturday
    expect(dailyTargetForDate(timeline, '2026-06-30')).toBe(0); // before any segment
  });

  it('computes IST month/week bounds', () => {
    expect(istMonthBounds('2026-07-03')).toEqual({ start: '2026-07-01', end: '2026-07-31' });
    // Fri 2026-07-03 sits in the Mon 06-29 → Sun 07-05 week.
    expect(istWeekBounds('2026-07-03')).toEqual({ start: '2026-06-29', end: '2026-07-05' });
  });
});
