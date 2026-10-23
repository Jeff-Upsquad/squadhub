-- ============================================================
-- 111: LMS assignment due dates
--
-- Adds an optional deadline to course/post assignments. The Home
-- "Courses" secondary card surfaces a user's non-completed assignments
-- whose due_date is today or overdue (computed per-request in the
-- caller's timezone, mirroring /pm/tasks/my). NULL = no deadline, so the
-- assignment never appears on the card.
-- ============================================================

ALTER TABLE lms_assignments ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ;

-- The card query filters by (user_id, status) and then date-buckets the
-- small per-user result set, so a partial index on dated, open assignments
-- keeps that scan cheap.
CREATE INDEX IF NOT EXISTS idx_lms_assignments_due
  ON lms_assignments (user_id, due_date)
  WHERE due_date IS NOT NULL AND status <> 'completed';
