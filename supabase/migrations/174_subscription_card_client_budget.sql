-- The client's stated budget from a brief, kept SEPARATE from proposed_price.
-- Previously the budget was written straight into proposed_price, conflating
-- "what the client said they'd pay" with "what we propose to charge". Now the
-- brief budget lands here (read-only reference in the New Deals editor) and the
-- admin sets proposed_price themselves before publishing.
--
-- Single-tier / assignment briefs store the scalar here; multi-tier briefs also
-- carry a per-tier `client_budget` inside the tier_pricing JSONB entries.
ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS client_budget integer;

ALTER TABLE subscription_cards
  DROP CONSTRAINT IF EXISTS chk_client_budget;
ALTER TABLE subscription_cards
  ADD CONSTRAINT chk_client_budget CHECK (client_budget IS NULL OR client_budget > 0);

COMMENT ON COLUMN subscription_cards.client_budget IS
  'The client''s stated monthly budget from their brief (₹). Read-only reference shown in the New Deals editor; distinct from proposed_price, which the admin sets. Per-tier budgets also live under tier_pricing.<tier>.client_budget.';
