-- ============================================================
-- Mark a Resources item as training for SquadHire talents
--
-- SquadHire talents are not SquadHub users — they live in a different product
-- with their own accounts — so they can't be reached through lms_item_shares.
-- An item flagged here is pushed to SquadHire on publish and shows up in their
-- Training Program.
--
-- Job-profile targeting stays on SquadHire's side: who a course reaches, what
-- it unlocks and whether it gates onboarding are decisions their admin makes,
-- and re-publishing from here must never overwrite them.
-- ============================================================

ALTER TABLE lms_items
  ADD COLUMN IF NOT EXISTS squadhire_audience BOOLEAN NOT NULL DEFAULT FALSE;

-- Only flagged items are ever considered for delivery, so the partial index is
-- what the sync actually queries.
CREATE INDEX IF NOT EXISTS idx_lms_items_squadhire_audience
  ON lms_items(id) WHERE squadhire_audience = TRUE;

-- Delivery bookkeeping, mirroring the card/job webhook columns so a failed
-- push is visible rather than silent.
ALTER TABLE lms_items
  ADD COLUMN IF NOT EXISTS squadhire_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS squadhire_last_error TEXT;

COMMENT ON COLUMN lms_items.squadhire_audience IS
  'When true, this item is delivered to SquadHire as talent training on publish.';

NOTIFY pgrst, 'reload schema';
