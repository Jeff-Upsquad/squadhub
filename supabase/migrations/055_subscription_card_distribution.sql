-- ============================================================
-- 055: subscription_card_distribution
--
-- Adds a "distribution" mode to subscription_cards so a card can be
-- published without auto-fanning out to partners or being broadcast
-- to talents. Two modes:
--
--   broadcast (default, existing behavior) — at publish time, the
--     server inserts subscription_card_recipients rows for every
--     matching partner, AND SquadHire broadcasts the card to its
--     talents.
--
--   manual — at publish time, no fan-out. The card is still flipped
--     to state='published' and the SquadHire webhook is still fired
--     (so it appears in SquadHire's admin Published Cards list), but
--     SquadHire is told via the same payload's `distribution` field
--     not to broadcast to talents. From either side an admin then
--     hand-picks specific partners or talents via the assign endpoints
--     in subscription-cards-admin-assign.ts (SquadHub) or the
--     equivalent flow in SquadHire.
--
-- assigned_manually flags whether a recipient row arrived via the
-- hand-pick flow vs. the broadcast fan-out. Used for the badge in
-- the admin recipients panel and for downstream analytics.
-- ============================================================

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS distribution TEXT NOT NULL DEFAULT 'broadcast'
  CHECK (distribution IN ('broadcast','manual'));

ALTER TABLE subscription_card_recipients
  ADD COLUMN IF NOT EXISTS assigned_manually BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE subscription_card_external_recipients
  ADD COLUMN IF NOT EXISTS assigned_manually BOOLEAN NOT NULL DEFAULT false;

-- The existing external recipients table only modelled inbound talent
-- responses (accepted/rejected with a non-null responded_at). For
-- SquadHub-initiated manual assignments we need a row that says "we
-- invited this talent; no response yet". Relax both constraints.
ALTER TABLE subscription_card_external_recipients
  DROP CONSTRAINT IF EXISTS subscription_card_external_recipients_status_check;
ALTER TABLE subscription_card_external_recipients
  ADD CONSTRAINT subscription_card_external_recipients_status_check
  CHECK (status IN ('pending','accepted','rejected'));

ALTER TABLE subscription_card_external_recipients
  ALTER COLUMN responded_at DROP NOT NULL;

-- Partial index supports the admin "Soft Published" filter — most
-- queries that care about distribution are scoped to published cards.
CREATE INDEX IF NOT EXISTS idx_subscription_cards_distribution
  ON subscription_cards(distribution) WHERE state = 'published';

NOTIFY pgrst, 'reload schema';
