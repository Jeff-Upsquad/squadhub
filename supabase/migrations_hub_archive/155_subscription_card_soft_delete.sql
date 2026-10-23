-- 155_subscription_card_soft_delete.sql
-- Soft-delete for subscription cards.
--
-- Deleting a draft/archived card used to be a hard DELETE — the row vanished
-- and could never be recovered. Now the admin "delete" sets deleted_at (and
-- records who did it in deleted_by) so the card lands in the admin Trash,
-- where it can be Restored or Deleted forever — exactly like spaces, folders,
-- lists, and channels (migration 006).

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Partial index for the Trash query (deleted cards are a tiny slice of the table).
CREATE INDEX IF NOT EXISTS idx_subscription_cards_deleted
  ON subscription_cards(deleted_at) WHERE deleted_at IS NOT NULL;
