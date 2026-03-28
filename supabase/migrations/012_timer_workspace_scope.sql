-- ============================================================
-- 012: Scope timers to workspace + context
-- ============================================================

-- Add workspace_id and context to timer_sessions
ALTER TABLE timer_sessions
  ADD COLUMN workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  ADD COLUMN context TEXT NOT NULL DEFAULT 'default';

-- Add workspace_id and context to daily_time_summaries
ALTER TABLE daily_time_summaries
  DROP CONSTRAINT daily_time_summaries_user_id_date_key;

ALTER TABLE daily_time_summaries
  ADD COLUMN workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  ADD COLUMN context TEXT NOT NULL DEFAULT 'default';

ALTER TABLE daily_time_summaries
  ADD CONSTRAINT daily_time_summaries_user_workspace_context_date_key UNIQUE(user_id, workspace_id, context, date);

-- Update indexes
DROP INDEX IF EXISTS idx_timer_sessions_active;
CREATE INDEX idx_timer_sessions_active ON timer_sessions(user_id, workspace_id, context) WHERE end_time IS NULL;

CREATE INDEX idx_timer_sessions_workspace ON timer_sessions(workspace_id);
CREATE INDEX idx_daily_time_summaries_workspace ON daily_time_summaries(workspace_id);
