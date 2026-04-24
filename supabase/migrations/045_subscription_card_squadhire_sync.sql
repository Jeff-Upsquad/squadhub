-- ============================================================
-- Subscription Card ↔ SquadHire sync
--
-- On publish, a card is POSTed to SquadHire's inbound webhook
-- (POST /api/webhooks/squadhub/cards). The delivery is retried inline a
-- few times and then by a background sweeper, so we persist attempt
-- state on the card row itself (no separate outbox table needed for v1).
--
-- Talent accept/reject responses from SquadHire arrive as callbacks
-- (POST /integrations/squadhire/card-responses) and are recorded in
-- `subscription_card_external_recipients`, kept separate from
-- `subscription_card_recipients` which is for SquadHub partners only.
-- Depends on 044.
-- ============================================================

-- ------------------------------------------------------------
-- Outbound sync observability on the card row itself.
-- All columns are nullable / default-safe so existing rows are unaffected.
-- ------------------------------------------------------------
ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS squadhire_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS squadhire_sync_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS squadhire_sync_last_error TEXT,
  ADD COLUMN IF NOT EXISTS squadhire_recipient_count INTEGER;

-- Partial index used by the outbound sweeper: find published cards that
-- still need syncing, bounded by max-attempts.
CREATE INDEX IF NOT EXISTS idx_sub_cards_squadhire_pending
  ON subscription_cards(state, squadhire_synced_at, squadhire_sync_attempts)
  WHERE state = 'published' AND squadhire_synced_at IS NULL;

-- ------------------------------------------------------------
-- External recipients — SquadHire talent responses, fed in by callback.
--
-- One row per (card, external recipient id) — the external_recipient_id is
-- SquadHire's own recipient row id, which gives us idempotency on replay of
-- the callback. We don't pre-create rows on publish; they appear only when a
-- talent actually responds.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_card_external_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES subscription_cards(id) ON DELETE CASCADE,
  external_system TEXT NOT NULL DEFAULT 'squadhire'
    CHECK (external_system IN ('squadhire')),
  external_recipient_id TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('accepted', 'rejected')),
  responded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (card_id, external_system, external_recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_scer_card
  ON subscription_card_external_recipients(card_id);

CREATE INDEX IF NOT EXISTS idx_scer_status
  ON subscription_card_external_recipients(card_id, status);

DROP TRIGGER IF EXISTS trg_scer_updated_at ON subscription_card_external_recipients;
CREATE TRIGGER trg_scer_updated_at
  BEFORE UPDATE ON subscription_card_external_recipients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- RLS: service role bypasses; no client-facing policies. External recipient
-- rows are only read by SquadHub admins via server routes.
-- ------------------------------------------------------------
ALTER TABLE subscription_card_external_recipients ENABLE ROW LEVEL SECURITY;
