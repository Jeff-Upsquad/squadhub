import { describe, it, expect, vi } from 'vitest';

// utils/ist (the IST_OFFSET_MS source) drags in the supabase client, which
// needs env config at import time — stub it out for this pure-math suite.
vi.mock('../supabase', () => ({ supabaseAdmin: {}, supabaseAuth: {}, supabase: {} }));

import { resolveSalesPeriod } from '../utils/salesPeriod';

describe('resolveSalesPeriod', () => {
  it('resolves a Mon–Sun IST week from a mid-week anchor', () => {
    const p = resolveSalesPeriod('week', '2026-07-08'); // Wednesday
    expect(p.anchor).toBe('2026-07-06'); // its Monday
    expect(p.start_ist).toBe('2026-07-06');
    expect(p.end_ist).toBe('2026-07-12'); // Sunday, inclusive
    // IST midnights expressed as UTC instants (−05:30), end exclusive.
    expect(p.start_utc).toBe('2026-07-05T18:30:00.000Z');
    expect(p.end_utc).toBe('2026-07-12T18:30:00.000Z');
    expect(p.label).toBe('Jul 6 – 12, 2026');
  });

  it('normalizes any date to its Monday, including Sunday and Monday itself', () => {
    expect(resolveSalesPeriod('week', '2026-07-12').anchor).toBe('2026-07-06'); // Sunday
    expect(resolveSalesPeriod('week', '2026-07-06').anchor).toBe('2026-07-06'); // Monday
    // Cross-month week keeps a two-month label.
    expect(resolveSalesPeriod('week', '2026-07-01').label).toBe('Jun 29 – Jul 5, 2026');
  });

  it('keeps Sunday 23:30 IST inside the week (half-open UTC boundary)', () => {
    // Sun 2026-07-12 23:30 IST = 2026-07-12T18:00:00Z.
    const instant = new Date('2026-07-12T18:00:00Z');
    const p = resolveSalesPeriod('week', undefined, undefined, undefined, instant);
    expect(p.anchor).toBe('2026-07-06');
    expect(instant.getTime()).toBeGreaterThanOrEqual(Date.parse(p.start_utc));
    expect(instant.getTime()).toBeLessThan(Date.parse(p.end_utc));
  });

  it('rolls Monday 00:10 IST into the NEXT week', () => {
    // Mon 2026-07-13 00:10 IST = 2026-07-12T18:40:00Z — 40 min after the
    // previous week's exclusive end.
    const instant = new Date('2026-07-12T18:40:00Z');
    const p = resolveSalesPeriod('week', undefined, undefined, undefined, instant);
    expect(p.anchor).toBe('2026-07-13');
    expect(p.start_utc).toBe('2026-07-12T18:30:00.000Z');
    expect(instant.getTime()).toBeGreaterThanOrEqual(Date.parse(p.start_utc));
  });

  it('resolves an IST calendar month with IST-midnight UTC bounds', () => {
    const p = resolveSalesPeriod('month', '2026-07');
    expect(p.anchor).toBe('2026-07');
    expect(p.label).toBe('July 2026');
    expect(p.start_ist).toBe('2026-07-01');
    expect(p.end_ist).toBe('2026-07-31');
    expect(p.start_utc).toBe('2026-06-30T18:30:00.000Z');
    expect(p.end_utc).toBe('2026-07-31T18:30:00.000Z');
  });

  it('defaults the month by the IST calendar, not UTC', () => {
    // 2026-07-31 23:30 IST = 2026-07-31T18:00:00Z → still July in IST.
    const late = resolveSalesPeriod('month', undefined, undefined, undefined, new Date('2026-07-31T18:00:00Z'));
    expect(late.anchor).toBe('2026-07');
    // 2026-08-01 00:10 IST = 2026-07-31T18:40:00Z → August in IST.
    const next = resolveSalesPeriod('month', undefined, undefined, undefined, new Date('2026-07-31T18:40:00Z'));
    expect(next.anchor).toBe('2026-08');
  });

  it('custom range includes both ends (exclusive bound is end + 1 day)', () => {
    const p = resolveSalesPeriod('custom', undefined, '2026-07-01', '2026-07-09');
    expect(p.anchor).toBe('2026-07-01..2026-07-09');
    expect(p.start_ist).toBe('2026-07-01');
    expect(p.end_ist).toBe('2026-07-09');
    expect(p.start_utc).toBe('2026-06-30T18:30:00.000Z');
    expect(p.end_utc).toBe('2026-07-09T18:30:00.000Z'); // IST midnight of Jul 10
  });

  it('rejects an invalid custom range', () => {
    expect(() => resolveSalesPeriod('custom', undefined, '2026-07-01', undefined)).toThrow();
    expect(() => resolveSalesPeriod('custom', undefined, undefined, '2026-07-09')).toThrow();
    expect(() => resolveSalesPeriod('custom', undefined, '2026-07-10', '2026-07-01')).toThrow();
  });
});
