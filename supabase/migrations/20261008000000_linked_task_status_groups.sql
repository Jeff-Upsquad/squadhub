-- Live inheritance: linked groups store only their additions, never copied defaults.
ALTER TABLE public.status_groups
  ADD COLUMN IF NOT EXISTS base_group_id UUID REFERENCES public.status_groups(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS custom_sections JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_status_groups_base ON public.status_groups(base_group_id);
ALTER TABLE public.status_groups
  ADD CONSTRAINT status_groups_no_self_inheritance CHECK (base_group_id IS DISTINCT FROM id),
  ADD CONSTRAINT status_groups_sections_array CHECK (jsonb_typeof(custom_sections) = 'array');

UPDATE public.status_groups SET is_default = FALSE WHERE key <> 'task_workflow' AND is_default;
UPDATE public.status_groups
SET name = 'Default Task Statuses', is_default = TRUE, is_system = TRUE, is_enabled = TRUE,
    description = 'System default task statuses. Linked status groups inherit changes automatically.'
WHERE key = 'task_workflow';
UPDATE public.status_group_statuses s SET is_system = TRUE
FROM public.status_groups g WHERE s.group_id = g.id AND g.key = 'task_workflow';

CREATE OR REPLACE FUNCTION public.validate_status_group_inheritance()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.key = 'task_workflow' AND
    (NEW.base_group_id IS NOT NULL OR NOT NEW.is_default OR NOT NEW.is_enabled OR NOT NEW.is_system) THEN
    RAISE EXCEPTION 'Default Task Statuses must remain the enabled system default';
  END IF;
  IF NEW.key <> 'task_workflow' AND NEW.is_default THEN
    RAISE EXCEPTION 'Default Task Statuses is the system default';
  END IF;
  IF NEW.base_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM status_groups WHERE id = NEW.base_group_id AND key = 'task_workflow'
  ) THEN
    RAISE EXCEPTION 'Linked status groups must use Default Task Statuses as their primary group';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_status_group_inheritance
BEFORE INSERT OR UPDATE ON public.status_groups
FOR EACH ROW EXECUTE FUNCTION public.validate_status_group_inheritance();

CREATE OR REPLACE FUNCTION public.validate_inherited_task_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE g public.status_groups;
BEGIN
  SELECT * INTO g FROM status_groups WHERE id = NEW.group_id FOR UPDATE;
  IF g.key = 'task_workflow' THEN
    NEW.is_system := TRUE;
    IF EXISTS (
      SELECT 1 FROM status_group_statuses s JOIN status_groups child ON child.id = s.group_id
      WHERE child.base_group_id = g.id AND
        ((NEW.key IS NOT NULL AND s.key = NEW.key) OR lower(s.name) = lower(NEW.name))
    ) THEN
      RAISE EXCEPTION 'This status conflicts with an addition in a linked group';
    END IF;
  ELSIF g.base_group_id IS NOT NULL THEN
    NEW.is_default := FALSE;
    IF EXISTS (
      SELECT 1 FROM status_group_statuses s WHERE s.group_id = g.base_group_id AND
        ((NEW.key IS NOT NULL AND s.key = NEW.key) OR lower(s.name) = lower(NEW.name))
    ) THEN
      RAISE EXCEPTION 'This status already exists in Default Task Statuses';
    END IF;
  END IF;
  IF NEW.is_default THEN
    UPDATE status_group_statuses SET is_default = FALSE
    WHERE group_id = NEW.group_id AND id <> NEW.id AND is_default;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'Status keys are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_inherited_task_status
BEFORE INSERT OR UPDATE ON public.status_group_statuses
FOR EACH ROW EXECUTE FUNCTION public.validate_inherited_task_status();

-- Deleting the initial status picks the next owned row as its replacement.
CREATE OR REPLACE FUNCTION public.restore_task_status_default()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.is_default THEN
    UPDATE status_group_statuses SET is_default = TRUE WHERE id = (
      SELECT id FROM status_group_statuses WHERE group_id = OLD.group_id
      ORDER BY position, created_at LIMIT 1
    );
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER restore_task_status_default
AFTER DELETE ON public.status_group_statuses
FOR EACH ROW EXECUTE FUNCTION public.restore_task_status_default();
