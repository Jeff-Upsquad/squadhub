-- Track outbound webhook delivery for talent-acceptance events.
-- The /admin/subscription-cards/:id/auto-accept-talent endpoint stamps
-- subscription_card_external_recipients to status='accepted' and fires
-- notifySquadhireOfTalentAcceptance. Prior to this migration the webhook
-- was best-effort/single-attempt with no audit trail; with these columns
-- we can persist failures and a background sweeper retries the same way
-- it does for manual assignment (squadhire_notified_at on this table)
-- and selection (squadhire_select_notified_at on subscription_cards).
--
-- Existing accepted rows are left with squadhire_acceptance_notified_at
-- = NULL on purpose: the sweeper's first tick will re-fire the webhook
-- for each row, which is a no-op on the receiver for already-mirrored
-- acceptances (Profiles' handleTalentAcceptedByWebhook returns
-- alreadyAccepted: true) but heals the ones whose original webhook was
-- lost — including the in-flight Nidhin Baburajan / CA Mohammed Riyas
-- case that motivated this migration.

ALTER TABLE subscription_card_external_recipients
  ADD COLUMN IF NOT EXISTS squadhire_acceptance_notified_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS squadhire_acceptance_notify_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS squadhire_acceptance_notify_error    TEXT;

CREATE INDEX IF NOT EXISTS idx_scer_acceptance_notify_pending
  ON subscription_card_external_recipients(created_at)
  WHERE status = 'accepted'
    AND squadhire_acceptance_notified_at IS NULL
    AND squadhire_acceptance_notify_attempts < 10;

NOTIFY pgrst, 'reload schema';
