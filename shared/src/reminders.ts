import { parse } from 'chrono-node';

export const REMINDER_TYPE_KEY = 'reminders';
export const hasReminderIntent = (title: string) => /\bremind\s+me\b/i.test(title);

// Normalize spaced, slash, and hyphen time separators before Chrono parses them.
// Require a meridiem so ordinary pairs of numbers are not treated as times.
const normalizeReminderTime = (text: string) => text.replace(
  /\b(0?[1-9]|1[0-2])(?:[ \t]*[/-][ \t]*|[ \t]+)([0-5]\d)(?=[ \t]*[ap]\.?m\.?\b)/gi,
  '$1:$2',
);

/** Parse only reminder commands: ordinary task titles keep their date words. */
export function parseReminderTitle(title: string, now = new Date(), timezoneOffset = -now.getTimezoneOffset(), force = false) {
  const intent = hasReminderIntent(title) || force;
  if (!intent) return { intent, title, dueDate: null as string | null, source: '', hasTime: false };
  const command = /\bremind\s+me\b\s*(?:to\s+)?/i.exec(title);
  // In "Friday report Remind Me tomorrow at 5pm", Friday belongs to the
  // task name. Only the command's suffix is a schedule in that form.
  let prefix = command ? title.slice(0, command.index) : '';
  let withoutCommand = normalizeReminderTime(command ? title.slice(command.index + command[0].length) : title);
  const reference = { instant: now, timezone: timezoneOffset };
  let results = parse(withoutCommand, reference, { forwardDate: true });
  if (results.length === 0 && prefix.trim()) {
    const combined = normalizeReminderTime(`${prefix} ${withoutCommand}`);
    const fallback = parse(combined, reference, { forwardDate: true });
    if (fallback.length === 1 && fallback[0].start.isCertain('hour') && !fallback[0].end) {
      withoutCommand = combined;
      prefix = '';
      results = fallback;
    }
  }
  const result = results.length === 1 && !results[0].end ? results[0] : null;
  const hasTime = !!result?.start.isCertain('hour');
  const cleaned = result
    ? withoutCommand.slice(0, result.index) + ' ' + withoutCommand.slice(result.index + result.text.length)
    : withoutCommand;
  return {
    intent,
    title: `${prefix} ${cleaned}`.replace(/\s+/g, ' ').replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '').trim(),
    dueDate: result && hasTime ? result.start.date().toISOString() : null,
    source: title.trim(),
    hasTime,
  };
}

export function reminderDescription(description: string | null | undefined, source: string, dueDate: string) {
  const note = `Reminder: ${source}\nReminder time: ${dueDate}`;
  return [description?.trim(), note].filter(Boolean).join('\n\n');
}
