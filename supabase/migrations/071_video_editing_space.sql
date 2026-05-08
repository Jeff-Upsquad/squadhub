-- ============================================================
-- 071: Video Editing Space
-- Adds a parallel client-space template for video editing.
-- Mirrors:
--   017 (template seed)
--   057 (task type promotion + custom fields)
--   070 (status seeding + trigger)
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Seed the "Video Editing Space" template
INSERT INTO client_space_templates (slug, name, description, icon, category, template) VALUES
(
  'video-editing-space',
  'Video Editing Space',
  'Manage video editing requests with brief, in-progress, and review lanes',
  'video',
  'video',
  '{"lists": [{"name": "Briefs", "position": 0, "default_view": "list"}, {"name": "In Progress", "position": 1, "default_view": "board"}, {"name": "Reviews", "position": 2, "default_view": "board"}]}'
)
ON CONFLICT (slug) DO NOTHING;

-- 2. Promote video_edit_task out of system-protection so admins can edit fields.
UPDATE public.task_types
   SET is_system   = FALSE,
       name        = 'Video Edit Task',
       description = 'Video editing deliverables',
       icon        = 'video'
 WHERE key = 'video_edit_task';

DO $$
DECLARE
  v_type_id UUID;
BEGIN
  SELECT id INTO v_type_id FROM public.task_types WHERE key = 'video_edit_task';
  IF v_type_id IS NULL THEN
    INSERT INTO public.task_types (key, name, description, icon, color, is_system, is_enabled, position)
    VALUES ('video_edit_task', 'Video Edit Task', 'Video editing deliverables', 'video', '#ef4444', FALSE, TRUE, 2)
    RETURNING id INTO v_type_id;
  END IF;

  -- 3. Replace seeded fields. Drop legacy keys we are renaming/repurposing.
  --    Note: we keep the keys 'aspect_ratio', 'duration', 'platform' and convert
  --    them to the shape used by DesignFieldRow. We add a new 'brief_type' key.
  --    'deliverables' is dropped (covered by the Brief textarea).
  DELETE FROM public.task_type_fields
   WHERE task_type_id = v_type_id
     AND key IN ('aspect_ratio', 'duration', 'platform', 'deliverables');

  -- brief_type: multi-select with "Other" reveal
  INSERT INTO public.task_type_fields
    (task_type_id, key, label, field_type, options, allow_other, is_required, position)
  VALUES (v_type_id, 'brief_type', 'Type of edit', 'multi_select',
    '[
       {"label":"Reel","value":"reel"},
       {"label":"YouTube long-form","value":"yt_long"},
       {"label":"YouTube Short","value":"yt_short"},
       {"label":"Podcast clip","value":"podcast_clip"},
       {"label":"Ad creative","value":"ad"},
       {"label":"Vlog","value":"vlog"},
       {"label":"Tutorial","value":"tutorial"},
       {"label":"Promo","value":"promo"},
       {"label":"Event recap","value":"event_recap"},
       {"label":"Interview","value":"interview"}
     ]'::jsonb, TRUE, FALSE, 0)
  ON CONFLICT (task_type_id, key) DO UPDATE SET
    label = EXCLUDED.label, field_type = EXCLUDED.field_type,
    options = EXCLUDED.options, allow_other = EXCLUDED.allow_other,
    is_required = EXCLUDED.is_required, position = EXCLUDED.position;

  -- aspect_ratio: multi-select + size-chart help link
  INSERT INTO public.task_type_fields
    (task_type_id, key, label, field_type, options, allow_other, help_url, is_required, position)
  VALUES (v_type_id, 'aspect_ratio', 'Aspect ratio', 'multi_select',
    '[
       {"label":"16:9 — 1920×1080 (Landscape)","value":"16_9"},
       {"label":"9:16 — 1080×1920 (Vertical)","value":"9_16"},
       {"label":"1:1 — 1080×1080 (Square)","value":"1_1"},
       {"label":"4:5 — 1080×1350 (Portrait)","value":"4_5"}
     ]'::jsonb, FALSE, '/help/video-aspect-ratios', FALSE, 1)
  ON CONFLICT (task_type_id, key) DO UPDATE SET
    label = EXCLUDED.label, field_type = EXCLUDED.field_type,
    options = EXCLUDED.options, allow_other = EXCLUDED.allow_other,
    help_url = EXCLUDED.help_url, is_required = EXCLUDED.is_required,
    position = EXCLUDED.position;

  -- duration: free text
  INSERT INTO public.task_type_fields
    (task_type_id, key, label, field_type, placeholder, is_required, position)
  VALUES (v_type_id, 'duration', 'Target duration', 'text',
          'e.g. 30s, 60s, 5–7 min', FALSE, 2)
  ON CONFLICT (task_type_id, key) DO UPDATE SET
    label = EXCLUDED.label, field_type = EXCLUDED.field_type,
    placeholder = EXCLUDED.placeholder, is_required = EXCLUDED.is_required,
    position = EXCLUDED.position;

  -- platform: multi-select
  INSERT INTO public.task_type_fields
    (task_type_id, key, label, field_type, options, is_required, position)
  VALUES (v_type_id, 'platform', 'Platform', 'multi_select',
    '[
       {"label":"YouTube","value":"youtube"},
       {"label":"Instagram","value":"instagram"},
       {"label":"TikTok","value":"tiktok"},
       {"label":"Facebook","value":"facebook"},
       {"label":"LinkedIn","value":"linkedin"},
       {"label":"X / Twitter","value":"x_twitter"}
     ]'::jsonb, FALSE, 3)
  ON CONFLICT (task_type_id, key) DO UPDATE SET
    label = EXCLUDED.label, field_type = EXCLUDED.field_type,
    options = EXCLUDED.options, is_required = EXCLUDED.is_required,
    position = EXCLUDED.position;

  -- 4. Backfill: assign video_edit_task type to tasks in video-editing-space folders
  WITH video_lists AS (
    SELECT l.id
      FROM public.lists l
      JOIN public.folders f                ON f.id = l.folder_id
      JOIN public.client_space_templates t ON t.id = f.client_space_template_id
     WHERE t.slug = 'video-editing-space'
  )
  UPDATE public.tasks t
     SET task_type_id = v_type_id
   WHERE (t.task_type_id IS NULL
          OR t.task_type_id = (SELECT id FROM public.task_types WHERE key = 'task'))
     AND t.list_id IN (SELECT id FROM video_lists);
END $$;

-- 5. Backfill: replace default statuses for any space already linked to a
--    video-editing-space folder with the same 8 statuses used by Design Space.
DO $$
DECLARE
  _space_id UUID;
BEGIN
  FOR _space_id IN
    SELECT DISTINCT s.id
    FROM spaces s
    JOIN folders f ON f.space_id = s.id
    JOIN client_space_templates cst ON cst.id = f.client_space_template_id
    WHERE cst.slug = 'video-editing-space'
  LOOP
    DELETE FROM space_statuses WHERE space_id = _space_id;

    INSERT INTO space_statuses (space_id, name, color, position, is_default, category) VALUES
      (_space_id, 'New Request',      '#6b7280', 0,  TRUE,  'todo'),
      (_space_id, 'Checking',         '#f59e0b', 1,  FALSE, 'todo'),
      (_space_id, 'Line-up',          '#8b5cf6', 2,  FALSE, 'active'),
      (_space_id, 'Assigned',         '#3b82f6', 3,  FALSE, 'active'),
      (_space_id, 'Work in Progress', '#0ea5e9', 4,  FALSE, 'active'),
      (_space_id, 'Changes',          '#f97316', 5,  FALSE, 'done'),
      (_space_id, 'For Review',       '#a855f7', 6,  FALSE, 'done'),
      (_space_id, 'Closed',           '#22c55e', 7,  FALSE, 'closed');
  END LOOP;
END $$;

-- 6. Generalize the seed-statuses trigger to handle both design-space and
--    video-editing-space slugs (the 8 statuses are identical for both).
CREATE OR REPLACE FUNCTION seed_design_statuses()
RETURNS TRIGGER AS $$
DECLARE
  _tpl_slug TEXT;
BEGIN
  IF NEW.client_space_template_id IS NULL OR NEW.space_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT slug INTO _tpl_slug
  FROM client_space_templates
  WHERE id = NEW.client_space_template_id;

  IF _tpl_slug IN ('design-space', 'video-editing-space') THEN
    DELETE FROM space_statuses WHERE space_id = NEW.space_id;

    INSERT INTO space_statuses (space_id, name, color, position, is_default, category) VALUES
      (NEW.space_id, 'New Request',      '#6b7280', 0,  TRUE,  'todo'),
      (NEW.space_id, 'Checking',         '#f59e0b', 1,  FALSE, 'todo'),
      (NEW.space_id, 'Line-up',          '#8b5cf6', 2,  FALSE, 'active'),
      (NEW.space_id, 'Assigned',         '#3b82f6', 3,  FALSE, 'active'),
      (NEW.space_id, 'Work in Progress', '#0ea5e9', 4,  FALSE, 'active'),
      (NEW.space_id, 'Changes',          '#f97316', 5,  FALSE, 'done'),
      (NEW.space_id, 'For Review',       '#a855f7', 6,  FALSE, 'done'),
      (NEW.space_id, 'Closed',           '#22c55e', 7,  FALSE, 'closed');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
