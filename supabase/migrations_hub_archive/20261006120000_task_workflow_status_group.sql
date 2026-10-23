-- ============================================================
-- Task Workflow status group: makes the generic-task status set
-- (OPEN, FOCUS NOW, EMERGENCY, … — previously hardcoded as
-- TASK_STATUS_CATALOG in shared/src/index.ts) manageable from
-- admin > Status Groups.
--
-- tasks.status keeps storing the stable KEY (e.g. 'open'); labels,
-- colors, descriptions, sections and order now come from this group.
-- The static catalog remains as a fallback for older clients.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE status_group_statuses
  ADD COLUMN IF NOT EXISTS key TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS section TEXT,
  ADD COLUMN IF NOT EXISTS section_label TEXT,
  ADD COLUMN IF NOT EXISTS section_emoji TEXT;

-- Keys are stable identifiers (stored on tasks); unique per group.
-- NULL keys (regular space statuses) are exempt by Postgres NULL semantics.
DROP INDEX IF EXISTS idx_sgs_group_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sgs_group_key
  ON status_group_statuses(group_id, key);

-- ------------------------------------------------------------
-- Seed the Task Workflow group (mirrors TASK_STATUS_CATALOG 1:1)
-- ------------------------------------------------------------

INSERT INTO status_groups (key, name, description, icon, color, position, is_default, is_system, is_enabled)
VALUES
  ('task_workflow', 'Task Workflow', 'Statuses for generic tasks (OPEN, FOCUS NOW, EMERGENCY, …). Keys are stable — tasks store the key, so renaming a key breaks existing tasks.', 'zap', '#e11d48', 2, FALSE, TRUE, TRUE)
ON CONFLICT (key) DO NOTHING;

INSERT INTO status_group_statuses (group_id, key, name, description, color, position, is_default, category, section, section_label, section_emoji)
SELECT g.id, v.key, v.name, v.description, v.color, v.position, v.is_default, v.category, v.section, v.section_label, v.section_emoji
FROM (VALUES
  ('open', 'OPEN', 'Newly created task, not yet triaged or planned.', '#9ca3af', 0, TRUE, 'todo', 'not_started', 'Not Started', '📥'),
  ('empty', 'EMPTY', 'Placeholder task with no details filled in yet.', '#d1d5db', 1, FALSE, 'todo', 'not_started', 'Not Started', '📥'),
  ('scheduled', 'SCHEDULED', 'Has a specific date/time set.', '#60a5fa', 2, FALSE, 'active', 'scheduled_queued', 'Scheduled / Queued', '📅'),
  ('reminder', 'REMINDER', 'A nudge to do or check something later.', '#93c5fd', 3, FALSE, 'active', 'scheduled_queued', 'Scheduled / Queued', '📅'),
  ('back_burner', 'BACK BURNER', 'Low priority; get to it eventually.', '#a8a29e', 4, FALSE, 'active', 'scheduled_queued', 'Scheduled / Queued', '📅'),
  ('up_next', 'UP NEXT', 'Next in line after current work wraps up.', '#38bdf8', 5, FALSE, 'active', 'scheduled_queued', 'Scheduled / Queued', '📅'),
  ('this_week', 'THIS WEEK', 'To be handled sometime this week.', '#22d3ee', 6, FALSE, 'active', 'scheduled_queued', 'Scheduled / Queued', '📅'),
  ('tomorrow', 'TOMORROW', 'Planned for the next day.', '#06b6d4', 7, FALSE, 'active', 'scheduled_queued', 'Scheduled / Queued', '📅'),
  ('front_burner', 'FRONT BURNER', 'Moving up the queue; becoming relevant soon.', '#f59e0b', 8, FALSE, 'active', 'scheduled_queued', 'Scheduled / Queued', '📅'),
  ('today', 'TODAY', 'Must be addressed today.', '#f97316', 9, FALSE, 'active', 'scheduled_queued', 'Scheduled / Queued', '📅'),
  ('focus_now', 'FOCUS NOW', 'Requires your undivided attention right now.', '#e11d48', 10, FALSE, 'active', 'priority_urgency', 'Priority & Urgency', '⚡'),
  ('emergency', 'EMERGENCY', 'Critical; drop everything.', '#b91c1c', 11, FALSE, 'active', 'priority_urgency', 'Priority & Urgency', '⚡'),
  ('urgent', 'URGENT', 'Needs immediate action.', '#ef4444', 12, FALSE, 'active', 'priority_urgency', 'Priority & Urgency', '⚡'),
  ('over_due', 'OVER DUE', 'Deadline has already passed.', '#dc2626', 13, FALSE, 'active', 'priority_urgency', 'Priority & Urgency', '⚡'),
  ('high_priority', 'HIGH PRIORITY', 'Very important; needs attention soon.', '#f97316', 14, FALSE, 'active', 'priority_urgency', 'Priority & Urgency', '⚡'),
  ('priority', 'PRIORITY', 'Important; above normal.', '#fb923c', 15, FALSE, 'active', 'priority_urgency', 'Priority & Urgency', '⚡'),
  ('active', 'ACTIVE', 'Currently being worked on.', '#22c55e', 16, FALSE, 'active', 'in_motion', 'In Motion', '🏃'),
  ('in_progress', 'IN PROGRESS', 'Work has started and is ongoing.', '#16a34a', 17, FALSE, 'active', 'in_motion', 'In Motion', '🏃'),
  ('time_tracked', 'TIME TRACKED', 'Timer is running / hours being logged against it.', '#0d9488', 18, FALSE, 'active', 'in_motion', 'In Motion', '🏃'),
  ('active_daily', 'ACTIVE DAILY', 'Touched every day until resolved.', '#14b8a6', 19, FALSE, 'active', 'in_motion', 'In Motion', '🏃'),
  ('routines', 'ROUTINES', 'Regular recurring task.', '#a855f7', 20, FALSE, 'active', 'routines', 'Routines', '🔁'),
  ('imp_routines', 'IMP ROUTINES', 'Important recurring task that cannot be missed.', '#7c3aed', 21, FALSE, 'active', 'routines', 'Routines', '🔁'),
  ('on_hold', 'ON HOLD', 'Intentionally paused for now.', '#78716c', 22, FALSE, 'active', 'blocked_paused', 'Blocked / Paused', '⏸️'),
  ('waiting_on_dependency', 'WAITING ON – DEPENDANCY', 'Blocked until something/someone else moves.', '#6b7280', 23, FALSE, 'active', 'blocked_paused', 'Blocked / Paused', '⏸️'),
  ('follow_ups', 'FOLLOW UPS', 'Awaiting a reply; check back periodically.', '#4b5563', 24, FALSE, 'active', 'blocked_paused', 'Blocked / Paused', '⏸️'),
  ('help', 'HELP', 'Stuck; needs input or assistance from someone.', '#a16207', 25, FALSE, 'active', 'blocked_paused', 'Blocked / Paused', '⏸️'),
  ('unblocked', 'UNBLOCKED', 'Was blocked, now free to resume.', '#84cc16', 26, FALSE, 'active', 'blocked_paused', 'Blocked / Paused', '⏸️'),
  ('closed', 'CLOSED', 'Completed and archived.', '#10b981', 27, FALSE, 'closed', 'done', 'Closed', '✅'),
  ('cancelled', 'CANCELLED', 'No longer needed; closed without completing.', '#6b7280', 28, FALSE, 'closed', 'done', 'Closed', '✅')
) AS v(key, name, description, color, position, is_default, category, section, section_label, section_emoji)
JOIN status_groups g ON g.key = 'task_workflow'
ON CONFLICT (group_id, key) DO NOTHING;

-- New columns inherit the table's server-only grants (grants are
-- table-level); nothing further required.
