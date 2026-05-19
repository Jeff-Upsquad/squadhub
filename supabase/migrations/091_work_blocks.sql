-- ============================================================
-- Work Blocks: a focus-time task subtype.
--
-- A work block is a task (lives in lists / folders / spaces like any other)
-- with three extras:
--   1) a daily start/end time + recurrence rule (rendered on the day planner)
--   2) per-user run history (started_at / ended_at) — driven by the existing
--      per-task timer on the task detail panel
--   3) auto-collected completions: any task the running user marks done while
--      one of their work-block runs is active gets logged against that run
-- ============================================================

-- 1) Seed the work_block task type (system; not the default).
INSERT INTO task_types (key, name, description, icon, color, is_system, position)
VALUES (
  'work_block',
  'Work Block',
  'A planned focus session that auto-logs tasks you finish inside it.',
  'clock',
  '#8b5cf6',
  TRUE,
  10
)
ON CONFLICT (key) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  icon        = EXCLUDED.icon,
  color       = EXCLUDED.color;

-- 2) Per-task config (1:1 with a work_block task).
-- start_minute / end_minute are minute-of-day in the user's local tz, same
-- convention as task_day_plans.start_minute.
CREATE TABLE IF NOT EXISTS work_blocks (
  task_id           UUID PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  start_minute      INT  NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute        INT  NOT NULL CHECK (end_minute BETWEEN 1 AND 1440 AND end_minute > start_minute),
  -- Recurrence: JSONB so we can evolve without migrations.
  -- Shape: { "kind": "none"|"daily"|"weekdays"|"weekly"|"monthly",
  --          "weekdays": [0..6]?,        -- weekly only, 0=Sun..6=Sat
  --          "day_of_month": 1..28?,     -- monthly only
  --          "starts_on": "YYYY-MM-DD"?, -- inclusive
  --          "ends_on":   "YYYY-MM-DD"|null }
  recurrence        JSONB NOT NULL DEFAULT '{"kind":"none"}'::jsonb,
  notify_before_min SMALLINT NOT NULL DEFAULT 5 CHECK (notify_before_min BETWEEN 0 AND 60),
  notify_on_start   BOOLEAN  NOT NULL DEFAULT TRUE,
  notify_on_end     BOOLEAN  NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_blocks_recurrence_kind
  ON work_blocks ((recurrence->>'kind'));

-- 3) Run history (one row per Start→Stop on a work block task, by a user).
CREATE TABLE IF NOT EXISTS work_block_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,        -- NULL = currently running
  duration_seconds INT,                -- written on stop
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wb_runs_task ON work_block_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_wb_runs_user ON work_block_runs(user_id, started_at DESC);
-- At most one active run per user — mirrors the existing single-active-task-timer
-- invariant enforced client-side by usePMStore.timer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wb_runs_one_active_per_user
  ON work_block_runs(user_id) WHERE ended_at IS NULL;

-- 4) Auto-collected completions (tasks marked done while a run was active).
-- (run_id, completed_task_id) PK makes the recording idempotent — the client
-- can replay safely.
CREATE TABLE IF NOT EXISTS work_block_completions (
  run_id            UUID NOT NULL REFERENCES work_block_runs(id) ON DELETE CASCADE,
  completed_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  completed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, completed_task_id)
);
CREATE INDEX IF NOT EXISTS idx_wb_completions_task ON work_block_completions(completed_task_id);

-- 5) Per-task timer overlaps inside a run. When the user has a regular
-- per-task timer running AND a work-block run active, we record the overlap
-- here so the work block's detail panel can show "X hours on task Y during
-- this run." Unlike completions, this can include tasks the user did NOT
-- mark done — just ones they actively worked on.
CREATE TABLE IF NOT EXISTS work_block_task_times (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           UUID NOT NULL REFERENCES work_block_runs(id) ON DELETE CASCADE,
  task_id          UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,        -- NULL = still running
  duration_seconds INT,                -- written on close
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wb_task_times_run ON work_block_task_times(run_id);
CREATE INDEX IF NOT EXISTS idx_wb_task_times_task ON work_block_task_times(task_id);
-- At most one open task-time per (run, task) — keeps the "is this task
-- currently being timed inside this run?" predicate cheap.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wb_task_times_one_open
  ON work_block_task_times(run_id, task_id) WHERE ended_at IS NULL;

-- 6) Manually linked tasks ("Linked tasks" section of the detail panel).
CREATE TABLE IF NOT EXISTS work_block_links (
  work_block_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  linked_task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  linked_by          UUID NOT NULL REFERENCES users(id),
  position           INT  NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (work_block_task_id, linked_task_id),
  CHECK (work_block_task_id <> linked_task_id)
);
CREATE INDEX IF NOT EXISTS idx_wb_links_linked ON work_block_links(linked_task_id);

-- 7) updated_at trigger (reuses the function from migration 024).
DROP TRIGGER IF EXISTS trg_work_blocks_updated_at ON work_blocks;
CREATE TRIGGER trg_work_blocks_updated_at
  BEFORE UPDATE ON work_blocks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
