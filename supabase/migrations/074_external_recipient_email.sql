-- Adds talent registration email to subscription_card_external_recipients.
-- The /admin/subscription-cards/:id/auto-accept-talent endpoint resolves a
-- SquadHire talent_user_id back to a SquadHub user by email match. Storing
-- email at /assign-talent time means manually-assigned recipients (Manual
-- badge) get the same Auto-accept treatment without needing a SquadHire
-- round-trip at click time.
--
-- Nullable because old rows have no email and a SquadHire account isn't
-- guaranteed to expose one. The Auto-accept gate already handles the
-- email-missing case by hiding the button.
ALTER TABLE subscription_card_external_recipients
  ADD COLUMN IF NOT EXISTS email TEXT;
