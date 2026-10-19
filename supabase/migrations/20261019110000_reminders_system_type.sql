-- Production already had a custom 'reminders' row. Promote it to the system
-- type so the existing role/user filters do not hide reminder creation.
UPDATE public.task_types
SET is_system = true, is_enabled = true
WHERE key = 'reminders';
