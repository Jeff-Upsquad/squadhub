-- ============================================================
-- 143: Squad Clips — soft delete for recoverable learning clips
-- When a clip that has a learning embed link (lms_enabled) is
-- deleted from the Squad Clips library, it is soft-deleted
-- (deleted_at set, R2 objects kept) instead of hard-deleted, so
-- it can be recovered from the Admin Panel (Learning → Deleted
-- Clips). Non-learning clips still hard-delete.
-- Owned by the Squad Clips app (separate repo, service role).
-- ============================================================

ALTER TABLE clips ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_clips_deleted_at
  ON clips(deleted_at) WHERE deleted_at IS NOT NULL;
