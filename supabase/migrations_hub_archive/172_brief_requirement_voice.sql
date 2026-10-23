-- Voice note captured on the client brief form (/connect, admin ClientBriefForm).
-- Stored per subscription_cards row (one per role) alongside requirement_note,
-- and forwarded to SquadHire so talent can listen before accepting.
ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS requirement_voice_url text;

COMMENT ON COLUMN subscription_cards.requirement_voice_url IS
  'Public R2 URL of the client''s recorded requirement voice note (optional). Companion to requirement_note.';
