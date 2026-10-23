-- Notion default stages and universal application (2026-10-17).
--
-- 1. Updates task_workflow to be the single enabled workspace default group
--    with the 7 stages and 19 statuses from Notion "status vs stage".
-- 2. Disables all other status groups for now.
-- 3. Clears custom status group assignments so default applies universally.
-- 4. Syncs space_statuses across all spaces to the 19 default statuses.
-- 5. Normalises any legacy task statuses.

-- 1. Default stages on task_workflow ------------------------------------------
UPDATE status_groups
SET custom_sections = '[
  {"key":"not_started","label":"Not started","emoji":"📥","color":"#A0A0A0","position":10},
  {"key":"planning","label":"Planning","emoji":"🧭","color":"#8b6fd6","position":20},
  {"key":"up_next","label":"Up next","emoji":"🎯","color":"#3b8ee6","position":30},
  {"key":"scheduled_queued","label":"Scheduled / queued","emoji":"📅","color":"#2ea3b8","position":40},
  {"key":"in_motion","label":"In progress","emoji":"🏃","color":"#39C66B","position":50},
  {"key":"blocked_paused","label":"Blocked / paused","emoji":"⏸️","color":"#FFB340","position":60},
  {"key":"done","label":"Closed","emoji":"✅","color":"#7c3aed","position":70}
]'::jsonb,
    name = 'Workspace default',
    description = 'Default stages and statuses used across the workspace.',
    is_default = true,
    is_enabled = true,
    updated_at = now()
WHERE key = 'task_workflow';

-- 2. Upsert the 19 Notion statuses on task_workflow ---------------------------
WITH g AS (SELECT id FROM status_groups WHERE key = 'task_workflow'),
spec(key, name, section, category, color, description, pos, is_default, is_placeholder) AS (
  VALUES
    ('open',                  'Open',                  'not_started',      'todo',   '#9ca3af', 'Newly created task, not yet triaged or planned.',                    0,  true,  false),
    ('planning',              'Plan',                  'planning',         'todo',   '#8b6fd6', 'Being scoped and planned.',                                          1,  false, false),
    ('need_discussion',       'Need discussion',       'planning',         'todo',   '#a78bfa', 'Needs a conversation before work can start.',                        2,  false, false),
    ('active',                'Starting today',        'up_next',          'active', '#3b8ee6', 'Currently being worked on.',                                         3,  false, false),
    ('tomorrow',              'Tomorrow',              'up_next',          'active', '#06b6d4', 'Planned for the next day.',                                          4,  false, false),
    ('this_week',             'This week',             'scheduled_queued', 'active', '#22d3ee', 'To be handled sometime this week.',                                  5,  false, false),
    ('scheduled',             'Scheduled',             'scheduled_queued', 'active', '#60a5fa', 'Has a specific date/time set.',                                      6,  false, false),
    ('follow_ups',            'Follow ups',            'scheduled_queued', 'active', '#4b5563', 'Awaiting a reply; check back periodically.',                         7,  false, false),
    ('time_tracked',          'Time tracked',          'in_motion',        'active', '#0d9488', 'Timer is running / hours being logged against it.',                  8,  false, false),
    ('front_burner',          'Front burner',          'in_motion',        'active', '#39C66B', 'Actively working on this task daily. Will complete asap.',           9,  false, false),
    ('back_burner',           'Back burner',           'in_motion',        'active', '#a8a29e', 'Working on this task on regular intervals. Will complete eventually.', 10, false, false),
    ('on_hold',               'On hold',               'blocked_paused',   'active', '#78716c', 'Intentionally paused for now.',                                      11, false, false),
    ('waiting_on_dependency', 'Waiting on dependency', 'blocked_paused',   'active', '#6b7280', 'Blocked until something/someone else moves.',                        12, false, false),
    ('help',                  'Help',                  'blocked_paused',   'active', '#a16207', 'Stuck; needs input or assistance from someone.',                     13, false, false),
    ('blocked',               'Blocked',               'blocked_paused',   'active', '#ef4444', 'Halted by build failure, environment issue, or critical bug.',        14, false, false),
    ('unblocked',             'Unblocked',             'blocked_paused',   'active', '#84cc16', 'Was blocked, now free to resume.',                                   15, false, true),
    ('for_review',            'For review',            'done',             'active', '#8b5cf6', 'Waiting for review before closing.',                                 16, false, false),
    ('closed',                'Closed',                'done',             'closed', '#10b981', 'Completed and archived.',                                            17, false, false),
    ('cancelled',             'Cancelled',             'done',             'closed', '#6b7280', 'No longer needed; closed without completing.',                       18, false, false)
),
upd AS (
  UPDATE status_group_statuses s
  SET name = spec.name, section = spec.section, category = spec.category, color = spec.color,
      description = spec.description, position = spec.pos, is_default = spec.is_default,
      is_placeholder = spec.is_placeholder, is_archived = false,
      section_label = NULL, section_emoji = NULL
  FROM spec, g
  WHERE s.group_id = g.id AND s.key = spec.key
  RETURNING s.key
)
INSERT INTO status_group_statuses (group_id, key, name, section, category, color, description, position, is_default, is_placeholder, is_archived)
SELECT g.id, spec.key, spec.name, spec.section, spec.category, spec.color, spec.description, spec.pos, spec.is_default, spec.is_placeholder, false
FROM spec, g
WHERE spec.key NOT IN (SELECT key FROM upd);

-- Archive any non-spec statuses on task_workflow
UPDATE status_group_statuses s
SET is_archived = true, is_default = false
FROM status_groups g
WHERE g.id = s.group_id AND g.key = 'task_workflow'
  AND s.key NOT IN (
    'open', 'planning', 'need_discussion', 'active', 'tomorrow', 'this_week',
    'scheduled', 'follow_ups', 'time_tracked', 'front_burner', 'back_burner',
    'on_hold', 'waiting_on_dependency', 'help', 'blocked', 'unblocked',
    'for_review', 'closed', 'cancelled'
  );

-- 3. Disable all other status groups for now -----------------------------------
UPDATE status_groups
SET is_enabled = false, is_default = false, updated_at = now()
WHERE key != 'task_workflow';

-- 4. Clear custom assignments so default applies universally -----------------
DELETE FROM status_group_assignments;

-- 5. Sync space_statuses across all spaces to the 19 default statuses ----------
DELETE FROM space_statuses;
INSERT INTO space_statuses (space_id, name, color, position, is_default, category)
SELECT s.id, st.name, st.color, st.position, st.is_default, st.category
FROM spaces s
CROSS JOIN (
  SELECT name, color, position, is_default, category
  FROM status_group_statuses
  WHERE group_id = (SELECT id FROM status_groups WHERE key = 'task_workflow')
    AND is_archived = false
  ORDER BY position
) st;

-- 6. Clean up legacy task status values ---------------------------------------
ALTER TABLE tasks DISABLE TRIGGER trg_notify_task_completed;

UPDATE tasks SET status = 'open' WHERE status IN ('To Do', 'todo', 'empty', 'focus_now', 'emergency', 'urgent', 'over_due', 'high_priority', 'priority');
UPDATE tasks SET status = 'closed' WHERE status IN ('done', 'Done', 'Closed');
UPDATE tasks SET status = 'front_burner' WHERE status IN ('in_progress', 'active_daily');
UPDATE tasks SET status = 'tomorrow' WHERE status = 'up_next';
UPDATE tasks SET status = 'active' WHERE status = 'today';
UPDATE tasks SET status = 'scheduled' WHERE status = 'reminder';
UPDATE tasks SET status = 'back_burner' WHERE status IN ('routines', 'imp_routines');

ALTER TABLE tasks ENABLE TRIGGER trg_notify_task_completed;
