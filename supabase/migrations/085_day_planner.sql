-- Day Planner module: focus persistence, snooze, and per-user day plan
-- See plan: build a Day Planner sidebar module that surfaces tasks the user
-- should look at today and lets them drag tasks onto an hourly schedule.

-- 1. Focus + snooze columns on tasks
--    focused_at:    when "Focus today" star was set (NULL = not focused).
--                   The list rule "set yesterday or today" uses this timestamp.
--    snoozed_until: hide from Day Planner list until this moment (UTC). NULL = not snoozed.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS focused_at    TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_focused_at
  ON tasks (focused_at)
  WHERE focused_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_snoozed_until
  ON tasks (snoozed_until)
  WHERE snoozed_until IS NOT NULL;

-- 2. Per-user day plan: time-slot blocks on a specific date.
--    A task can appear on different users' day plans independently.
CREATE TABLE IF NOT EXISTS task_day_plans (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_date        DATE        NOT NULL,
  start_minute     INT         NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  duration_minutes INT         NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, user_id, plan_date)
);

CREATE INDEX IF NOT EXISTS idx_task_day_plans_user_date
  ON task_day_plans (user_id, plan_date);

CREATE INDEX IF NOT EXISTS idx_task_day_plans_task
  ON task_day_plans (task_id);
