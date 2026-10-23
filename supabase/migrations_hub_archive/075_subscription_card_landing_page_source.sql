-- ============================================================
-- Subscription Cards: allow source='landing_page_form'
-- Submissions from the public /connect form land directly as
-- draft cards with this source so they show up in the admin
-- Form Requests tab tagged "Landing Page" alongside upsquad
-- (source='request') and manual (source='custom') ones.
-- ============================================================

ALTER TABLE subscription_cards
  DROP CONSTRAINT IF EXISTS chk_source;

ALTER TABLE subscription_cards
  ADD CONSTRAINT chk_source
  CHECK (source IN ('submission', 'request', 'custom', 'landing_page_form'));
