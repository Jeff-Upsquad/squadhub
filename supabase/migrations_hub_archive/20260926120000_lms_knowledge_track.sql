-- ============================================================
-- LMS "knowledge" track — Squad Bot's Knowledge Center
--
-- A third track beside 'learning' and 'sop'. Knowledge items are reference
-- Q&As and guides that SquadHire's Squad Bot uses to answer talents; every
-- published one is pushed to SquadHire (no squadhire_audience flag needed).
--
-- knowledge_categories: which talents it's for — 'general', 'tech', or a
-- SquadHire talent category slug (designer, accountant, …). The list is served
-- live by SquadHire, so a new talent category needs no change here.
-- ============================================================

ALTER TABLE lms_items DROP CONSTRAINT IF EXISTS lms_items_track_check;
ALTER TABLE lms_items
  ADD CONSTRAINT lms_items_track_check CHECK (track IN ('learning', 'sop', 'knowledge'));

ALTER TABLE lms_items
  ADD COLUMN IF NOT EXISTS knowledge_categories TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN lms_items.knowledge_categories IS
  'Knowledge track only: general | tech | SquadHire talent category slugs.';

NOTIFY pgrst, 'reload schema';
