-- ============================================================
-- 149: Elapsed time entries (idle-day plan consumption)
-- ============================================================
-- Design / Video-Editor spaces bill a client against a subscription plan that
-- grants a fixed number of daily/weekly/monthly hours. Actual tracked time
-- (timers -> task_time_entries) only captures days where work happened; on a
-- day with NO active work the retainer hours are still consumed but the report
-- shows 0h. "Elapsed time" fills that gap.
--
-- A cron (server/src/cron/elapsed-time-cron.ts) runs twice a working day in IST:
--   - 12:01 pm: if the space has no active tasks, elapse HALF the daily hours
--               (stage='midday')
--   - 03:00 pm: if still no active tasks, elapse the remaining half
--               (stage='afternoon')
-- The two checks are independent and, once written, stay for the day. Squad
-- managers / admins can override (stage='manual') or remove a day's entries from
-- the Reports tab.
--
-- One row per (folder, IST date, stage). Scoped to the design/video SPACE folder
-- (subscription_cards.linked_folder_id), not to any task -- elapsed time has no
-- task_id. Kept separate from task_time_entries / tasks.time_tracked so it never
-- pollutes the actual-time aggregates and stays independently editable.

CREATE TABLE elapsed_time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The design/video space folder (subscription_cards.linked_folder_id).
  folder_id UUID NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  -- For report scoping; resolved from the folder's space at write time.
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  -- IST calendar day this elapsed time belongs to.
  date DATE NOT NULL,
  -- Which checkpoint produced the row:
  --   midday    -> 12:01 pm auto half-day
  --   afternoon -> 03:00 pm auto remaining half
  --   manual    -> a manager/admin override for the day
  stage TEXT NOT NULL CHECK (stage IN ('midday', 'afternoon', 'manual')),
  -- Elapsed seconds (a 1h/day plan -> 1800 per auto stage).
  seconds INTEGER NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  -- auto = written by the cron; manual = written by a manager/admin.
  source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  -- Actor for manual rows; NULL for cron-written rows.
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency: the cron upserts ON CONFLICT DO NOTHING so re-runs never double
-- count, and a manual override is one row per day.
CREATE UNIQUE INDEX idx_elapsed_time_entries_folder_date_stage
  ON elapsed_time_entries (folder_id, date, stage);

-- Reports read a folder's elapsed time across a date window.
CREATE INDEX idx_elapsed_time_entries_folder_date
  ON elapsed_time_entries (folder_id, date);

-- Written/read only by the server via the service-role client (cron + PM folder
-- routes), which bypasses RLS. The edit/read endpoints enforce folder access +
-- the can_edit_elapsed_time permission in application code, matching every other
-- PM route. Enable RLS with no policies so direct anon/authenticated access is
-- denied by default.
ALTER TABLE elapsed_time_entries ENABLE ROW LEVEL SECURITY;
