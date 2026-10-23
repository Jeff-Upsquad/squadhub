-- Cache the read-only "who would match" preview for a published broadcast card.
-- Populated lazily the first time an admin opens the card's recipients view (and
-- refreshable on demand) by calling SquadHire's match-preview webhook. Purely a
-- display cache: it never notifies talents or writes recipient rows — the real
-- audience is still materialized only at broadcast time.
--
-- Shape: { "count": <int>, "talents": [{ "talent_user_id": <uuid>, "talent_name": <text> }], "computed_at": <iso8601> }

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS squadhire_match_preview JSONB;
