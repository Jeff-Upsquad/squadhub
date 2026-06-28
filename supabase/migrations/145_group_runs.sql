-- ============================================================
-- 145: Runnable task groups ("group runs").
--
-- A "group" is the parent row you see when tasks in a list are grouped
-- (by status / priority / date / etc). Unlike a work block, a group is a
-- *virtual* entity — it has no task row of its own, just a stable key the
-- client computes from its context (e.g. "list:<id>|status:<id>").
--
-- This migration gives those virtual groups the same run machinery a work
-- block has:
--   1) a per-user run history (Start -> Stop on a group), and
--   2) auto-collected completions: any task the running user marks done while
--      one of their group runs is active gets logged against that run, and
--   3) per-task timer overlaps: time spent on a per-task timer while a group
--      run is active, so the group can show "what did I work on in here".
--
-- Time logging: on stop, the run's wall-clock is added to the user's
-- daily_time_summaries (the daily timesheet total + design Reports), keyed by
-- the workspace resolved from the group's originating list at start time.
-- ============================================================

-- 1) Run history (one row per Start->Stop on a group, by a user).
-- group_key is the client-computed stable identity of the group; group_label
-- is a denormalised human label captured at start (groups are virtual, so
-- there is nothing else to join to for a name). workspace_id is resolved from
-- the originating list when known, so the daily-summary bump on stop has a
-- workspace to attribute time to even for an otherwise-empty run.
CREATE TABLE IF NOT EXISTS group_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_key        TEXT NOT NULL,
  group_label      TEXT NOT NULL DEFAULT '',
  workspace_id     UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,        -- NULL = currently running
  duration_seconds INT,                -- written on stop
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_group_runs_user ON group_runs(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_runs_key  ON group_runs(group_key, started_at DESC);
-- At most one active group run per user — mirrors the work-block invariant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_group_runs_one_active_per_user
  ON group_runs(user_id) WHERE ended_at IS NULL;

-- 2) Auto-collected completions (tasks marked done while a group run was active).
CREATE TABLE IF NOT EXISTS group_run_completions (
  run_id            UUID NOT NULL REFERENCES group_runs(id) ON DELETE CASCADE,
  completed_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  completed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, completed_task_id)
);
CREATE INDEX IF NOT EXISTS idx_group_run_completions_task ON group_run_completions(completed_task_id);

-- 3) Per-task timer overlaps inside a group run (mirror of work_block_task_times).
CREATE TABLE IF NOT EXISTS group_run_task_times (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           UUID NOT NULL REFERENCES group_runs(id) ON DELETE CASCADE,
  task_id          UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,        -- NULL = still running
  duration_seconds INT,                -- written on close
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_group_run_task_times_run  ON group_run_task_times(run_id);
CREATE INDEX IF NOT EXISTS idx_group_run_task_times_task ON group_run_task_times(task_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_group_run_task_times_one_open
  ON group_run_task_times(run_id, task_id) WHERE ended_at IS NULL;
