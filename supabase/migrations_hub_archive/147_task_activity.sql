-- ============================================================
-- 147: Task activity log (unified change history for a task)
-- ============================================================
-- The task detail "Activity" feed was a 3-item composite (comments + current
-- status + creation) derived from tasks.updated_at, with no record of WHO
-- changed WHAT field or WHEN. This table appends one row per meaningful event
-- so the detail panel can render a real history:
--   "Jeff changed priority Normal -> High", "Asha added assignee Meera", ...
--
-- Generalises the single-purpose task_estimate_changes table (migration 134):
-- that captured only time_estimate; this captures every tracked field plus
-- assignee/label/attachment/move/creation events. Estimate history is folded
-- into the same feed at read time (the read endpoint unions both), so 134 stays
-- as-is and its existing rows still surface.
--
-- Written only by the server (PM task routes) via the service-role client, which
-- bypasses RLS. workspace_id is best-effort: populated when the task's
-- list -> space -> workspace chain resolves, NULL otherwise, so an event is
-- never dropped just because the workspace lookup failed.

CREATE TABLE task_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- actor; NULL if system/unknown
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  -- High-level kind of event. 'field_change' carries `field`; the others are
  -- self-describing add/remove/lifecycle events.
  --   field_change | created | subtask_added | moved
  --   assignee_added | assignee_removed | label_added | label_removed
  --   attachment_added
  event_type TEXT NOT NULL,
  -- For event_type='field_change': which scalar field moved
  --   ('title','description','status','priority','due_date','work_date',
  --    'start_date','task_type_id','time_estimate'). NULL for non-field events.
  field TEXT,
  -- Flexible payload. Scalars store {"value": ...}; entity events store
  -- {"id": ..., "name": ...} so the feed reads naturally even if the entity is
  -- later renamed or deleted (the name is snapshotted at event time).
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Detail panel reads newest-first for one task.
CREATE INDEX idx_task_activity_task ON task_activity(task_id, created_at DESC);
-- "What has this user been doing" style queries.
CREATE INDEX idx_task_activity_user ON task_activity(user_id, created_at DESC);

-- Service-role writes/reads only; the GET /pm/tasks/:id/activity endpoint
-- enforces task-member access in application code (checkResourceAccess), the
-- same way every other PM route does. Enable RLS with no policies so direct
-- anon/authenticated access is denied by default.
ALTER TABLE task_activity ENABLE ROW LEVEL SECURITY;
