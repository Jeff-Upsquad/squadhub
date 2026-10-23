-- ============================================================
-- 039: Sales pipeline statuses + per-lead subscription selections
--   - Widen client_submissions.status from 3 admin values (pending/approved/rejected)
--     to 6 pipeline values (new/in_progress/selection/converted/onboarding/closed).
--   - Backfill: pending → new, approved → converted, rejected → closed.
--   - New client_submission_subscriptions table: sales people can stage one or more
--     (subscription, plan) selections on a lead before conversion. On transition to
--     'converted', these are materialised into client_subscriptions.
-- Idempotent — safe to re-run.
-- ============================================================

BEGIN;

-- 1. Drop the old CHECK so we can rewrite values into the new namespace.
ALTER TABLE client_submissions DROP CONSTRAINT IF EXISTS client_submissions_status_check;

-- 2. Backfill. Safe to re-run: the WHERE clauses simply match zero rows on a second pass.
UPDATE client_submissions SET status = 'new'       WHERE status = 'pending';
UPDATE client_submissions SET status = 'converted' WHERE status = 'approved';
UPDATE client_submissions SET status = 'closed'    WHERE status = 'rejected';

-- 3. Add the new CHECK.
ALTER TABLE client_submissions ADD CONSTRAINT client_submissions_status_check
  CHECK (status IN ('new', 'in_progress', 'selection', 'converted', 'onboarding', 'closed'));

-- 4. Flip the default.
ALTER TABLE client_submissions ALTER COLUMN status SET DEFAULT 'new';

-- 5. Staged subscription selections on a lead.
CREATE TABLE IF NOT EXISTS client_submission_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES client_submissions(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (submission_id, subscription_id, plan_id)
);
CREATE INDEX IF NOT EXISTS idx_submission_subs_submission_id ON client_submission_subscriptions(submission_id);

NOTIFY pgrst, 'reload schema';
COMMIT;
