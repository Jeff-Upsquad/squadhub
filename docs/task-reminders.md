# Task reminders

`reminders` is a task type, independent of the Scheduled status. Every reminder
has a future due timestamp at creation. The creator and current assignees receive
an inbox alert when it becomes due, with Open, Snooze, and Complete actions.

## Creation

Typing `Send proposal Remind Me tomorrow at 5pm` selects Reminders. The saved
title is `Send proposal`; the original instruction and resolved timestamp go in
the description, and the due field stores the UTC instant. The date picker shows
the device's local time. Natural-language parsing supports relative dates,
weekdays, explicit calendar dates, times, and explicit timezone abbreviations.
Date-only or ambiguous commands require the user to choose a date and time.
An ordinary task without reminder intent retains its date words.

The authenticated native preview endpoint is `POST /pm/reminders/preview` with
`title`, `force`, and `timezone_offset` (minutes east of UTC). Web and companion
share the same parser locally. API creation and edits also normalize and validate
reminders, including clients that don't implement title parsing themselves.
A missing schedule returns 422 with `REMINDER_SCHEDULE_REQUIRED`; web creation
surfaces a date/time dialog and retries only after the user selects a time.

## Delivery and actions

A five-second server sweep calls `deliver_due_task_reminders`. Task row locks,
SKIP LOCKED, and a unique `(task_id, user_id, due_at)` delivery record make inbox
insertion atomic and deduplicate overlapping sweeps/restarts. Overdue reminders
catch up after an outage. Completed/cancelled tasks, deleted lists, and routine
templates are excluded. Dated routine instances remain eligible.

Inbox rows flow through the existing socket, Web Push, native FCM, and companion
notification delivery. Polling recovers unread alerts missed while disconnected.
The bridge pages by timestamp and id so batches sharing one timestamp are not
truncated at the 50-row page boundary.

`POST /pm/tasks/:id/reminder-action` takes `notification_id`, `action`
(`snooze` or `complete`), and optional `minutes` (5, 10, 15, 30, 60, or 1440).
The API requires an alert addressed to the caller, current member access, an
unlocked list, and the alert's current task/due timestamp. Completion respects
subtasks and checklists. Conditional updates reject stale simultaneous actions.
Snooze moves the task's due date forward. Rescheduling, completing, or changing
the task type retires the previous alert; read events synchronize devices.

## Release and verification

Apply `20261019100000_task_reminders.sql` before deploying the server. CMPD ships
the server/web and merges companion source; it does not publish a companion
binary. Native Internal Android changes live in `squadhub-internal-native` and
also require their separate app release before installed phones receive the new
UI and system notification actions. Existing native builds can receive the
standard task notification through their configured FCM registration.

Regression coverage: `taskReminders.test.ts` and `reminderActions.test.ts` cover
natural language, title/description persistence, required/future timestamps,
permissions, stale actions, snoozing, and completion gates. The migration was
also exercised in an isolated PostgreSQL-compatible database for recipient and
schedule dedupe, catch-up, snooze rearming, completion exclusions, idempotence,
and service-role-only privileges.
