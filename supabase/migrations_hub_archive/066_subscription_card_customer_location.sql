-- ============================================================
-- Subscription cards: capture the customer's business location
-- ============================================================
-- Free-text "where the customer's business operates from" so the
-- talent has that context up front. Distinct from target_country/
-- target_regions which describe where we should source talent FROM.

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS customer_location TEXT;
