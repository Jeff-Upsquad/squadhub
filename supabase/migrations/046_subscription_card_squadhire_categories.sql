-- ============================================================
-- SquadHire category targeting on subscription cards
--
-- The admin picks one or more SquadHire category IDs when setting a card's
-- publish targeting. On publish, these IDs flow into match_rules.category_ids
-- in the outbound webhook payload. Empty array = skip publishing to SquadHire
-- (the outbound path short-circuits in buildSquadhirePayloadForCard).
--
-- No FK is declared — the referenced IDs live in SquadHire's separate
-- Supabase project. Data validity is enforced by the admin UI's picker
-- (which fetches the real list through a signed proxy) rather than at the DB.
-- Depends on 044, 045.
-- ============================================================

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS squadhire_category_ids UUID[] NOT NULL DEFAULT '{}';

-- GIN index so "find cards targeting category X" stays fast if we ever need
-- it (e.g. admin dashboards, analytics). Cheap to add now, easy to drop later.
CREATE INDEX IF NOT EXISTS idx_sub_cards_squadhire_categories_gin
  ON subscription_cards USING GIN (squadhire_category_ids);
