-- 148_group_day_plans.sql
-- Container-level day-planner blocks: dragging a "Grouped tasks under {list}"
-- row onto the calendar creates ONE combined block sized to the sum of the
-- group's task estimates. Mirrors task_day_plans (085) but keyed by container
-- (list/folder/space) instead of a single task. Service-role access only via
-- supabaseAdmin — no RLS, same as task_day_plans.

CREATE TABLE IF NOT EXISTS group_day_plans (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  container_type   TEXT        NOT NULL CHECK (container_type IN ('list','folder','space')),
  container_id     UUID        NOT NULL,
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_date        DATE        NOT NULL,
  start_minute     INT         NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  duration_minutes INT         NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (container_type, container_id, user_id, plan_date)
);

CREATE INDEX IF NOT EXISTS idx_group_day_plans_user_date
  ON group_day_plans (user_id, plan_date);
