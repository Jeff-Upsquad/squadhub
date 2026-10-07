-- ============================================================
-- 20261007040000_coding_workflow_and_task_sections.sql
-- 1. Creates dedicated "Coding Workflow" status group (key: 'coding_workflow')
--    with 34 engineering lifecycle statuses organized into 8 sections:
--    ⚡ Priority & Urgency, 🏃 In Motion, 🎯 Up Next, 📅 Scheduled / Queued,
--    🔁 Routines, ⏸️ Blocked / Paused, 📥 Not Started, ✅ Closed.
-- 2. Adds new statuses (planning, ready_to_code, in_code_review,
--    testing_qa, ready_for_deploy, blocked) and updates section order
--    in 'task_workflow' group.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Create or update the Coding Workflow group
-- ------------------------------------------------------------
INSERT INTO status_groups (key, name, description, icon, color, position, is_default, is_system, is_enabled)
VALUES
  ('coding_workflow', 'Coding Workflow', 'Software development lifecycle: Urgency, In Motion, Up Next, Queued, Routines, Blocked, Not Started, Closed.', 'code', '#0ea5e9', 3, FALSE, TRUE, TRUE)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  color = EXCLUDED.color,
  position = EXCLUDED.position,
  is_enabled = EXCLUDED.is_enabled;

-- ------------------------------------------------------------
-- 2. Populate Coding Workflow statuses
-- ------------------------------------------------------------
INSERT INTO status_group_statuses (group_id, key, name, description, color, position, is_default, is_system, category, section, section_label, section_emoji)
SELECT g.id, v.key, v.name, v.description, v.color, v.position, v.is_default, v.is_system, v.category, v.section, v.section_label, v.section_emoji
FROM (VALUES
  -- ⚡ Priority & Urgency
  ('focus_now', 'FOCUS NOW', 'Requires your undivided attention right now.', '#e11d48', 0, FALSE, FALSE, 'active', 'priority_urgency', 'Priority & Urgency', '⚡'),
  ('emergency', 'EMERGENCY', 'Critical; drop everything.', '#b91c1c', 1, FALSE, FALSE, 'active', 'priority_urgency', 'Priority & Urgency', '⚡'),
  ('urgent', 'URGENT', 'Needs immediate action.', '#ef4444', 2, FALSE, FALSE, 'active', 'priority_urgency', 'Priority & Urgency', '⚡'),
  ('over_due', 'OVER DUE', 'Deadline has already passed.', '#dc2626', 3, FALSE, FALSE, 'active', 'priority_urgency', 'Priority & Urgency', '⚡'),
  ('high_priority', 'HIGH PRIORITY', 'Very important; needs attention soon.', '#f97316', 4, FALSE, FALSE, 'active', 'priority_urgency', 'Priority & Urgency', '⚡'),
  ('priority', 'PRIORITY', 'Important; above normal.', '#fb923c', 5, FALSE, FALSE, 'active', 'priority_urgency', 'Priority & Urgency', '⚡'),

  -- 🏃 In Motion
  ('active', 'ACTIVE', 'Currently being worked on.', '#22c55e', 6, FALSE, FALSE, 'active', 'in_motion', 'In Motion', '🏃'),
  ('in_progress', 'IN PROGRESS', 'Work has started and is ongoing.', '#16a34a', 7, FALSE, FALSE, 'active', 'in_motion', 'In Motion', '🏃'),
  ('in_code_review', 'IN CODE REVIEW', 'PR submitted; awaiting review and approval.', '#8b5cf6', 8, FALSE, FALSE, 'active', 'in_motion', 'In Motion', '🏃'),
  ('testing_qa', 'TESTING / QA', 'Under validation on staging / test environment.', '#eab308', 9, FALSE, FALSE, 'active', 'in_motion', 'In Motion', '🏃'),
  ('ready_for_deploy', 'READY FOR DEPLOY', 'Approved and ready for production release.', '#0d9488', 10, FALSE, FALSE, 'active', 'in_motion', 'In Motion', '🏃'),
  ('time_tracked', 'TIME TRACKED', 'Timer is running / hours being logged against it.', '#0d9488', 11, FALSE, FALSE, 'active', 'in_motion', 'In Motion', '🏃'),
  ('active_daily', 'ACTIVE DAILY', 'Touched every day until resolved.', '#14b8a6', 12, FALSE, FALSE, 'active', 'in_motion', 'In Motion', '🏃'),

  -- 🎯 Up Next
  ('planning', 'PLANNING', 'Architecture, RFC, spike, or scoping phase.', '#a855f7', 13, FALSE, FALSE, 'todo', 'up_next', 'Up Next', '🎯'),
  ('ready_to_code', 'READY TO CODE', 'Groomed, estimated, and ready to start coding.', '#22c55e', 14, FALSE, FALSE, 'todo', 'up_next', 'Up Next', '🎯'),

  -- 📅 Scheduled / Queued
  ('front_burner', 'FRONT BURNER', 'Moving up the queue; active sprint priority.', '#f59e0b', 15, FALSE, FALSE, 'active', 'scheduled_queued', 'Scheduled / Queued', '📅'),
  ('scheduled', 'SCHEDULED', 'Has a specific date/time set.', '#60a5fa', 16, FALSE, FALSE, 'active', 'scheduled_queued', 'Scheduled / Queued', '📅'),
  ('today', 'TODAY', 'Must be addressed today.', '#f97316', 17, FALSE, FALSE, 'active', 'scheduled_queued', 'Scheduled / Queued', '📅'),
  ('tomorrow', 'TOMORROW', 'Planned for the next day.', '#06b6d4', 18, FALSE, FALSE, 'active', 'scheduled_queued', 'Scheduled / Queued', '📅'),
  ('this_week', 'THIS WEEK', 'To be handled sometime this week.', '#22d3ee', 19, FALSE, FALSE, 'active', 'scheduled_queued', 'Scheduled / Queued', '📅'),
  ('back_burner', 'BACK BURNER', 'Low priority; get to it eventually.', '#a8a29e', 20, FALSE, FALSE, 'active', 'scheduled_queued', 'Scheduled / Queued', '📅'),
  ('reminder', 'REMINDER', 'A nudge to do or check something later.', '#93c5fd', 21, FALSE, TRUE, 'active', 'scheduled_queued', 'Scheduled / Queued', '📅'),

  -- 🔁 Routines
  ('routines', 'ROUTINES', 'Regular recurring task.', '#a855f7', 22, FALSE, FALSE, 'active', 'routines', 'Routines', '🔁'),
  ('imp_routines', 'IMP ROUTINES', 'Important recurring task that cannot be missed.', '#7c3aed', 23, FALSE, FALSE, 'active', 'routines', 'Routines', '🔁'),

  -- ⏸️ Blocked / Paused
  ('waiting_on_dependency', 'WAITING ON – DEPENDENCY', 'Blocked until something/someone else moves.', '#6b7280', 24, FALSE, TRUE, 'active', 'blocked_paused', 'Blocked / Paused', '⏸️'),
  ('blocked', 'BLOCKED', 'Halted by build failure, environment issue, or critical bug.', '#ef4444', 25, FALSE, FALSE, 'active', 'blocked_paused', 'Blocked / Paused', '⏸️'),
  ('on_hold', 'ON HOLD', 'Intentionally paused for now.', '#78716c', 26, FALSE, FALSE, 'active', 'blocked_paused', 'Blocked / Paused', '⏸️'),
  ('follow_ups', 'FOLLOW UPS', 'Awaiting a reply; check back periodically.', '#4b5563', 27, FALSE, FALSE, 'active', 'blocked_paused', 'Blocked / Paused', '⏸️'),
  ('help', 'HELP', 'Stuck; needs input or assistance from someone.', '#a16207', 28, FALSE, FALSE, 'active', 'blocked_paused', 'Blocked / Paused', '⏸️'),
  ('unblocked', 'UNBLOCKED', 'Was blocked, now free to resume.', '#84cc16', 29, FALSE, TRUE, 'active', 'blocked_paused', 'Blocked / Paused', '⏸️'),

  -- 📥 Not Started
  ('open', 'OPEN', 'Newly created task, not yet triaged or planned.', '#9ca3af', 30, TRUE, FALSE, 'todo', 'not_started', 'Not Started', '📥'),
  ('empty', 'EMPTY', 'Placeholder task with no details filled in yet.', '#d1d5db', 31, FALSE, FALSE, 'todo', 'not_started', 'Not Started', '📥'),

  -- ✅ Closed
  ('closed', 'CLOSED', 'Completed and archived.', '#10b981', 32, FALSE, TRUE, 'closed', 'done', 'Closed', '✅'),
  ('cancelled', 'CANCELLED', 'No longer needed; closed without completing.', '#6b7280', 33, FALSE, TRUE, 'closed', 'done', 'Closed', '✅')
) AS v(key, name, description, color, position, is_default, is_system, category, section, section_label, section_emoji)
JOIN status_groups g ON g.key = 'coding_workflow'
ON CONFLICT (group_id, key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  color = EXCLUDED.color,
  position = EXCLUDED.position,
  is_default = EXCLUDED.is_default,
  is_system = EXCLUDED.is_system,
  category = EXCLUDED.category,
  section = EXCLUDED.section,
  section_label = EXCLUDED.section_label,
  section_emoji = EXCLUDED.section_emoji;

-- ------------------------------------------------------------
-- 3. Also sync new statuses and section ordering to Task Workflow
-- ------------------------------------------------------------
INSERT INTO status_group_statuses (group_id, key, name, description, color, position, is_default, is_system, category, section, section_label, section_emoji)
SELECT g.id, v.key, v.name, v.description, v.color, v.position, v.is_default, v.is_system, v.category, v.section, v.section_label, v.section_emoji
FROM (VALUES
  ('in_code_review', 'IN CODE REVIEW', 'PR submitted; awaiting review and approval.', '#8b5cf6', 8, FALSE, FALSE, 'active', 'in_motion', 'In Motion', '🏃'),
  ('testing_qa', 'TESTING / QA', 'Under validation on staging / test environment.', '#eab308', 9, FALSE, FALSE, 'active', 'in_motion', 'In Motion', '🏃'),
  ('ready_for_deploy', 'READY FOR DEPLOY', 'Approved and ready for production release.', '#0d9488', 10, FALSE, FALSE, 'active', 'in_motion', 'In Motion', '🏃'),
  ('planning', 'PLANNING', 'Architecture, RFC, spike, or scoping phase.', '#a855f7', 13, FALSE, FALSE, 'todo', 'up_next', 'Up Next', '🎯'),
  ('ready_to_code', 'READY TO CODE', 'Groomed, estimated, and ready to start coding.', '#22c55e', 14, FALSE, FALSE, 'todo', 'up_next', 'Up Next', '🎯'),
  ('blocked', 'BLOCKED', 'Halted by build failure, environment issue, or critical bug.', '#ef4444', 25, FALSE, FALSE, 'active', 'blocked_paused', 'Blocked / Paused', '⏸️')
) AS v(key, name, description, color, position, is_default, is_system, category, section, section_label, section_emoji)
JOIN status_groups g ON g.key = 'task_workflow'
ON CONFLICT (group_id, key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  color = EXCLUDED.color,
  category = EXCLUDED.category,
  section = EXCLUDED.section,
  section_label = EXCLUDED.section_label,
  section_emoji = EXCLUDED.section_emoji;

NOTIFY pgrst, 'reload schema';
