-- ============================================================
-- 157: Card monthly hours completion (target snapshot + actual + delta)
-- ============================================================
-- Once a subscription card is assigned it is linked to a design/video SPACE
-- (subscription_cards.linked_folder_id). The card's plan grants committed
-- daily/weekly/monthly hours. This table reconciles, per card per IST month, the
-- plan's monthly target against the hours actually spent in that space:
--
--   target  = the card's plan committed hours for its ACTIVE window that month
--             (mirrored from the plan / assignment-term timeline -- read-only,
--             admins never edit it; partial months are prorated by the window).
--   actual  = tracked time (task_time_entries) + elapsed idle-day time
--             (elapsed_time_entries) for the linked space that IST month.
--   additional_hours = actual - target (signed: + overage, - shortfall).
--
-- The signed delta drives money adjustments in two admin modules:
--   - Partner Payments: payout +/- additional_hours * partner_hourly_rate
--   - Gross Profit:     revenue +/- additional_hours * client_hourly_rate AND
--                       partner cost +/- additional_hours * partner_hourly_rate
-- where the hourly rate = monthly price / standard_monthly_hours.
--
-- This is a COMPLETION-TRACKING snapshot, NOT an editable-targets table. It is
-- (re)computed on view by the Partner Payments + Gross Profit modules (both
-- already resolve terms + billing for the chosen month) and, as a backstop, by a
-- daily cron (server/src/cron/hours-completion-cron.ts).
--
-- One row per (card_id, period_month). period_month = first day of the IST month.

CREATE TABLE card_hours_completion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The subscription card whose retainer this tracks.
  card_id UUID NOT NULL REFERENCES subscription_cards(id) ON DELETE CASCADE,

  -- The design/video space the card was linked to when this row was computed
  -- (subscription_cards.linked_folder_id), snapshotted so a later re-link doesn't
  -- silently repoint historical actuals. NULL only if the card had no linked
  -- folder at compute time (actual then reads 0).
  linked_folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,

  -- First day of the IST month this row covers (e.g. 2026-07-01).
  period_month DATE NOT NULL,

  -- Plan committed-hours snapshot. daily/weekly are the plan figures in effect;
  -- monthly is the prorated, working-day-summed target used as the delta baseline.
  target_daily_hours   NUMERIC(8,2),
  target_weekly_hours  NUMERIC(8,2),
  target_monthly_hours NUMERIC(8,2) NOT NULL DEFAULT 0,

  -- The plan's full committed monthly hours = the RATE DIVISOR (NOT prorated).
  -- Stored so the hourly rate is auditable alongside the delta. NULL when the
  -- plan defines no monthly hours (rate then undefined -> no money moves).
  standard_monthly_hours NUMERIC(8,2),

  -- Actual spent hours = tracked + elapsed for linked_folder_id this IST month.
  actual_hours NUMERIC(8,2) NOT NULL DEFAULT 0,

  -- Signed delta: actual_hours - target_monthly_hours.
  additional_hours NUMERIC(8,2) NOT NULL DEFAULT 0,

  -- Audit: first compute + last recompute.
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One completion row per card per IST month; the compute helper upserts on it.
CREATE UNIQUE INDEX idx_card_hours_completion_card_month
  ON card_hours_completion (card_id, period_month);

-- Module queries fetch every card's row for one month in a single batch.
CREATE INDEX idx_card_hours_completion_month
  ON card_hours_completion (period_month);

-- Keep updated_at fresh on recompute (function defined in migration 002).
CREATE TRIGGER trg_card_hours_completion_updated_at
  BEFORE UPDATE ON card_hours_completion
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Written/read only by the server via the service-role client (module compute +
-- cron), which bypasses RLS. Enable RLS with no policies so direct
-- anon/authenticated access is denied by default (matches elapsed_time_entries,
-- migration 149).
ALTER TABLE card_hours_completion ENABLE ROW LEVEL SECURITY;
