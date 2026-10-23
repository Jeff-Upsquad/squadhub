-- ============================================================
-- Migration 170: Notion-style nested pages for LMS items
--
-- Turns the flat lms_lessons list into a tree so an SOP (or course)
-- can have pages, sub-pages and sub-sub-pages to any depth — the
-- "Notion page" experience. Also adds an optional emoji icon to both
-- items and lessons (pages) for the tree/reader UI.
--
--   • lms_lessons.parent_lesson_id — self-FK; NULL = top-level page.
--     ON DELETE CASCADE so deleting a page removes its whole subtree.
--   • lms_lessons.icon / lms_items.icon — short emoji string, nullable.
--
-- Ordering stays on the existing `position` column, now interpreted as
-- position WITHIN a parent (siblings ordered by position).
-- ============================================================

ALTER TABLE lms_lessons
  ADD COLUMN IF NOT EXISTS parent_lesson_id UUID
    REFERENCES lms_lessons(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS icon TEXT;

ALTER TABLE lms_items
  ADD COLUMN IF NOT EXISTS icon TEXT;

-- Fetch a parent's children in order, and guard the tree lookups.
CREATE INDEX IF NOT EXISTS idx_lms_lessons_parent
  ON lms_lessons(parent_lesson_id, position);
