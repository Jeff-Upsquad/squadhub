-- Reminder is a task TYPE, independent of the Scheduled task status.
INSERT INTO public.task_types (key, name, description, icon, color, position, is_system, is_enabled)
VALUES ('reminders', 'Reminders', 'A reminder with a date and time, snooze and completion actions.', 'clock', '#f59e0b', 90, true, true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, is_enabled = true;

INSERT INTO public.task_type_group_items (group_id, task_type_id, position)
SELECT g.id, t.id, 90 FROM public.task_type_groups g CROSS JOIN public.task_types t
WHERE t.key = 'reminders'
ON CONFLICT (group_id, task_type_id) DO NOTHING;

-- Preserve every existing notification type, including independently added ones.
DO $$
DECLARE existing_check text;
BEGIN
  SELECT pg_get_expr(conbin, conrelid) INTO existing_check FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check';
  IF existing_check IS NOT NULL THEN
    ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
    EXECUTE format('ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK ((%s) OR type = %L)', existing_check, 'task_reminder');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.task_reminder_deliveries (
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  due_at timestamptz NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id, due_at)
);
ALTER TABLE public.task_reminder_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_reminder_deliveries FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.task_reminder_deliveries TO service_role;
CREATE INDEX IF NOT EXISTS idx_reminder_tasks_due ON public.tasks (due_date, id) WHERE due_date IS NOT NULL;

CREATE OR REPLACE FUNCTION public.deliver_due_task_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t record; recipient uuid; inserted integer; delivered integer := 0;
BEGIN
  FOR t IN
    SELECT tasks.* FROM public.tasks
    JOIN public.task_types tt ON tt.id = tasks.task_type_id AND tt.key = 'reminders'
    JOIN public.lists l ON l.id = tasks.list_id AND l.deleted_at IS NULL
    WHERE tasks.due_date <= now() AND tasks.recurrence IS NULL
      AND lower(tasks.status) NOT IN ('done', 'closed', 'cancelled', 'completed')
      AND NOT EXISTS (SELECT 1 FROM public.space_statuses ss
        WHERE ss.space_id = l.space_id AND ss.name = tasks.status AND ss.category IN ('done', 'closed'))
      AND EXISTS (
        SELECT 1 FROM unnest(array_append(coalesce(tasks.assignee_ids, ARRAY[]::uuid[]), tasks.created_by)) u
        WHERE u IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.task_reminder_deliveries d
          WHERE d.task_id = tasks.id AND d.user_id = u AND d.due_at = tasks.due_date
        )
      )
    ORDER BY tasks.due_date LIMIT 100 FOR UPDATE OF tasks SKIP LOCKED
  LOOP
    FOR recipient IN SELECT DISTINCT u FROM unnest(array_append(coalesce(t.assignee_ids, ARRAY[]::uuid[]), t.created_by)) u WHERE u IS NOT NULL
    LOOP
      INSERT INTO public.task_reminder_deliveries (task_id, user_id, due_at)
      VALUES (t.id, recipient, t.due_date) ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS inserted = ROW_COUNT;
      IF inserted > 0 THEN
        INSERT INTO public.notifications (user_id, type, reference_id, reference_type, title, body, metadata)
        VALUES (recipient, 'task_reminder', t.id, 'task', t.title, 'Reminder due now',
          jsonb_build_object('task_id', t.id, 'due_at', t.due_date, 'list_id', t.list_id));
        delivered := delivered + 1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN delivered;
END $$;
REVOKE ALL ON FUNCTION public.deliver_due_task_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_due_task_reminders() TO service_role;

-- Rescheduling, changing type, or completing a task retires its old alert on
-- every device, including changes made outside the reminder action endpoint.
CREATE OR REPLACE FUNCTION public.retire_task_reminder_notifications()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.due_date IS DISTINCT FROM OLD.due_date
    OR NEW.task_type_id IS DISTINCT FROM OLD.task_type_id
    OR lower(NEW.status) IN ('done', 'closed', 'cancelled', 'completed')
    OR EXISTS (SELECT 1 FROM public.lists l JOIN public.space_statuses ss ON ss.space_id = l.space_id
      WHERE l.id = NEW.list_id AND ss.name = NEW.status AND ss.category IN ('done', 'closed')) THEN
    UPDATE public.notifications SET is_read = true
    WHERE reference_id = NEW.id AND type = 'task_reminder' AND NOT is_read;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_retire_task_reminders ON public.tasks;
CREATE TRIGGER trg_retire_task_reminders AFTER UPDATE OF due_date, task_type_id, status ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.retire_task_reminder_notifications();
REVOKE ALL ON FUNCTION public.retire_task_reminder_notifications() FROM PUBLIC, anon, authenticated;
