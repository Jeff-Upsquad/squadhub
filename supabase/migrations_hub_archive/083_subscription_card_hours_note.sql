-- Adds a free-form "hours" note alongside the existing requirement_note on
-- each subscription_cards row. Captured per-role on the /connect form so
-- the sales team knows how much bandwidth each specialist needs (e.g.
-- "20 hrs/week"). Free-form rather than numeric — leads phrase this in
-- wildly different ways and admin can normalise later.

ALTER TABLE subscription_cards
  ADD COLUMN hours_note TEXT;

COMMENT ON COLUMN subscription_cards.hours_note IS
  'Free-form hours-per-period requirement (e.g. "4 hrs daily", "20 hrs/week"). Captured per-role on /connect.';
