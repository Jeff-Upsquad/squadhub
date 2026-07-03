-- 152_assignment_term_plan_snapshot.sql
-- Freeze the plan + resolved pricing onto each assignment term.
--
-- Billing and the design/video-space Reports read committed hours + price from
-- the card's single mutable plan_snapshot. That's fine while a card has exactly
-- one plan for its whole life, but breaks the moment we allow an in-place plan
-- change (upgrade/downgrade): every earlier term would silently reprice to the
-- new plan and historical billing would be wrong.
--
-- Fix: stamp the plan snapshot + resolved amounts onto each term when it opens.
-- Consumers prefer these term-level values and fall back to the card's live
-- plan_snapshot for legacy terms where they're null.

ALTER TABLE subscription_assignment_terms
  ADD COLUMN IF NOT EXISTS plan_snapshot      JSONB,
  ADD COLUMN IF NOT EXISTS partner_price      INTEGER,
  ADD COLUMN IF NOT EXISTS subscription_price INTEGER,
  ADD COLUMN IF NOT EXISTS currency           TEXT;

-- Backfill existing terms from their card's frozen snapshot + finalized client
-- price. partner_price / currency stay null so billing falls back to the card
-- computation (correct for these pre-change terms, which map 1:1 to their card's
-- single plan).
UPDATE subscription_assignment_terms t
SET plan_snapshot      = c.plan_snapshot,
    subscription_price = c.subscription_price
FROM subscription_cards c
WHERE t.card_id = c.id
  AND t.plan_snapshot IS NULL;
