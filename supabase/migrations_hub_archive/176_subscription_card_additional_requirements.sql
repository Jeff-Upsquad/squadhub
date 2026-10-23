-- Optional "additional requirements" a business attaches to a brief: specific
-- skills / software / AI tools they'd like the talent to have. Descriptive only
-- — surfaced on the talent's card and compared (presence) against accepted
-- talents for the business's reference. It is NEVER read by the broadcast
-- matcher / match_rules, so it does not affect who a card is broadcast to.
--
-- Shape: { "<group>": ["<label>", …] }, e.g.
--   { "skills": ["Bookkeeping", "GST / VAT filing"], "tools": ["QuickBooks"] }
-- Group keys are stable slugs ('skills' | 'tools' | 'ai_tools' | …); values mix
-- catalog picks and custom free-text. NULL / empty object = feature off.
ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS additional_requirements jsonb;

COMMENT ON COLUMN subscription_cards.additional_requirements IS
  'Optional skills/tools requested on the brief: { "<group>": ["<label>", …] }. Descriptive only — shown on the card and presence-matched for the business; never used by the broadcast matcher. NULL = none.';
