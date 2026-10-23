-- ============================================================
-- 118: LMS "track" — Systems & Processes (SOP) section
--
-- Adds an orthogonal `track` axis to lms_items so the learning module can
-- surface SOP / "Systems & Processes" content (e.g. "How to use Inbox") as
-- its own section, separate from courses, while reusing the entire
-- lessons/blocks/upload/assignment/notification pipeline unchanged.
--
-- `track` is independent of `kind` ('post'|'course'): a SOP is normally a
-- kind='post' item on track='sop', but a track='sop' course is also valid.
-- Existing rows default to 'learning'. SOP rows differ only in (a) where they
-- render in the learner sidebar and (b) the progress chrome being hidden —
-- both purely presentational, driven off this flag. Access + the existing
-- lms_updated notification still flow through lms_assignments as today.
-- ============================================================

ALTER TABLE lms_items
  ADD COLUMN IF NOT EXISTS track TEXT NOT NULL DEFAULT 'learning'
  CHECK (track IN ('learning', 'sop'));

-- The admin library filters items by track, and the learner sidebar
-- partitions a user's (already small) assignment set by it, so a plain
-- btree on track keeps the admin list filter cheap.
CREATE INDEX IF NOT EXISTS idx_lms_items_track ON lms_items (track);

-- Make the new column visible to the PostgREST schema cache immediately
-- (the learner selects join lms_items via the Supabase client).
NOTIFY pgrst, 'reload schema';
