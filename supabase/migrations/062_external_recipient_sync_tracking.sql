-- Track outbound webhook delivery for manually-assigned external recipients.
-- Mirrors the sync-tracking columns on subscription_cards (migration 047).

ALTER TABLE subscription_card_external_recipients
  ADD COLUMN IF NOT EXISTS squadhire_notified_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS squadhire_notify_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS squadhire_notify_error    TEXT;

CREATE INDEX IF NOT EXISTS idx_scer_notify_pending
  ON subscription_card_external_recipients(created_at)
  WHERE assigned_manually = true
    AND squadhire_notified_at IS NULL
    AND squadhire_notify_attempts < 10;

NOTIFY pgrst, 'reload schema';
