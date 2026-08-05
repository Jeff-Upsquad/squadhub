-- ============================================================
-- Migration 171: Per-page (lesson) access overrides
--
-- A page/chapter inherits the item's sharing (lms_item_shares) by default.
-- This table lets an author HIDE a specific page from specific roles or users
-- without changing the item's overall sharing — "same as the main one, or
-- hidden from specific users or roles".
--
-- Presence of a row = that principal is EXCLUDED from that page. `mode` is kept
-- for forward-compat (a future 'include'-only mode) but only 'exclude' is used.
--
-- Draft pages are handled by the existing lms_lessons.is_active flag
-- (is_active = false → hidden from learners); new pages now default to draft
-- in application code.
-- ============================================================
CREATE TABLE IF NOT EXISTS lms_lesson_access_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES lms_lessons(id) ON DELETE CASCADE,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'role')),
  principal_id UUID NOT NULL,
  mode TEXT NOT NULL DEFAULT 'exclude' CHECK (mode IN ('exclude')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lesson_id, principal_type, principal_id)
);

CREATE INDEX IF NOT EXISTS idx_lms_lesson_over_lesson ON lms_lesson_access_overrides(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lms_lesson_over_principal ON lms_lesson_access_overrides(principal_type, principal_id);
