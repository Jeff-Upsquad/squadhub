import { describe, expect, it } from 'vitest';
import { validateWorkRange } from '../utils/taskWorkRange';

describe('task work ranges', () => {
  it('keeps old tasks and independently cleared boundaries valid', () => {
    expect(() => validateWorkRange('2026-10-02', undefined)).not.toThrow();
    expect(() => validateWorkRange(null, '2026-10-03')).not.toThrow();
    expect(() => validateWorkRange(null, null)).not.toThrow();
  });
  it('allows equal days and compares timestamps by their actual instant', () => {
    expect(() => validateWorkRange('2026-10-02', '2026-10-02')).not.toThrow();
    expect(() => validateWorkRange('2026-10-02T10:00:00+05:30', '2026-10-02T05:00:00Z')).not.toThrow();
  });
  it('rejects an end before the start, including times on the same day', () => {
    expect(() => validateWorkRange('2026-10-03', '2026-10-02')).toThrow('Work end date must be on or after work start date');
    expect(() => validateWorkRange('2026-10-02T11:00:00Z', '2026-10-02T10:00:00Z')).toThrow();
  });
  it('rejects malformed metadata instead of storing an unusable date', () => {
    expect(() => validateWorkRange(null, 'invalid')).toThrow('Choose a valid work end date');
    expect(() => validateWorkRange(null, 123)).toThrow();
  });
});
