-- ============================================================
-- Drop orphan subscription_plans rows
-- ============================================================
-- 10 rows in subscription_plans reference subscription_id values
-- that no longer exist in the subscriptions table (2 phantom IDs,
-- 5 plans each). They came from early dev seeds (pre migration 027,
-- before tiers were replicated) and survived their parent
-- subscription's deletion. They are invisible in the admin UI.
--
-- FK cascades from this DELETE (auto-clean):
--   - subscription_plan_deliverables    (ON DELETE CASCADE)
--   - subscription_plan_pricing         (ON DELETE CASCADE)
--   - subscription_plan_partner_pricing (ON DELETE CASCADE)
--
-- FK blockers (run pre-flight before applying):
--   - client_subscriptions              (no cascade)
--   - client_submission_subscriptions   (ON DELETE RESTRICT)
-- If either has rows referencing an orphan plan_id, this DELETE
-- will fail and the transaction will roll back.

BEGIN;

DELETE FROM subscription_plans sp
WHERE NOT EXISTS (
  SELECT 1 FROM subscriptions s WHERE s.id = sp.subscription_id
);

COMMIT;
