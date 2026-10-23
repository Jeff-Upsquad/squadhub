-- Reorder stages and statuses to exactly match the Notion document (2026-10-17).
--
-- 1. Updates task_workflow custom_sections order:
--    In progress -> Up next -> Scheduled / queued -> Planning -> Blocked / paused -> Not started -> Closed
-- 2. Updates status_group_statuses positions (0 to 18) to match the Notion order.
-- 3. Resyncs space_statuses across all spaces to match the new positions.

-- 1. Stage order on task_workflow ---------------------------------------------
UPDATE status_groups
SET custom_sections = '[
  {"key":"in_motion","label":"In progress","emoji":"🏃","color":"#39C66B","position":10},
  {"key":"up_next","label":"Up next","emoji":"🎯","color":"#3b8ee6","position":20},
  {"key":"scheduled_queued","label":"Scheduled / queued","emoji":"📅","color":"#2ea3b8","position":30},
  {"key":"planning","label":"Planning","emoji":"🧭","color":"#8b6fd6","position":40},
  {"key":"blocked_paused","label":"Blocked / paused","emoji":"⏸️","color":"#FFB340","position":50},
  {"key":"not_started","label":"Not started","emoji":"📥","color":"#A0A0A0","position":60},
  {"key":"done","label":"Closed","emoji":"✅","color":"#7c3aed","position":70}
]'::jsonb,
    updated_at = now()
WHERE key = 'task_workflow';

-- 2. Status order on task_workflow (positions 0 to 18) -------------------------
WITH g AS (SELECT id FROM status_groups WHERE key = 'task_workflow'),
spec(key, pos) AS (
  VALUES
    ('time_tracked',          0),
    ('front_burner',          1),
    ('back_burner',           2),
    ('active',                3),
    ('tomorrow',              4),
    ('this_week',             5),
    ('scheduled',             6),
    ('follow_ups',            7),
    ('planning',              8),
    ('need_discussion',       9),
    ('on_hold',               10),
    ('waiting_on_dependency', 11),
    ('help',                  12),
    ('blocked',               13),
    ('unblocked',             14),
    ('open',                  15),
    ('for_review',            16),
    ('closed',                17),
    ('cancelled',             18)
)
UPDATE status_group_statuses s
SET position = spec.pos
FROM spec, g
WHERE s.group_id = g.id AND s.key = spec.key;

-- 3. Sync space_statuses across all spaces ------------------------------------
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
