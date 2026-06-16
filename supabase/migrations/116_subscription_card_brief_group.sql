-- Multi-tier briefs publish as N independent sibling cards (one per tier) via
-- fanOutTierCards(). The siblings were deliberately unlinked (parent_card_id
-- NULL) so SquadHire surfaced them all. That makes the admin Published view
-- show three separate cards for one brief.
--
-- brief_group_id links the per-tier siblings back together: one shared UUID
-- stamped on the repurposed original AND every sibling at publish. The admin
-- Published view collapses cards sharing a brief_group_id into a single card
-- with per-tier tabs, and the same id is forwarded over the SquadHire webhook
-- so the business portal / talent app can group on it too.
--
-- NULL for single-tier and legacy cards — they render exactly as before.

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS brief_group_id UUID;

COMMENT ON COLUMN subscription_cards.brief_group_id IS
  'Shared id linking the per-tier sibling cards fanned out from one multi-tier brief at publish. NULL for single-tier / legacy cards. Lets the admin Published view and SquadHire collapse the tier siblings into one card with per-tier tabs.';

CREATE INDEX IF NOT EXISTS subscription_cards_brief_group_id_idx
  ON subscription_cards (brief_group_id)
  WHERE brief_group_id IS NOT NULL;
