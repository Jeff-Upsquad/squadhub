-- =============================================================
-- Sales Dashboard — team roster, targets, and metric aggregation
-- =============================================================
-- Admin Sales Dashboard over the Squad CRM tables that live in this SAME
-- database (crm_leads / crm_call_logs / crm_categories / crm_squads).
--
-- Metrics are events-in-period over half-open UTC ranges [p_start, p_end)
-- derived from IST midnights (resolved server-side in utils/salesPeriod).
-- Attribution differs per metric:
--   leads created  → crm_leads.assignee_id (current assignee)
--   calls          → crm_call_logs.caller_id, split by outcome
--   lead → deal    → crm_leads.became_deal_by @ became_deal_at
--   converted      → crm_leads.converted_by   @ converted_at
--   closed/revenue → crm_leads.closed_by      @ closed_at (SUM(deal_value))
--
-- check_function_bodies off: the functions reference crm_ columns that a
-- parallel Squad CRM migration adds (deal_value, product, became_deal_at,
-- converted_at, closed_at, crm_call_logs, ...); skip body validation so
-- this file applies independently of migration ordering.
-- =============================================================

SET check_function_bodies = off;

-- Who appears on the sales leaderboard.
CREATE TABLE sales_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-member targets. A row sets a metric's target from a period start
-- onward; the latest effective_from <= the viewed period's start wins, so
-- history is preserved when targets change.
CREATE TABLE sales_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric TEXT NOT NULL CHECK (metric IN ('calls_made', 'leads_converted', 'deals_converted', 'deals_closed', 'revenue')),
  period_type TEXT NOT NULL CHECK (period_type IN ('weekly', 'monthly')),
  target_value NUMERIC NOT NULL DEFAULT 0 CHECK (target_value >= 0),
  effective_from DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, metric, period_type, effective_from)
);

CREATE INDEX idx_sales_targets_lookup
  ON sales_targets(user_id, metric, period_type, effective_from DESC);

DROP TRIGGER IF EXISTS trg_sales_targets_updated_at ON sales_targets;
CREATE TRIGGER trg_sales_targets_updated_at
  BEFORE UPDATE ON sales_targets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: service role bypasses; server routes enforce access (matches 044/157).
ALTER TABLE sales_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_targets ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------
-- Per-user metric aggregation for a period.
-- Each metric groups by ITS OWN attribution column (see header), so the
-- per-metric counts are computed independently in a UNION ALL and summed
-- per uid at the end. NULL uid rows (unassigned/unstamped events) are kept
-- so the caller can reconcile totals ("Others" bucket).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION sales_dash_member_stats(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_workspace_id UUID DEFAULT NULL
)
RETURNS TABLE(
  user_id UUID,
  leads_created BIGINT,
  calls_total BIGINT,
  calls_answered BIGINT,
  calls_no_answer BIGINT,
  leads_to_deals BIGINT,
  deals_converted BIGINT,
  deals_closed BIGINT,
  revenue_closed NUMERIC
)
LANGUAGE sql STABLE
AS $$
  WITH per_metric AS (
    -- Leads created → the lead's CURRENT assignee. Merged-away leads are
    -- excluded so a merge doesn't double-count the same person.
    SELECT l.assignee_id AS uid,
           count(*)::BIGINT AS leads_created,
           0::BIGINT AS calls_total,
           0::BIGINT AS calls_answered,
           0::BIGINT AS calls_no_answer,
           0::BIGINT AS leads_to_deals,
           0::BIGINT AS deals_converted,
           0::BIGINT AS deals_closed,
           0::NUMERIC AS revenue_closed
      FROM crm_leads l
     WHERE l.created_at >= p_start AND l.created_at < p_end
       AND l.merged_into_lead_id IS NULL
       AND (p_workspace_id IS NULL OR l.workspace_id = p_workspace_id)
     GROUP BY l.assignee_id

    UNION ALL

    -- Calls → whoever made the call, split by outcome.
    SELECT cl.caller_id,
           0::BIGINT,
           count(*)::BIGINT,
           (count(*) FILTER (WHERE cl.outcome = 'answered'))::BIGINT,
           (count(*) FILTER (WHERE cl.outcome = 'no_answer'))::BIGINT,
           0::BIGINT,
           0::BIGINT,
           0::BIGINT,
           0::NUMERIC
      FROM crm_call_logs cl
     WHERE cl.called_at >= p_start AND cl.called_at < p_end
       AND (p_workspace_id IS NULL OR cl.workspace_id = p_workspace_id)
     GROUP BY cl.caller_id

    UNION ALL

    -- Lead → deal → whoever moved it (became_deal_by).
    SELECT l.became_deal_by,
           0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT,
           count(*)::BIGINT,
           0::BIGINT,
           0::BIGINT,
           0::NUMERIC
      FROM crm_leads l
     WHERE l.became_deal_at >= p_start AND l.became_deal_at < p_end
       AND (p_workspace_id IS NULL OR l.workspace_id = p_workspace_id)
     GROUP BY l.became_deal_by

    UNION ALL

    -- Converted → converted_by.
    SELECT l.converted_by,
           0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT,
           0::BIGINT,
           count(*)::BIGINT,
           0::BIGINT,
           0::NUMERIC
      FROM crm_leads l
     WHERE l.converted_at >= p_start AND l.converted_at < p_end
       AND (p_workspace_id IS NULL OR l.workspace_id = p_workspace_id)
     GROUP BY l.converted_by

    UNION ALL

    -- Closed (+ revenue) → closed_by.
    SELECT l.closed_by,
           0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT,
           0::BIGINT,
           0::BIGINT,
           count(*)::BIGINT,
           COALESCE(sum(l.deal_value), 0)::NUMERIC
      FROM crm_leads l
     WHERE l.closed_at >= p_start AND l.closed_at < p_end
       AND (p_workspace_id IS NULL OR l.workspace_id = p_workspace_id)
     GROUP BY l.closed_by
  )
  SELECT pm.uid,
         sum(pm.leads_created)::BIGINT,
         sum(pm.calls_total)::BIGINT,
         sum(pm.calls_answered)::BIGINT,
         sum(pm.calls_no_answer)::BIGINT,
         sum(pm.leads_to_deals)::BIGINT,
         sum(pm.deals_converted)::BIGINT,
         sum(pm.deals_closed)::BIGINT,
         sum(pm.revenue_closed)::NUMERIC
    FROM per_metric pm
   GROUP BY pm.uid;
$$;

-- -------------------------------------------------------------
-- Lead-funnel breakdown by a lead dimension for a period.
-- 'product' / 'source' are columns on crm_leads; 'squad' / 'category'
-- resolve through crm_categories → crm_squads. Each funnel event counts in
-- the group of ITS lead, filtered by its own timestamp; NULL groups show
-- as '(unset)'.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION sales_dash_breakdown(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_dimension TEXT,
  p_workspace_id UUID DEFAULT NULL
)
RETURNS TABLE(
  group_key TEXT,
  leads_created BIGINT,
  leads_to_deals BIGINT,
  deals_converted BIGINT,
  deals_closed BIGINT,
  revenue_closed NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
           CASE p_dimension
             WHEN 'product' THEN l.product
             WHEN 'source' THEN l.source
             WHEN 'squad' THEN sq.name
             WHEN 'category' THEN c.name
           END,
           '(unset)'
         ) AS group_key,
         (count(*) FILTER (
            WHERE l.created_at >= p_start AND l.created_at < p_end
              AND l.merged_into_lead_id IS NULL
         ))::BIGINT AS leads_created,
         (count(*) FILTER (
            WHERE l.became_deal_at >= p_start AND l.became_deal_at < p_end
         ))::BIGINT AS leads_to_deals,
         (count(*) FILTER (
            WHERE l.converted_at >= p_start AND l.converted_at < p_end
         ))::BIGINT AS deals_converted,
         (count(*) FILTER (
            WHERE l.closed_at >= p_start AND l.closed_at < p_end
         ))::BIGINT AS deals_closed,
         COALESCE(sum(l.deal_value) FILTER (
            WHERE l.closed_at >= p_start AND l.closed_at < p_end
         ), 0)::NUMERIC AS revenue_closed
    FROM crm_leads l
    LEFT JOIN crm_categories c ON c.id = l.category_id
    LEFT JOIN crm_squads sq ON sq.id = c.squad_id
   WHERE (p_workspace_id IS NULL OR l.workspace_id = p_workspace_id)
     AND (
       (l.created_at >= p_start AND l.created_at < p_end)
       OR (l.became_deal_at >= p_start AND l.became_deal_at < p_end)
       OR (l.converted_at >= p_start AND l.converted_at < p_end)
       OR (l.closed_at >= p_start AND l.closed_at < p_end)
     )
   GROUP BY 1
   ORDER BY 6 DESC, 2 DESC;
$$;

NOTIFY pgrst, 'reload schema';
