-- Track outbound webhook delivery for the admin Finalize action.
-- /admin/subscription-cards/:id/finalize-selection sets selected_recipient_id
-- (moving the card from "Selected" to "Assigned" bucket in admin) and fires
-- notifySquadhireOfActivation. Mirrors migration 079 for selection delivery:
-- inline 3-attempt retry + 5-min background sweeper persist their state here.

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS squadhire_activation_notified_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS squadhire_activation_notify_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS squadhire_activation_notify_error    TEXT;

CREATE INDEX IF NOT EXISTS idx_sc_activation_notify_pending
  ON subscription_cards(updated_at)
  WHERE selected_recipient_id IS NOT NULL
    AND squadhire_activation_notified_at IS NULL
    AND squadhire_activation_notify_attempts < 10;

NOTIFY pgrst, 'reload schema';
