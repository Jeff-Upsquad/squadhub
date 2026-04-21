-- ============================================================
-- Task Types v2: is_enabled flag + role/user access tables
-- + seed Design Task and Video Edit Task as system types
-- Idempotent; safe to re-run.
-- ============================================================

-- 1. is_enabled flag on task_types
ALTER TABLE public.task_types
  ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Access tables (mirror of mini_app_*_access from 008)
CREATE TABLE IF NOT EXISTS public.task_type_role_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type_id UUID NOT NULL REFERENCES public.task_types(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_type_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_ttra_type ON public.task_type_role_access(task_type_id);
CREATE INDEX IF NOT EXISTS idx_ttra_role ON public.task_type_role_access(role_id);

CREATE TABLE IF NOT EXISTS public.task_type_user_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type_id UUID NOT NULL REFERENCES public.task_types(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_type_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ttua_type ON public.task_type_user_access(task_type_id);
CREATE INDEX IF NOT EXISTS idx_ttua_user ON public.task_type_user_access(user_id);

-- 3. Seed Design Task + Video Edit Task (system, enabled)
INSERT INTO public.task_types (key, name, description, icon, color, is_system, is_enabled, position)
VALUES
  ('design_task',     'Design Task',     'Visual design deliverables',  'palette', '#7c3aed', TRUE, TRUE, 1),
  ('video_edit_task', 'Video Edit Task', 'Video editing deliverables',  'video',   '#ef4444', TRUE, TRUE, 2)
ON CONFLICT (key) DO NOTHING;

-- 4. Seed fields for Design Task (idempotent via UNIQUE(task_type_id, key))
INSERT INTO public.task_type_fields (task_type_id, key, label, field_type, options, is_required, position)
SELECT id, 'design_format', 'Format', 'select',
       '[{"label":"Post","value":"post"},{"label":"Reel","value":"reel"},{"label":"Banner","value":"banner"},{"label":"Document","value":"document"}]'::jsonb,
       FALSE, 0
FROM public.task_types WHERE key = 'design_task'
ON CONFLICT (task_type_id, key) DO NOTHING;

INSERT INTO public.task_type_fields (task_type_id, key, label, field_type, options, is_required, position)
SELECT id, 'target_audience', 'Target Audience', 'text', '[]'::jsonb, FALSE, 1
FROM public.task_types WHERE key = 'design_task'
ON CONFLICT (task_type_id, key) DO NOTHING;

INSERT INTO public.task_type_fields (task_type_id, key, label, field_type, options, is_required, position)
SELECT id, 'brand_tone', 'Brand Tone', 'text', '[]'::jsonb, FALSE, 2
FROM public.task_types WHERE key = 'design_task'
ON CONFLICT (task_type_id, key) DO NOTHING;

INSERT INTO public.task_type_fields (task_type_id, key, label, field_type, options, is_required, position)
SELECT id, 'reference_links', 'Reference Links', 'textarea', '[]'::jsonb, FALSE, 3
FROM public.task_types WHERE key = 'design_task'
ON CONFLICT (task_type_id, key) DO NOTHING;

-- 5. Seed fields for Video Edit Task
INSERT INTO public.task_type_fields (task_type_id, key, label, field_type, options, is_required, position)
SELECT id, 'duration', 'Duration', 'text', '[]'::jsonb, FALSE, 0
FROM public.task_types WHERE key = 'video_edit_task'
ON CONFLICT (task_type_id, key) DO NOTHING;

INSERT INTO public.task_type_fields (task_type_id, key, label, field_type, options, is_required, position)
SELECT id, 'aspect_ratio', 'Aspect Ratio', 'select',
       '[{"label":"16:9 (Landscape)","value":"16_9"},{"label":"9:16 (Portrait)","value":"9_16"},{"label":"1:1 (Square)","value":"1_1"},{"label":"4:5 (Vertical)","value":"4_5"}]'::jsonb,
       FALSE, 1
FROM public.task_types WHERE key = 'video_edit_task'
ON CONFLICT (task_type_id, key) DO NOTHING;

INSERT INTO public.task_type_fields (task_type_id, key, label, field_type, options, is_required, position)
SELECT id, 'platform', 'Platform', 'multi_select',
       '[{"label":"YouTube","value":"youtube"},{"label":"Instagram","value":"instagram"},{"label":"TikTok","value":"tiktok"},{"label":"Facebook","value":"facebook"},{"label":"LinkedIn","value":"linkedin"}]'::jsonb,
       FALSE, 2
FROM public.task_types WHERE key = 'video_edit_task'
ON CONFLICT (task_type_id, key) DO NOTHING;

INSERT INTO public.task_type_fields (task_type_id, key, label, field_type, options, is_required, position)
SELECT id, 'deliverables', 'Deliverables', 'textarea', '[]'::jsonb, FALSE, 3
FROM public.task_types WHERE key = 'video_edit_task'
ON CONFLICT (task_type_id, key) DO NOTHING;
