-- ============================================================
-- 134: Task estimate change history (audit trail for time_estimate)
-- ============================================================
-- tasks.time_estimate is a single mutable column with no record of who set it
-- or when. This table appends one row per estimate change (old -> new, who,
-- when) so the full authorship trail is preserved — mirroring how
-- task_time_entries records every logged-time session (migration 040).
--
-- Written only by the server (PUT /pm/tasks/:id) via the service-role client,
-- which bypasses RLS. workspace_id is best-effort: populated when the task's
-- list -> space -> workspace chain resolves, NULL otherwise, so an audit row is
-- never dropped just because workspace lookup failed.

CREATE TABLE task_estimate_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  old_estimate INTEGER,  -- minutes; NULL = estimate was previously unset
  new_estimate INTEGER,  -- minutes; NULL = estimate was cleared
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_estimate_changes_task ON task_estimate_changes(task_id, created_at DESC);
CREATE INDEX idx_task_estimate_changes_user ON task_estimate_changes(user_id, created_at DESC);

-- Service-role writes/reads only. No client-facing read path exists yet; enable
-- RLS with no policies so direct anon/authenticated access is denied by default.
-- A task-member-scoped SELECT policy can be added when a history UI is built.
ALTER TABLE task_estimate_changes ENABLE ROW LEVEL SECURITY;
