-- Track outbound webhook delivery for talent selection events.
-- The /assign endpoint stamps subscription_card_external_recipients.selected_at
-- and fires notifySquadhireOfSelection. Prior to this migration the webhook
-- was best-effort/single-attempt; with these columns we can persist failures
-- and a background sweeper can retry the same way it does for initial publish
-- (squadhire_synced_at on this table) and manual assignment (squadhire_notified_at
-- on subscription_card_external_recipients).
--
-- Existing assigned cards are left with squadhire_select_notified_at = NULL on
-- purpose: the sweeper's first tick will re-fire the webhook for each card in
-- state='assigned', which is a no-op on the receiver for already-synced cards
-- (Profiles' handleSelectionWebhook just rewrites the same selected_at value)
-- but heals the ones whose original webhook was lost.

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS squadhire_select_notified_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS squadhire_select_notify_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS squadhire_select_notify_error    TEXT;

CREATE INDEX IF NOT EXISTS idx_sc_select_notify_pending
  ON subscription_cards(assigned_at)
  WHERE state = 'assigned'
    AND squadhire_select_notified_at IS NULL
    AND squadhire_select_notify_attempts < 10;

NOTIFY pgrst, 'reload schema';
