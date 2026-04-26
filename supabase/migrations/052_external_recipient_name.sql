-- ============================================================
-- 051_external_recipient_name.sql
--
-- Persist the talent's display name from SquadHire callback so the Sales
-- Leads "Published cards" side panel can show real names instead of opaque
-- IDs. Nullable so callbacks from older SquadHire deploys (and existing rows)
-- keep working — the UI falls back to external_user_id when null.
-- ============================================================

ALTER TABLE subscription_card_external_recipients
  ADD COLUMN IF NOT EXISTS talent_name TEXT NULL;
