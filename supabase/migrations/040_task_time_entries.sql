-- ============================================================
-- 040: Task time entries (per-session history for task timers)
-- ============================================================
-- The existing tasks.time_tracked field is an aggregate total only, with no
-- per-session history. This table records every individual start/stop pair so
-- the Time Sheet panel can group entries by date and show each session as its
-- own row. The aggregate cache on tasks.time_tracked is kept in sync by the
-- POST /pm/tasks/:id/time-entries endpoint.

CREATE TABLE task_time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  stopped_at TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_time_entries_user_started ON task_time_entries(user_id, started_at DESC);
CREATE INDEX idx_task_time_entries_task ON task_time_entries(task_id);

ALTER TABLE task_time_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own task time entries"
  ON task_time_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own task time entries"
  ON task_time_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);
