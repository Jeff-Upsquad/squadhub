-- ============================================================
-- Subscription Cards: product line (card_type)
--
-- The product offers clients three ways to find talent: a recurring
-- Subscription, a one-off Freelance Assignment, and Hiring. All three reuse
-- this single cards table + the new→draft→published→broadcast lifecycle, the
-- partner/talent fan-out, the tier grouping (brief_group_id) and the SquadHire
-- webhook. card_type is the discriminator that keeps the three paths apart on
-- the consumer side (talent app/web tag by it; the business portal shows a
-- separate Assignments section).
--
--   'subscription' — the existing recurring-plan brief (DEFAULT; every legacy
--                    row keeps behaving exactly as before, no backfill needed).
--   'assignment'   — freelance, project-based brief. Pricing is a one-time
--                    project budget (proposed_price) with a scope (notes /
--                    requirement_note) and a timeline in assignment_details,
--                    instead of a weekly plan + monthly price.
--   'hiring'       — reserved for the third path; not built yet.
--
-- assignment_details holds the project-specific fields that don't map to an
-- existing column (e.g. { duration, start_date, deadline, scope_type }). The
-- budget reuses proposed_price and the scope reuses notes / requirement_note.
--
-- Both columns are additive and default/nullable — no data touched.
-- ============================================================

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS card_type TEXT NOT NULL DEFAULT 'subscription',
  ADD COLUMN IF NOT EXISTS assignment_details JSONB;

ALTER TABLE subscription_cards
  DROP CONSTRAINT IF EXISTS chk_card_type;

ALTER TABLE subscription_cards
  ADD CONSTRAINT chk_card_type
  CHECK (card_type IN ('subscription', 'assignment', 'hiring'));

COMMENT ON COLUMN subscription_cards.card_type IS
  'Product line this card belongs to: subscription (recurring plan, default), assignment (one-off freelance project) or hiring (reserved). Discriminates the same cards table / lifecycle across the three client paths.';

COMMENT ON COLUMN subscription_cards.assignment_details IS
  'Project-specific fields for card_type = assignment that have no dedicated column, e.g. { duration, start_date, deadline, scope_type }. Budget reuses proposed_price; scope reuses notes / requirement_note. NULL for subscription / hiring cards.';

-- Cheap discriminator filter for the talent feed and the business Assignments
-- section. Partial index keeps the common card_type='subscription' path off it.
CREATE INDEX IF NOT EXISTS subscription_cards_card_type_idx
  ON subscription_cards (card_type)
  WHERE card_type <> 'subscription';
