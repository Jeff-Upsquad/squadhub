import { hasReminderIntent, parseReminderTitle, reminderDescription, REMINDER_TYPE_KEY } from '@squadhub/shared';
import { supabaseAdmin } from '../supabase';

export class ReminderValidationError extends Error {
  constructor(message: string, public suggestedDate: string | null = null, public code = 'REMINDER_SCHEDULE_REQUIRED') { super(message); }
}

type Draft = { title?: string; description?: string | null; due_date?: string | null; task_type_id?: string | null };

/** Authoritative normalization for every client, including quick-add and mobile. */
export async function prepareTaskReminder(body: Draft, previous?: Draft, timezoneOffset = 330) {
  const command = hasReminderIntent(body.title || '');
  const typeId = body.task_type_id !== undefined ? body.task_type_id : previous?.task_type_id;
  let reminderTypeId: string | undefined;
  if (command || typeId) {
    const { data, error } = await supabaseAdmin.from('task_types').select('id').eq('key', REMINDER_TYPE_KEY).maybeSingle();
    if (error) throw error;
    reminderTypeId = data?.id;
  }
  if (!command && (!reminderTypeId || typeId !== reminderTypeId)) return;
  if (!reminderTypeId) throw new Error('Reminders task type is not installed');
  const parsed = body.title ? parseReminderTitle(body.title, new Date(), timezoneOffset, true) : null;
  const due = body.due_date !== undefined ? body.due_date : parsed?.dueDate || previous?.due_date;
  // An unrelated edit on an overdue reminder remains valid; only a new schedule must be future-dated.
  const scheduleChanged = !previous || command || body.due_date !== undefined || body.task_type_id !== undefined;
  if (!due || !/T\d{2}:\d{2}/.test(due) || !Number.isFinite(Date.parse(due)) || (scheduleChanged && Date.parse(due) <= Date.now())) {
    throw new ReminderValidationError('Choose a future date and time for this reminder.', parsed?.dueDate || null);
  }
  if (parsed && !parsed.title) throw new ReminderValidationError('Add what you want to be reminded about.', due, 'REMINDER_TITLE_REQUIRED');
  body.task_type_id = reminderTypeId;
  body.due_date = new Date(due).toISOString();
  if (parsed && (command || parsed.title !== body.title?.trim())) {
    body.title = parsed.title;
    body.description = reminderDescription(body.description ?? previous?.description, parsed.source, body.due_date);
  }
}
