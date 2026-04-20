-- ============================================================
-- Link client deliverable rows back to the plan row they came from,
-- so future plan edits propagate to non-customized clients.
-- Rows with source_plan_deliverable_id = NULL are custom (admin-added
-- on the client, or edited after copy) and ignore plan changes.
-- ON DELETE CASCADE: deleting a plan deliverable wipes its mirrors.
-- ============================================================

ALTER TABLE client_subscription_deliverables
  ADD COLUMN IF NOT EXISTS source_plan_deliverable_id UUID
    REFERENCES subscription_plan_deliverables(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_csd_source_plan_deliv
  ON client_subscription_deliverables(source_plan_deliverable_id);

-- Backfill existing rows: match by (plan of parent client_subscription, kind, deliverable_type_id)
UPDATE client_subscription_deliverables csd
SET source_plan_deliverable_id = (
  SELECT spd.id
  FROM client_subscriptions cs
  JOIN subscription_plan_deliverables spd
    ON spd.plan_id = cs.plan_id
   AND spd.kind    = csd.kind
   AND spd.deliverable_type_id IS NOT DISTINCT FROM csd.deliverable_type_id
  WHERE cs.id = csd.client_subscription_id
  LIMIT 1
)
WHERE csd.source_plan_deliverable_id IS NULL;
