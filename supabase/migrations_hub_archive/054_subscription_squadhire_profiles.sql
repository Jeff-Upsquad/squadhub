-- ============================================================
-- 054: subscription_squadhire_profiles
--
-- Maps a canonical subscription (subscriptions row) to one or more
-- SquadHire categories ("profiles"). Used by getOrCreateDraftCard()
-- to pre-fill subscription_cards.squadhire_category_ids when a sales
-- user opens a new draft card. Sales user can still override per card.
--
-- No FK on squadhire_category_id — those UUIDs live in SquadHire's
-- separate Supabase project (same convention as
-- subscription_cards.squadhire_category_ids in migration 048).
-- Validity is enforced by the admin UI's picker.
-- ============================================================

CREATE TABLE IF NOT EXISTS subscription_squadhire_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL
    REFERENCES subscriptions(id) ON DELETE CASCADE,
  squadhire_category_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, squadhire_category_id)
);

CREATE INDEX IF NOT EXISTS idx_sub_sh_profiles_subscription
  ON subscription_squadhire_profiles(subscription_id);

ALTER TABLE subscription_squadhire_profiles ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
