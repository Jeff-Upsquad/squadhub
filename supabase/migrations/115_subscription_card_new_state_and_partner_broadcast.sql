-- ============================================================
-- 115: New-deal lifecycle + staged partner broadcast.
--
-- Two additive, backward-compatible changes that power the redesigned
-- brief pipeline (New Deals → Draft → Publish/Soft-publish → Broadcast):
--
-- 1. A 'new' state that sits BEFORE 'draft'. Submitted briefs land as
--    'new' in the New Deals queue. The admin fills in the rest of the
--    details and "Save Draft" promotes new → draft, which is what unlocks
--    the shareable client link (link generation is already draft-gated).
--
-- 2. A `broadcast_at` column on subscription_card_recipients — the partner
--    twin of external_recipients.notified_at (migration 072). Publishing
--    now MATCHES partners into a staged list with broadcast_at = NULL
--    (invisible to the partner); the separate "Broadcast" action stamps
--    broadcast_at = now to release them into the partner opportunities feed.
--
--    Backfill existing rows with created_at so every already-matched
--    partner stays visible — i.e. the old "matched = immediately visible"
--    behavior is preserved for in-flight cards.
-- ============================================================

-- 1. Widen the state CHECK to include 'new'.
ALTER TABLE subscription_cards
  DROP CONSTRAINT IF EXISTS subscription_cards_state_check;

ALTER TABLE subscription_cards
  ADD CONSTRAINT subscription_cards_state_check
    CHECK (state IN ('new', 'draft', 'published', 'assigned', 'closed'));

-- 2. Staged partner broadcast gate.
ALTER TABLE subscription_card_recipients
  ADD COLUMN IF NOT EXISTS broadcast_at TIMESTAMPTZ;

UPDATE subscription_card_recipients
   SET broadcast_at = created_at
 WHERE broadcast_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_scr_card_broadcast_at
  ON subscription_card_recipients(card_id, broadcast_at);
