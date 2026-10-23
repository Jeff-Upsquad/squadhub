-- ============================================================
-- Per-client deliverables gain an `is_active` flag.
-- For linked rows (source_plan_deliverable_id IS NOT NULL) this is
-- the only field the admin can change on the client side — the
-- per_day/per_week/per_month values stay locked to the plan.
-- For custom rows the admin can still edit values freely;
-- is_active is available on both for consistency.
-- ============================================================

ALTER TABLE client_subscription_deliverables
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
