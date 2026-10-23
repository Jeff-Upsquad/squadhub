-- ============================================================
-- Subscription Cards: internal "client brief" support
--
-- Two workflows on the Form Requests queue:
--   1. An internal user fills out a client brief form themselves
--      (source = 'internal_brief'); created_by tracks who. They can
--      send the client a 24h share link; when the client reviews and
--      submits it, client_approved_at is stamped ("Client approved").
--   2. The client submits a brief directly (shared_form / landing_page_form);
--      an internal user then verifies it — verified_by / verified_at track
--      who and when ("Verified by …").
--
-- All columns are nullable and additive — no backfill, no data touched.
-- ============================================================

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS created_by         uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS verified_by        uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS verified_at        timestamptz,
  ADD COLUMN IF NOT EXISTS client_approved_at timestamptz;

-- Widen the source CHECK to allow the internally-created brief.
ALTER TABLE subscription_cards
  DROP CONSTRAINT IF EXISTS chk_source;

ALTER TABLE subscription_cards
  ADD CONSTRAINT chk_source
  CHECK (source IN ('submission', 'request', 'custom', 'shared_form', 'landing_page_form', 'internal_brief'));
