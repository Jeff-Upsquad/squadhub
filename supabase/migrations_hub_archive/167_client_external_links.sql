-- =============================================================
-- Client external links — persist CRM + SquadHire identities
-- =============================================================
-- Phase 2 of Hub single-source-of-truth: stop re-resolving by email/phone
-- on every "Open in CRM / Open in SquadHire" click. Soft refs only
-- (no FKs) — CRM shares this DB but Hire is a separate project, and we
-- follow house style for cross-app ids.
--
-- Columns land on both client_submissions (Contacts pipeline) and clients
-- (approved clients). Convert copies submission → client.
-- Idempotent: safe to re-run.
-- =============================================================

BEGIN;

ALTER TABLE client_submissions
  ADD COLUMN IF NOT EXISTS crm_lead_id UUID,
  ADD COLUMN IF NOT EXISTS squadhire_business_user_id UUID;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS crm_lead_id UUID,
  ADD COLUMN IF NOT EXISTS squadhire_business_user_id UUID;

CREATE INDEX IF NOT EXISTS idx_client_submissions_crm_lead
  ON client_submissions (crm_lead_id)
  WHERE crm_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_submissions_hire_biz
  ON client_submissions (squadhire_business_user_id)
  WHERE squadhire_business_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_crm_lead
  ON clients (crm_lead_id)
  WHERE crm_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_hire_biz
  ON clients (squadhire_business_user_id)
  WHERE squadhire_business_user_id IS NOT NULL;

-- Best-effort backfill: CRM leads that already point at a submission.
UPDATE client_submissions cs
SET crm_lead_id = l.id
FROM crm_leads l
WHERE l.sh_client_submission_id = cs.id
  AND l.merged_into_lead_id IS NULL
  AND cs.crm_lead_id IS NULL;

-- Propagate to clients that were converted from those submissions.
UPDATE clients c
SET crm_lead_id = cs.crm_lead_id
FROM client_submissions cs
WHERE c.submission_id = cs.id
  AND cs.crm_lead_id IS NOT NULL
  AND c.crm_lead_id IS NULL;

COMMIT;
