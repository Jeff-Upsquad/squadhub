import { parse } from 'chrono-node';

export const REMINDER_TYPE_KEY = 'reminders';
export const hasReminderIntent = (title: string) => /\bremind\s+me\b/i.test(title);

/** Parse only reminder commands: ordinary task titles keep their date words. */
export function parseReminderTitle(title: string, now = new Date(), timezoneOffset = -now.getTimezoneOffset(), force = false) {
  const intent = hasReminderIntent(title) || force;
  if (!intent) return { intent, title, dueDate: null as string | null, source: '', hasTime: false };
  const withoutCommand = title.replace(/\bremind\s+me\b\s*(?:to\s+)?/i, ' ');
  const results = parse(withoutCommand, { instant: now, timezone: timezoneOffset }, { forwardDate: true });
  const result = results.length === 1 && !results[0].end ? results[0] : null;
  const hasTime = !!result?.start.isCertain('hour');
  const cleaned = result
    ? withoutCommand.slice(0, result.index) + ' ' + withoutCommand.slice(result.index + result.text.length)
    : withoutCommand;
  return {
    intent,
    title: cleaned.replace(/\s+/g, ' ').replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '').trim(),
    dueDate: result && hasTime ? result.start.date().toISOString() : null,
    source: title.trim(),
    hasTime,
  };
}

export function reminderDescription(description: string | null | undefined, source: string, dueDate: string) {
  const note = `Reminder: ${source}\nReminder time: ${dueDate}`;
  return [description?.trim(), note].filter(Boolean).join('\n\n');
}
