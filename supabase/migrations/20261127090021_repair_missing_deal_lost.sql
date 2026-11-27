-- Repair the missing legacy Deal Lost field on the migrated production database.
-- Do not replay migration 186 or change historical migration ledger entries.
ALTER TABLE public.subscription_cards
  ADD COLUMN IF NOT EXISTS deal_lost_at TIMESTAMPTZ;

COMMENT ON COLUMN public.subscription_cards.deal_lost_at IS
  'Sales outcome: set when an admin marks the deal lost. The card shows under Deal Lost instead of Cancelled. NULL = not marked.';

CREATE INDEX IF NOT EXISTS idx_subscription_cards_deal_lost
  ON public.subscription_cards(deal_lost_at)
  WHERE deal_lost_at IS NOT NULL;
