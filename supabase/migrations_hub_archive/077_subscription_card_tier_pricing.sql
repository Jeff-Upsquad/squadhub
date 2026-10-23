-- ============================================================
-- Subscription Cards: per-tier pricing for fan-out on publish.
--
-- The admin Card editor lets a draft target multiple tiers at
-- once (Junior + Pro + Elite). On publish, the draft is fanned
-- out to N independent published cards — one per selected tier
-- — each with its own price. Existing tier-overlap matching
-- (matchPartnersForCard) then routes each card only to that
-- tier's partners.
--
-- tier_pricing carries the per-tier prices on the DRAFT row and
-- is cleared at publish (each tier's values are copied onto its
-- own subscription_cards row's proposed_price / markup). Empty
-- {} on single-tier and post-publish rows.
--
-- Shape:
--   {"Junior": {"proposed_price": 12000, "markup": 2000},
--    "Pro":    {"proposed_price": 18000, "markup": 3000}, ...}
-- ============================================================

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS tier_pricing JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN subscription_cards.tier_pricing IS
  'Draft-only per-tier pricing map. Cleared at publish; each tier''s values are copied onto its own subscription_cards row''s proposed_price / markup as part of fan-out.';
