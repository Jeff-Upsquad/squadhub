-- ============================================================
-- 072: Track when each manually-assigned talent was actually
-- broadcast to. On soft-published (manual) cards, admins now
-- queue talents and release them in batches via the
-- "Broadcast to below users" action; `notified_at` records
-- when each row was released.
--
-- - NULL  -> queued, not yet sent to SquadHire
-- - non-NULL -> sent at this moment (rows in the same batch
--   share an exact timestamp so the UI can group them).
--
-- Backfill existing rows with `created_at` so they all show as
-- already broadcast in their historical groups (matches the
-- pre-staged behavior where assignment immediately notified).
-- ============================================================

ALTER TABLE subscription_card_external_recipients
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

UPDATE subscription_card_external_recipients
   SET notified_at = created_at
 WHERE notified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_scer_card_notified_at
  ON subscription_card_external_recipients(card_id, notified_at);
