-- =============================================================
-- subscription_cards.lead_submission_id — direct Hub contact link
-- =============================================================
-- Phase 3: when a subscription/assignment card is created, we find-or-create
-- a client_submissions row (Hub contact) and stamp this FK so the card is
-- hard-linked without re-matching email/phone. Mirrors job_cards.lead_submission_id.
-- Idempotent.
-- =============================================================

BEGIN;

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS lead_submission_id UUID
    REFERENCES client_submissions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_subscription_cards_lead_submission
  ON subscription_cards (lead_submission_id)
  WHERE lead_submission_id IS NOT NULL;

-- Best-effort backfill via staged subscription (canonical path).
UPDATE subscription_cards sc
SET lead_submission_id = css.submission_id
FROM client_submission_subscriptions css
WHERE sc.submission_subscription_id = css.id
  AND sc.lead_submission_id IS NULL
  AND css.submission_id IS NOT NULL;

COMMIT;
