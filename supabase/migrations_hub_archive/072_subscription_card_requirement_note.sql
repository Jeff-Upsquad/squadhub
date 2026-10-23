-- ============================================================
-- Subscription cards: capture a free-text "what we need from
-- the talent" note, separate from notes (about the business).
-- Admin-only field — not surfaced to partner / talent / client
-- views or the SquadHire payload.
-- ============================================================

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS requirement_note TEXT;
