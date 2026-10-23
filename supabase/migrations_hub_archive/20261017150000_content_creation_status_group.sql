-- Content Creation status group and assignments (2026-10-17).
--
-- 1. Create the dedicated 'content_creation' status group with stages and statuses.
-- 2. Apply it to the Content Creation space (Area).
-- 3. Apply the workspace default status group ('task_workflow') to the 'General - Content creation' list.
-- 4. Sync space_statuses for the Content Creation space so board columns reflect the workflow.

-- 1. Create/update Content Creation status group -----------------------------
INSERT INTO status_groups (
  key,
  name,
  description,
  icon,
  color,
  position,
  is_default,
  is_system,
  is_enabled,
  custom_sections,
  disabled_status_keys,
  status_replacements,
  is_stage_workflow
)
VALUES (
  'content_creation',
  'Content Creation',
  'Dedicated workflow for content ideation, scripting, production, editing, review, and publishing.',
  'film',
  '#ec4899',
  5,
  false,
  false,
  true,
  '[
    {"key":"ideation","label":"Ideation & Brief","emoji":"💡","color":"#8b5cf6","position":10},
    {"key":"scripting","label":"Script & Copy","emoji":"✍️","color":"#3b8ee6","position":20},
    {"key":"production","label":"Production","emoji":"🎬","color":"#f59e0b","position":30},
    {"key":"editing","label":"Post-Production","emoji":"✂️","color":"#ec4899","position":40},
    {"key":"review","label":"Review & Approval","emoji":"👀","color":"#06b6d4","position":50},
    {"key":"blocked_paused","label":"Blocked / paused","emoji":"⏸️","color":"#FFB340","position":55},
    {"key":"published","label":"Published / Done","emoji":"🚀","color":"#10b981","position":60}
  ]'::jsonb,
  '[]'::jsonb,
  '{}'::jsonb,
  false
)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  color = EXCLUDED.color,
  position = EXCLUDED.position,
  is_enabled = true,
  custom_sections = EXCLUDED.custom_sections,
  updated_at = now();

-- 2. Upsert statuses in status_group_statuses --------------------------------
WITH g AS (SELECT id FROM status_groups WHERE key = 'content_creation'),
spec(key, name, section, category, color, description, pos, is_default, is_placeholder) AS (
  VALUES
    ('open',                  'Topic Proposed',        'ideation',       'todo',   '#9ca3af', 'New content idea or topic suggested.',                   0,  true,  false),
    ('brief_approved',        'Brief Approved',        'ideation',       'todo',   '#8b5cf6', 'Content brief finalized and approved for production.',   1,  false, false),
    ('drafting_script',       'Drafting Script',       'scripting',      'active', '#60a5fa', 'Writing script, copy, or interview outline.',           2,  false, false),
    ('script_review',         'Script Review',         'scripting',      'active', '#38bdf8', 'Script submitted for feedback and approval.',          3,  false, false),
    ('asset_gathering',       'Asset Gathering',       'production',     'active', '#fbbf24', 'Collecting B-roll, assets, audio, or graphics.',        4,  false, false),
    ('filming_recording',     'Filming / Recording',   'production',     'active', '#f59e0b', 'Shooting video or recording audio/voiceover.',          5,  false, false),
    ('video_editing',         'Video / Graphic Editing','editing',       'active', '#f43f5e', 'Active video assembly, cutting, or graphic editing.',   6,  false, false),
    ('thumbnail_design',      'Thumbnail Design',      'editing',        'active', '#ec4899', 'Designing thumbnail, title card, and cover packaging.',7,  false, false),
    ('internal_qa',           'Internal QA',           'review',         'active', '#06b6d4', 'Internal creative and quality check.',                  8,  false, false),
    ('client_review',         'Client Review',         'review',         'active', '#14b8a6', 'Shared with client or stakeholder for review.',         9,  false, false),
    ('waiting_on_dependency', 'Waiting on dependency', 'blocked_paused', 'active', '#6b7280', 'Blocked until something/someone else moves.',          10, false, true),
    ('on_hold',               'On hold',               'blocked_paused', 'active', '#78716c', 'Intentionally paused for now.',                         11, false, false),
    ('blocked',               'Blocked',               'blocked_paused', 'active', '#ef4444', 'Blocked by external blocker or missing materials.',     12, false, false),
    ('unblocked',             'Unblocked',             'blocked_paused', 'active', '#84cc16', 'Was blocked, now free to resume.',                      13, false, true),
    ('scheduled_publish',     'Scheduled',             'published',      'active', '#34d399', 'Content scheduled for release.',                        14, false, false),
    ('closed',                'Published',             'published',      'closed', '#10b981', 'Live and published.',                                   15, false, false),
    ('cancelled',             'Cancelled',             'published',      'closed', '#6b7280', 'No longer needed; cancelled.',                         16, false, false)
),
upd AS (
  UPDATE status_group_statuses s
  SET name = spec.name, section = spec.section, category = spec.category, color = spec.color,
      description = spec.description, position = spec.pos, is_default = spec.is_default,
      is_placeholder = spec.is_placeholder, is_archived = false
  FROM spec, g
  WHERE s.group_id = g.id AND s.key = spec.key
  RETURNING s.key
)
INSERT INTO status_group_statuses (group_id, key, name, section, category, color, description, position, is_default, is_placeholder, is_archived)
SELECT g.id, spec.key, spec.name, spec.section, spec.category, spec.color, spec.description, spec.pos, spec.is_default, spec.is_placeholder, false
FROM spec, g
WHERE spec.key NOT IN (SELECT key FROM upd);

-- 3. Apply to Content Creation space (Area) -----------------------------------
DELETE FROM status_group_assignments
WHERE entity_type = 'space'
  AND entity_id IN (SELECT id FROM spaces WHERE name = 'Content Creation');

INSERT INTO status_group_assignments (group_id, entity_type, entity_id)
SELECT g.id, 'space', s.id
FROM status_groups g
CROSS JOIN spaces s
WHERE g.key = 'content_creation' AND s.name = 'Content Creation';

-- 4. Apply Default group to the General list in Content Creation --------------
DELETE FROM status_group_assignments
WHERE entity_type = 'list'
  AND entity_id IN (
    SELECT l.id FROM lists l
    JOIN spaces s ON s.id = l.space_id
    WHERE s.name = 'Content Creation' AND l.name = 'General - Content creation'
  );

INSERT INTO status_group_assignments (group_id, entity_type, entity_id)
SELECT def.id, 'list', l.id
FROM status_groups def
CROSS JOIN lists l
JOIN spaces s ON s.id = l.space_id
WHERE def.key = 'task_workflow'
  AND s.name = 'Content Creation'
  AND l.name = 'General - Content creation';

-- 5. Sync space_statuses for Content Creation space ---------------------------
DELETE FROM space_statuses
WHERE space_id IN (SELECT id FROM spaces WHERE name = 'Content Creation');

INSERT INTO space_statuses (space_id, name, color, position, is_default, category)
SELECT s.id, st.name, st.color, st.position, st.is_default, st.category
FROM spaces s
CROSS JOIN (
  SELECT name, color, position, is_default, category
  FROM status_group_statuses
  WHERE group_id = (SELECT id FROM status_groups WHERE key = 'content_creation')
    AND is_archived = false
  ORDER BY position
) st
WHERE s.name = 'Content Creation';
