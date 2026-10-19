import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasReminderIntent, parseReminderTitle } from '@squadhub/shared';

vi.mock('../supabase', () => ({ supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'reminder-type' }, error: null }) }) }) }) } }));
import { prepareTaskReminder, ReminderValidationError } from '../services/taskReminders';

const now = new Date('2026-10-19T03:30:00Z'); // Monday, 9am IST
describe('reminder title parsing', () => {
  it.each([
    ['Call Jeff Remind Me tomorrow at 5pm', 'Call Jeff', '2026-10-20T11:30:00.000Z'],
    ['Remind me to send the proposal in 30 minutes', 'send the proposal', '2026-10-19T04:00:00.000Z'],
    ['Send invoice remind me on Friday at 10am', 'Send invoice', '2026-10-23T04:30:00.000Z'],
    ['Remind Me to call Alex on 25 October 2026 at 14:00', 'call Alex', '2026-10-25T08:30:00.000Z'],
    ['Review Remind Me at 5pm UTC', 'Review', '2026-10-19T17:00:00.000Z'],
  ])('cleans %s and extracts its date/time', (input, title, due) => {
    const result = parseReminderTitle(input, now, 330);
    expect(result.title).toBe(title); expect(result.dueDate).toBe(due);
  });
  it('keeps ordinary task titles unchanged', () => {
    expect(parseReminderTitle('Friday release at 5pm', now, 330)).toMatchObject({ intent: false, title: 'Friday release at 5pm', dueDate: null });
    expect(hasReminderIntent('Build reminder features')).toBe(false);
  });
  it('requires an explicit time rather than silently choosing noon', () => {
    expect(parseReminderTitle('Call Sam Remind Me tomorrow', now, 330).dueDate).toBeNull();
    expect(parseReminderTitle('Call Sam Remind Me', now, 330).dueDate).toBeNull();
  });
  it('does not guess between multiple times or a date range', () => {
    expect(parseReminderTitle('Call Remind Me tomorrow at 5pm and Friday at 9am', now, 330).dueDate).toBeNull();
    expect(parseReminderTitle('Call Remind Me from 3pm to 5pm', now, 330).dueDate).toBeNull();
  });
  it('uses the caller timezone even when it is still yesterday there', () => {
    expect(parseReminderTitle('Call Remind Me tomorrow at 10am', new Date('2026-10-19T02:00:00Z'), -420).dueDate).toBe('2026-10-19T17:00:00.000Z');
  });
});

describe('authoritative reminder task normalization', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());
  it('sets type and due date, cleans the title, and preserves the existing description', async () => {
    const draft: any = { title: 'Call Jeff Remind Me tomorrow at 5pm', description: 'Discuss proposal' };
    await prepareTaskReminder(draft, undefined, 330);
    expect(draft).toMatchObject({ title: 'Call Jeff', task_type_id: 'reminder-type', due_date: '2026-10-20T11:30:00.000Z' });
    expect(draft.description).toContain('Discuss proposal'); expect(draft.description).toContain('Call Jeff Remind Me tomorrow at 5pm');
  });
  it('requires a schedule for a manually selected reminder type', async () => {
    await expect(prepareTaskReminder({ title: 'Call Jeff', task_type_id: 'reminder-type' })).rejects.toBeInstanceOf(ReminderValidationError);
  });
  it('parses dates when the type is selected manually', async () => {
    const draft: any = { title: 'Call Jeff tomorrow at 5pm', task_type_id: 'reminder-type' };
    await prepareTaskReminder(draft, undefined, 330);
    expect(draft.title).toBe('Call Jeff'); expect(draft.due_date).toBe('2026-10-20T11:30:00.000Z');
  });
  it('honors a date explicitly selected in the picker', async () => {
    const draft: any = { title: 'Call Jeff Remind Me tomorrow at 5pm', due_date: '2026-10-21T10:00:00Z' };
    await prepareTaskReminder(draft);
    expect(draft.due_date).toBe('2026-10-21T10:00:00.000Z'); expect(draft.title).toBe('Call Jeff');
  });
  it('rejects past, invalid, and date-only schedules', async () => {
    for (const due_date of ['2020-01-01T10:00:00Z', 'not a date', '2026-10-20']) {
      await expect(prepareTaskReminder({ title: 'Call', task_type_id: 'reminder-type', due_date })).rejects.toBeInstanceOf(ReminderValidationError);
    }
  });
  it('allows unrelated edits to an already due reminder', async () => {
    await expect(prepareTaskReminder({ description: 'New details' }, { task_type_id: 'reminder-type', due_date: '2026-10-18T10:00:00Z' })).resolves.toBeUndefined();
  });
  it('keeps ordinary task titles and dates unchanged', async () => {
    const draft = { title: 'Friday 5pm release', due_date: '2026-10-23' };
    await prepareTaskReminder(draft); expect(draft).toEqual({ title: 'Friday 5pm release', due_date: '2026-10-23' });
  });
});
