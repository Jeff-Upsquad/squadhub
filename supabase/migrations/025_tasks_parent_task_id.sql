-- ============================================================
-- Add parent_task_id to tasks (was defined in migration 002 but
-- never landed on the deployed database).
-- Fully-qualified to public.tasks to avoid search_path surprises.
-- ============================================================

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tasks_parent ON public.tasks(parent_task_id);
