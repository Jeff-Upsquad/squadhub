-- ============================================================
-- 099: Lesson-level audience overrides
--
-- Course audience (lms_item_audience_*) decides WHO is enrolled.
-- These tables optionally NARROW visibility per lesson:
--   - a lesson with NO audience rows -> visible to everyone enrolled
--   - a lesson WITH audience rows     -> visible only to matching
--     user_types OR explicitly listed users (fully hidden from the rest)
-- Visibility is applied at read time; it never changes enrollment.
--
-- Also widens lms_item_audience_types to allow 'partner_employee'
-- (migration 055 added it to users/invitations but missed this table,
--  so ticking "Partner employees" on a course audience used to fail).
-- ============================================================

BEGIN;

-- Fix: allow partner_employee as a course audience type
ALTER TABLE lms_item_audience_types
  DROP CONSTRAINT IF EXISTS lms_item_audience_types_user_type_check;
ALTER TABLE lms_item_audience_types
  ADD CONSTRAINT lms_item_audience_types_user_type_check
  CHECK (user_type IN ('internal', 'client', 'client_staff', 'partner', 'partner_employee'));

-- Per-lesson audience: user types
CREATE TABLE IF NOT EXISTS lms_lesson_audience_types (
  lesson_id UUID NOT NULL REFERENCES lms_lessons(id) ON DELETE CASCADE,
  user_type TEXT NOT NULL
    CHECK (user_type IN ('internal', 'client', 'client_staff', 'partner', 'partner_employee')),
  PRIMARY KEY (lesson_id, user_type)
);

-- Per-lesson audience: specific users
CREATE TABLE IF NOT EXISTS lms_lesson_audience_users (
  lesson_id UUID NOT NULL REFERENCES lms_lessons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (lesson_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lms_lesson_audience_users_user
  ON lms_lesson_audience_users(user_id);

COMMIT;

NOTIFY pgrst, 'reload schema';
