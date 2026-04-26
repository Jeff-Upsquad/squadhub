-- ============================================================
-- Design Brief task type — admin-customizable design fields
-- 1) Adds help_url + allow_other columns to task_type_fields
-- 2) Promotes design_task → editable, renames to "Design Brief"
-- 3) Replaces seeded fields with: brief_type, ratios, usage,
--    target_audience, reference_links
-- 4) Backfills existing design-space tasks to this task type
--    and migrates legacy metadata into metadata.custom.*
-- Idempotent; safe to re-run.
-- ============================================================

-- 1. Schema: extend task_type_fields
ALTER TABLE public.task_type_fields
  ADD COLUMN IF NOT EXISTS help_url    TEXT,
  ADD COLUMN IF NOT EXISTS allow_other BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Promote the design_task type out of system-protection so admins can edit
UPDATE public.task_types
   SET is_system   = FALSE,
       name        = 'Design Brief',
       description = 'Briefs for design deliverables',
       icon        = 'palette'
 WHERE key = 'design_task';

-- Capture the type id once for reuse
DO $$
DECLARE
  v_type_id UUID;
BEGIN
  SELECT id INTO v_type_id FROM public.task_types WHERE key = 'design_task';
  IF v_type_id IS NULL THEN
    -- Create it if it never existed (clean DBs)
    INSERT INTO public.task_types (key, name, description, icon, color, is_system, is_enabled, position)
    VALUES ('design_task', 'Design Brief', 'Briefs for design deliverables', 'palette', '#7c3aed', FALSE, TRUE, 1)
    RETURNING id INTO v_type_id;
  END IF;

  -- 3. Replace seeded fields. Drop legacy keys we are removing or renaming.
  DELETE FROM public.task_type_fields
   WHERE task_type_id = v_type_id
     AND key IN ('design_format', 'target_audience', 'brand_tone', 'reference_links');

  -- brief_type: multi-select with "Other" reveal
  INSERT INTO public.task_type_fields
    (task_type_id, key, label, field_type, options, allow_other, is_required, position)
  VALUES (v_type_id, 'brief_type', 'Type', 'multi_select',
    '[
       {"label":"Social media post","value":"social_post"},
       {"label":"Carousel","value":"carousel"},
       {"label":"Story / Reel cover","value":"story_cover"},
       {"label":"Meta ad creative","value":"meta_ad"},
       {"label":"YouTube thumbnail","value":"yt_thumb"},
       {"label":"Flyer","value":"flyer"},
       {"label":"Poster","value":"poster"},
       {"label":"Brochure","value":"brochure"},
       {"label":"Banner","value":"banner"},
       {"label":"Pitch deck","value":"deck"}
     ]'::jsonb, TRUE, FALSE, 0)
  ON CONFLICT (task_type_id, key) DO UPDATE SET
    label = EXCLUDED.label, field_type = EXCLUDED.field_type,
    options = EXCLUDED.options, allow_other = EXCLUDED.allow_other,
    is_required = EXCLUDED.is_required, position = EXCLUDED.position;

  -- ratios: multi-select + size-chart help link
  INSERT INTO public.task_type_fields
    (task_type_id, key, label, field_type, options, allow_other, help_url, is_required, position)
  VALUES (v_type_id, 'ratios', 'Ratios / Size', 'multi_select',
    '[
       {"label":"1:1 — 1080×1080 (Square)","value":"1_1"},
       {"label":"4:5 — 1080×1350 (Portrait)","value":"4_5"},
       {"label":"9:16 — 1080×1920 (Vertical)","value":"9_16"}
     ]'::jsonb, FALSE, '/help/social-sizes', FALSE, 1)
  ON CONFLICT (task_type_id, key) DO UPDATE SET
    label = EXCLUDED.label, field_type = EXCLUDED.field_type,
    options = EXCLUDED.options, allow_other = EXCLUDED.allow_other,
    help_url = EXCLUDED.help_url, is_required = EXCLUDED.is_required,
    position = EXCLUDED.position;

  -- usage: free text
  INSERT INTO public.task_type_fields
    (task_type_id, key, label, field_type, is_required, position)
  VALUES (v_type_id, 'usage', 'Usage', 'text', FALSE, 2)
  ON CONFLICT (task_type_id, key) DO UPDATE SET
    label = EXCLUDED.label, field_type = EXCLUDED.field_type,
    is_required = EXCLUDED.is_required, position = EXCLUDED.position;

  -- target_audience: free text  (key 'audience' is reserved in metadata, so keep namespace)
  INSERT INTO public.task_type_fields
    (task_type_id, key, label, field_type, is_required, position)
  VALUES (v_type_id, 'audience_text', 'Audience', 'text', FALSE, 3)
  ON CONFLICT (task_type_id, key) DO UPDATE SET
    label = EXCLUDED.label, field_type = EXCLUDED.field_type,
    is_required = EXCLUDED.is_required, position = EXCLUDED.position;

  -- reference_links: textarea, one URL per line
  INSERT INTO public.task_type_fields
    (task_type_id, key, label, field_type, placeholder, is_required, position)
  VALUES (v_type_id, 'reference_links', 'Reference links', 'textarea',
          'One link per line', FALSE, 4)
  ON CONFLICT (task_type_id, key) DO UPDATE SET
    label = EXCLUDED.label, field_type = EXCLUDED.field_type,
    placeholder = EXCLUDED.placeholder, is_required = EXCLUDED.is_required,
    position = EXCLUDED.position;

  -- 4. Backfill: assign design_task type to tasks in design-space folders
  --    (folders linked to a client_space_template with slug 'design-space').
  WITH design_lists AS (
    SELECT l.id
      FROM public.lists l
      JOIN public.folders f               ON f.id = l.folder_id
      JOIN public.client_space_templates t ON t.id = f.client_space_template_id
     WHERE t.slug = 'design-space'
  )
  UPDATE public.tasks t
     SET task_type_id = v_type_id
   WHERE (t.task_type_id IS NULL
          OR t.task_type_id = (SELECT id FROM public.task_types WHERE key = 'task'))
     AND t.list_id IN (SELECT id FROM design_lists);

  -- 5. Migrate legacy metadata into metadata.custom.* for tasks of this type
  --    Old keys: format (string) → brief_type ([category-or-format]) +
  --              brief_type_other (free text), audience → audience_text,
  --              tone → drop, references (string[]) → reference_links (joined),
  --              category → brief_type[0] when no format set.
  --    Does not run on tasks already having metadata.custom.brief_type set.
  UPDATE public.tasks
     SET metadata = jsonb_set(
       COALESCE(metadata, '{}'::jsonb),
       '{custom}',
       COALESCE(metadata->'custom', '{}'::jsonb)
         || jsonb_build_object(
           'audience_text',
             COALESCE(NULLIF(metadata->>'audience',''),
                      metadata->'custom'->>'audience_text'),
           'reference_links',
             CASE
               WHEN jsonb_typeof(metadata->'references') = 'array'
                 THEN array_to_string(
                   ARRAY(SELECT jsonb_array_elements_text(metadata->'references')),
                   E'\n')
               ELSE COALESCE(metadata->'custom'->>'reference_links', NULL)
             END,
           'brief_type_other',
             COALESCE(
               NULLIF(metadata->>'format',''),
               NULLIF(metadata->>'category',''),
               metadata->'custom'->>'brief_type_other'
             )
         )
     )
   WHERE task_type_id = v_type_id
     AND (metadata->'custom'->>'brief_type' IS NULL OR metadata->'custom'->>'brief_type' = '');
END $$;
