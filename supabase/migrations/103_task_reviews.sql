-- Per-user "I've reviewed this task" flag, powering the My Home "New Tasks" card.
--
-- The New Tasks card surfaces open tasks the user is an assignee of, plus open
-- tasks they created that are still unassigned. Ticking "Review" in the full-page
-- popup marks the task reviewed FOR THAT USER, dropping it from the card. It stays
-- recoverable via the popup's "Show reviewed" toggle (DELETE removes the row to
-- un-review).
--
-- Per-user (not a flag on tasks) so the same task can be reviewed independently by
-- its creator and each assignee.
CREATE TABLE IF NOT EXISTS task_reviews (
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_reviews_user ON task_reviews(user_id);

-- Only the server (service role) touches this table; enable RLS with no policy
-- so there's no direct anon/authenticated access.
ALTER TABLE task_reviews ENABLE ROW LEVEL SECURITY;
