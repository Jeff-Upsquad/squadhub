-- ============================================================
-- Stage workflows: split "where is the work" from "how important is it".
--
-- A status group flagged is_stage_workflow holds ONLY stages (where a
-- task is). Priority stays on tasks.priority (the same everywhere), and
-- "when" stays on tasks.work_date. Every stage carries a `section` that
-- maps it to one of four universal buckets:
--
--   not_started → Not started      in_motion      → Active
--   blocked_paused → Waiting       done           → Done
--
-- System stages: the `stages_system` group holds the stages EVERY stage
-- workflow shows (composed in at read time by getGroupStatuses):
--   NEW (default for every new task) · Blocked / Paused placeholders
--   (WAITING ON – DEPENDENCY, ON HOLD, BLOCKED, UNBLOCKED, HELP,
--   FOLLOW UP) · CLOSED · CANCELLED.
-- Their keys are the existing system keys, so the dependency auto-flip
-- and every done|closed|cancelled filter (Home, My Tasks, Day Planner,
-- timesheet, emergency banner) keep working unchanged.
--
-- Placeholder stages (is_placeholder): a temporary "current status". A
-- task parked in one remembers its original stage
-- (metadata.original_status) and returns to it when the placeholder is
-- cleared — e.g. when the task it waits on is completed.
--
-- is_archived retires a status row without deleting it (keys are
-- immutable and old activity may still reference them).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.status_groups
  ADD COLUMN IF NOT EXISTS is_stage_workflow BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.status_group_statuses
  ADD COLUMN IF NOT EXISTS is_placeholder BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO status_groups (key, name, description, icon, color, position, is_default, is_system, is_enabled, is_stage_workflow)
VALUES
  ('stages_system', 'System Stages', 'Shared by every stage workflow: NEW, the Blocked / Paused placeholders, CLOSED and CANCELLED.', 'lock', '#475569', 9, FALSE, TRUE, TRUE, TRUE),
  ('stages_general', 'General Stages', 'Doing → Review. Priority lives on the task''s priority field.', 'list', '#64748b', 10, FALSE, FALSE, TRUE, TRUE),
  ('stages_design', 'Design Stages', 'Brief → Concept → Draft → Client Review → Revisions → Approved.', 'palette', '#ec4899', 11, FALSE, FALSE, TRUE, TRUE),
  ('stages_software', 'Software Stages', 'Backlog → Ready → In Dev → Code Review → QA.', 'code', '#6366f1', 12, FALSE, FALSE, TRUE, TRUE)
ON CONFLICT (key) DO UPDATE SET is_stage_workflow = TRUE;

INSERT INTO status_group_statuses (group_id, key, name, description, color, position, is_default, category, section, section_label, section_emoji, is_placeholder)
SELECT g.id, v.key, v.name, v.description, v.color, v.position, v.is_default, v.category, v.section, v.section_label, v.section_emoji, v.is_placeholder
FROM (VALUES
  -- System stages (every stage workflow)
  ('stages_system', 'new', 'NEW', 'Just created; not triaged yet.', '#9ca3af', 0, TRUE, 'todo', 'not_started', 'Not started', '📥', FALSE),
  ('stages_system', 'waiting_on_dependency', 'WAITING ON – DEPENDENCY', 'Waiting until another task / person moves.', '#6b7280', 1, FALSE, 'active', 'blocked_paused', 'Blocked / Paused', '⏸️', TRUE),
  ('stages_system', 'on_hold', 'ON HOLD', 'Intentionally paused for now.', '#78716c', 2, FALSE, 'active', 'blocked_paused', 'Blocked / Paused', '⏸️', TRUE),
  ('stages_system', 'blocked', 'BLOCKED', 'Can''t move forward.', '#dc2626', 3, FALSE, 'active', 'blocked_paused', 'Blocked / Paused', '⏸️', TRUE),
  ('stages_system', 'unblocked', 'UNBLOCKED', 'Was waiting, now free to resume.', '#84cc16', 4, FALSE, 'active', 'blocked_paused', 'Blocked / Paused', '⏸️', TRUE),
  ('stages_system', 'help', 'HELP', 'Stuck; needs input or assistance.', '#a16207', 5, FALSE, 'active', 'blocked_paused', 'Blocked / Paused', '⏸️', TRUE),
  ('stages_system', 'follow_ups', 'FOLLOW UP', 'Awaiting a reply; check back.', '#4b5563', 6, FALSE, 'active', 'blocked_paused', 'Blocked / Paused', '⏸️', TRUE),
  ('stages_system', 'closed', 'CLOSED', 'Completed.', '#10b981', 7, FALSE, 'closed', 'done', 'Closed', '✅', FALSE),
  ('stages_system', 'cancelled', 'CANCELLED', 'No longer needed.', '#6b7280', 8, FALSE, 'closed', 'done', 'Closed', '✅', FALSE),
  -- General
  ('stages_general', 'gen_doing', 'DOING', 'Being worked on.', '#3b82f6', 0, FALSE, 'active', 'in_motion', 'Active', '🏃', FALSE),
  ('stages_general', 'gen_review', 'REVIEW', 'Done by the assignee; needs a check.', '#8b5cf6', 1, FALSE, 'active', 'in_motion', 'Active', '🏃', FALSE),
  -- Design
  ('stages_design', 'design_brief', 'BRIEF', 'Requirement received; not started.', '#94a3b8', 0, FALSE, 'todo', 'not_started', 'Not started', '📥', FALSE),
  ('stages_design', 'design_concept', 'CONCEPT', 'Exploring directions / moodboards.', '#a78bfa', 1, FALSE, 'active', 'in_motion', 'Active', '🏃', FALSE),
  ('stages_design', 'design_draft', 'DRAFT', 'Designing the first version.', '#3b82f6', 2, FALSE, 'active', 'in_motion', 'Active', '🏃', FALSE),
  ('stages_design', 'design_client_review', 'CLIENT REVIEW', 'Shared with the client for feedback.', '#f59e0b', 3, FALSE, 'active', 'in_motion', 'Active', '🏃', FALSE),
  ('stages_design', 'design_revisions', 'REVISIONS', 'Applying client feedback.', '#f97316', 4, FALSE, 'active', 'in_motion', 'Active', '🏃', FALSE),
  ('stages_design', 'design_approved', 'APPROVED', 'Client signed off; preparing files.', '#14b8a6', 5, FALSE, 'active', 'in_motion', 'Active', '🏃', FALSE),
  -- Software
  ('stages_software', 'dev_backlog', 'BACKLOG', 'Captured; not planned yet.', '#94a3b8', 0, FALSE, 'todo', 'not_started', 'Not started', '📥', FALSE),
  ('stages_software', 'dev_ready', 'READY', 'Spec''d and ready to pick up.', '#64748b', 1, FALSE, 'todo', 'not_started', 'Not started', '📥', FALSE),
  ('stages_software', 'dev_in_dev', 'IN DEV', 'Being built.', '#3b82f6', 2, FALSE, 'active', 'in_motion', 'Active', '🏃', FALSE),
  ('stages_software', 'dev_code_review', 'CODE REVIEW', 'PR open; awaiting review.', '#8b5cf6', 3, FALSE, 'active', 'in_motion', 'Active', '🏃', FALSE),
  ('stages_software', 'dev_qa', 'QA', 'Being tested.', '#eab308', 4, FALSE, 'active', 'in_motion', 'Active', '🏃', FALSE)
) AS v(group_key, key, name, description, color, position, is_default, category, section, section_label, section_emoji, is_placeholder)
JOIN status_groups g ON g.key = v.group_key
ON CONFLICT (group_id, key) DO NOTHING;
