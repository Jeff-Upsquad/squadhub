-- ============================================================
-- Subscription Cards: split 'shared_form' from 'landing_page_form'
-- The /connect form is a "Shared Form" (link sent to a specific
-- lead). 'landing_page_form' is reserved for a separate inbound
-- channel (e.g. an embedded form on the marketing landing page).
-- Reclassifies existing rows since all current submissions came
-- from /connect.
-- ============================================================

ALTER TABLE subscription_cards
  DROP CONSTRAINT IF EXISTS chk_source;

ALTER TABLE subscription_cards
  ADD CONSTRAINT chk_source
  CHECK (source IN ('submission', 'request', 'custom', 'shared_form', 'landing_page_form'));

UPDATE subscription_cards
  SET source = 'shared_form'
  WHERE source = 'landing_page_form';
