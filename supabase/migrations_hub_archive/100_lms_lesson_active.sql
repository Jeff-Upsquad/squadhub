-- Lesson active/inactive flag.
-- Inactive lessons are hidden from every learner-facing view (filtered in the
-- /lms/items/:id endpoint) but stay visible and editable in the admin Learning
-- editor. Existing lessons default to active so nothing disappears on rollout.
ALTER TABLE lms_lessons
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
