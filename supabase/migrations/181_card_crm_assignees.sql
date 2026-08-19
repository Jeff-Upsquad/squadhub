-- =============================================================
-- Card owners from Squad CRM (lead / deal assignees)
-- =============================================================
-- When a subscription, assignment, or job card is created, we stamp
-- the same people currently assigned to the matching CRM lead — or
-- the open deal spawned from that lead, if one exists.
--
--   assignee_id       = CRM primary owner  (crm_leads/crm_deals.assignee_id)
--   collaborator_ids  = CRM secondaries    (crm_leads/crm_deals.collaborator_ids)
--
-- Soft refs to users.id (no FK), matching CRM. These are INTERNAL
-- sales owners, not the talent placed on the card.
-- =============================================================

BEGIN;

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS assignee_id UUID,
  ADD COLUMN IF NOT EXISTS collaborator_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE job_cards
  ADD COLUMN IF NOT EXISTS assignee_id UUID,
  ADD COLUMN IF NOT EXISTS collaborator_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN subscription_cards.assignee_id IS
  'Primary internal owner, copied from the matching Squad CRM lead or deal at card create.';
COMMENT ON COLUMN subscription_cards.collaborator_ids IS
  'Secondary internal owners (CRM collaborators), disjoint from assignee_id.';
COMMENT ON COLUMN job_cards.assignee_id IS
  'Primary internal owner, copied from the matching Squad CRM lead or deal at card create.';
COMMENT ON COLUMN job_cards.collaborator_ids IS
  'Secondary internal owners (CRM collaborators), disjoint from assignee_id.';

CREATE INDEX IF NOT EXISTS idx_subscription_cards_assignee
  ON subscription_cards (assignee_id)
  WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscription_cards_collaborators
  ON subscription_cards USING GIN (collaborator_ids);

CREATE INDEX IF NOT EXISTS idx_job_cards_assignee
  ON job_cards (assignee_id)
  WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_cards_collaborators
  ON job_cards USING GIN (collaborator_ids);

-- ------------------------------------------------------------
-- Backfill: resolve the CRM lead (or its open deal) for each card
-- and copy current assignees. Prefer an open, not-moved-out deal
-- when one exists — that's the live commercial owner.
-- ------------------------------------------------------------

-- Latest open deal per source lead (status='open', still on the board).
CREATE TEMP TABLE tmp_crm_deal_owners ON COMMIT DROP AS
SELECT DISTINCT ON (source_lead_id)
  source_lead_id,
  assignee_id,
  COALESCE(collaborator_ids, '{}'::uuid[]) AS collaborator_ids
FROM crm_deals
WHERE source_lead_id IS NOT NULL
  AND moved_out_at IS NULL
  AND status = 'open'
ORDER BY source_lead_id, updated_at DESC;

-- Map each subscription card → Hub contact (direct FK, else staged sub).
CREATE TEMP TABLE tmp_sub_card_contacts ON COMMIT DROP AS
SELECT
  sc.id AS card_id,
  COALESCE(sc.lead_submission_id, css.submission_id) AS submission_id
FROM subscription_cards sc
LEFT JOIN client_submission_subscriptions css
  ON css.id = sc.submission_subscription_id
WHERE sc.assignee_id IS NULL
  AND COALESCE(sc.lead_submission_id, css.submission_id) IS NOT NULL;

-- Resolve CRM lead id: stored crm_lead_id, else sh_client_submission_id.
CREATE TEMP TABLE tmp_sub_card_leads ON COMMIT DROP AS
SELECT
  t.card_id,
  t.submission_id,
  cs.primary_sales_person_id,
  cs.secondary_sales_person_id,
  COALESCE(cs.crm_lead_id, l_by_sub.id) AS lead_id
FROM tmp_sub_card_contacts t
JOIN client_submissions cs ON cs.id = t.submission_id
LEFT JOIN crm_leads l_by_sub
  ON l_by_sub.sh_client_submission_id = cs.id
 AND l_by_sub.merged_into_lead_id IS NULL;

UPDATE subscription_cards sc
SET
  assignee_id = COALESCE(d.assignee_id, l.assignee_id, rl.primary_sales_person_id),
  collaborator_ids = CASE
    WHEN d.source_lead_id IS NOT NULL THEN COALESCE(d.collaborator_ids, '{}'::uuid[])
    WHEN l.id IS NOT NULL THEN COALESCE(l.collaborator_ids, '{}'::uuid[])
    WHEN rl.secondary_sales_person_id IS NOT NULL THEN ARRAY[rl.secondary_sales_person_id]
    ELSE '{}'::uuid[]
  END
FROM tmp_sub_card_leads rl
LEFT JOIN crm_leads l
  ON l.id = rl.lead_id
 AND l.merged_into_lead_id IS NULL
LEFT JOIN tmp_crm_deal_owners d ON d.source_lead_id = l.id
WHERE sc.id = rl.card_id
  AND sc.assignee_id IS NULL
  AND COALESCE(d.assignee_id, l.assignee_id, rl.primary_sales_person_id) IS NOT NULL;

-- Drop the primary out of collaborator_ids if it landed in both.
UPDATE subscription_cards
SET collaborator_ids = array_remove(collaborator_ids, assignee_id)
WHERE assignee_id IS NOT NULL
  AND collaborator_ids @> ARRAY[assignee_id];

-- Job cards: direct lead_submission_id.
CREATE TEMP TABLE tmp_job_card_leads ON COMMIT DROP AS
SELECT
  jc.id AS card_id,
  jc.lead_submission_id AS submission_id,
  cs.primary_sales_person_id,
  cs.secondary_sales_person_id,
  COALESCE(cs.crm_lead_id, l_by_sub.id) AS lead_id
FROM job_cards jc
JOIN client_submissions cs ON cs.id = jc.lead_submission_id
LEFT JOIN crm_leads l_by_sub
  ON l_by_sub.sh_client_submission_id = cs.id
 AND l_by_sub.merged_into_lead_id IS NULL
WHERE jc.assignee_id IS NULL
  AND jc.lead_submission_id IS NOT NULL;

UPDATE job_cards jc
SET
  assignee_id = COALESCE(d.assignee_id, l.assignee_id, rl.primary_sales_person_id),
  collaborator_ids = CASE
    WHEN d.source_lead_id IS NOT NULL THEN COALESCE(d.collaborator_ids, '{}'::uuid[])
    WHEN l.id IS NOT NULL THEN COALESCE(l.collaborator_ids, '{}'::uuid[])
    WHEN rl.secondary_sales_person_id IS NOT NULL THEN ARRAY[rl.secondary_sales_person_id]
    ELSE '{}'::uuid[]
  END
FROM tmp_job_card_leads rl
LEFT JOIN crm_leads l
  ON l.id = rl.lead_id
 AND l.merged_into_lead_id IS NULL
LEFT JOIN tmp_crm_deal_owners d ON d.source_lead_id = l.id
WHERE jc.id = rl.card_id
  AND jc.assignee_id IS NULL
  AND COALESCE(d.assignee_id, l.assignee_id, rl.primary_sales_person_id) IS NOT NULL;

UPDATE job_cards
SET collaborator_ids = array_remove(collaborator_ids, assignee_id)
WHERE assignee_id IS NOT NULL
  AND collaborator_ids @> ARRAY[assignee_id];

COMMIT;

NOTIFY pgrst, 'reload schema';
