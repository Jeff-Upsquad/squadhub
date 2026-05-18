-- ============================================================
-- 084_card_plan_snapshot.sql
--
-- Freeze plan-side data onto a card when it's published. Once a card
-- leaves draft (broadcast or soft-published), the hours, deliverables,
-- and pricing partners see must not silently change just because admin
-- edits the underlying plan. To change anything the card must be
-- recalled first, which puts it back to draft and clears this snapshot.
--
-- Shape (see server/src/utils/cardPlanSnapshot.ts for the writer):
--   {
--     "plan":            { id, plan, tier, daily_hours, weekly_hours },
--     "deliverables":    [ { id, kind, deliverable_type_id,
--                            deliverable_type_name, per_day, per_week,
--                            per_month, sort_order } ],
--     "pricing":         [ { country_id, price, margin_value, margin_type } ],
--     "partner_pricing": [ { country_id, price } ],
--     "snapshotted_at":  ISO timestamp
--   }
-- ============================================================

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS plan_snapshot JSONB;

COMMENT ON COLUMN subscription_cards.plan_snapshot IS
  'Frozen plan deliverables + pricing + hours captured at publish time. Read paths prefer this over live plan tables whenever state <> ''draft''. Cleared when a card is recalled back to draft.';

-- ------------------------------------------------------------
-- Backfill: every non-draft card that doesn''t already have a snapshot.
-- Two passes — staged cards via submission_subscription_id, and
-- request/custom cards via service_type + plan_name + target_tiers[0].
-- ------------------------------------------------------------

-- Pass 1: staged cards.
WITH plan_resolution AS (
  SELECT c.id AS card_id, css.plan_id
  FROM subscription_cards c
  JOIN client_submission_subscriptions css
    ON css.id = c.submission_subscription_id
  WHERE c.plan_snapshot IS NULL
    AND c.state <> 'draft'
    AND c.submission_subscription_id IS NOT NULL
),
deliv_agg AS (
  SELECT
    d.plan_id,
    jsonb_agg(
      jsonb_build_object(
        'id',                     d.id,
        'kind',                   d.kind,
        'deliverable_type_id',    d.deliverable_type_id,
        'deliverable_type_name',  dt.name,
        'per_day',                d.per_day,
        'per_week',               d.per_week,
        'per_month',              d.per_month,
        'sort_order',             d.sort_order
      )
      ORDER BY d.sort_order
    ) AS deliverables
  FROM subscription_plan_deliverables d
  LEFT JOIN subscription_deliverable_types dt ON dt.id = d.deliverable_type_id
  WHERE d.plan_id IN (SELECT plan_id FROM plan_resolution)
  GROUP BY d.plan_id
),
pricing_agg AS (
  SELECT
    pr.plan_id,
    jsonb_agg(
      jsonb_build_object(
        'country_id',   pr.country_id,
        'price',        pr.price,
        'margin_value', pr.margin_value,
        'margin_type',  pr.margin_type
      )
    ) AS pricing
  FROM subscription_plan_pricing pr
  WHERE pr.plan_id IN (SELECT plan_id FROM plan_resolution)
  GROUP BY pr.plan_id
),
partner_pricing_agg AS (
  SELECT
    pp.plan_id,
    jsonb_agg(
      jsonb_build_object(
        'country_id', pp.country_id,
        'price',      pp.price
      )
    ) AS partner_pricing
  FROM subscription_plan_partner_pricing pp
  WHERE pp.plan_id IN (SELECT plan_id FROM plan_resolution)
  GROUP BY pp.plan_id
)
UPDATE subscription_cards c
SET plan_snapshot = jsonb_build_object(
  'plan', jsonb_build_object(
    'id',           p.id,
    'plan',         p.plan,
    'tier',         p.tier,
    'daily_hours',  p.daily_hours,
    'weekly_hours', p.weekly_hours
  ),
  'deliverables',     COALESCE(da.deliverables,     '[]'::jsonb),
  'pricing',          COALESCE(pa.pricing,          '[]'::jsonb),
  'partner_pricing',  COALESCE(ppa.partner_pricing, '[]'::jsonb),
  'snapshotted_at',   to_jsonb(now())
)
FROM plan_resolution pr
JOIN subscription_plans p          ON p.id = pr.plan_id
LEFT JOIN deliv_agg da             ON da.plan_id = pr.plan_id
LEFT JOIN pricing_agg pa           ON pa.plan_id = pr.plan_id
LEFT JOIN partner_pricing_agg ppa  ON ppa.plan_id = pr.plan_id
WHERE c.id = pr.card_id;

-- Pass 2: request/custom cards (no submission_subscription_id). Resolve plan
-- via service_type → subscription slug, plan_name → canonical plan name, and
-- first target tier. Cards that don''t resolve are left with NULL snapshot
-- and will keep reading live until they''re recalled and re-published.
WITH service_slug_map (service_type, slug) AS (
  VALUES
    ('Designers',             'designer'),
    ('Editors',               'video_editor'),
    ('Designer plus Editor',  'designer_video_editor')
),
plan_name_map (raw_plan_name, canonical) AS (
  VALUES
    ('starter',  'Starter'),
    ('basic',    'Basic'),
    ('plus',     'Plus'),
    ('pro',      'Pro'),
    ('personal', 'Personal')
),
plan_resolution AS (
  SELECT
    c.id AS card_id,
    p.id AS plan_id
  FROM subscription_cards c
  JOIN service_slug_map sm     ON sm.service_type = c.service_type
  JOIN plan_name_map pnm       ON pnm.raw_plan_name = lower(c.plan_name)
  JOIN subscriptions s         ON s.slug = sm.slug
  JOIN subscription_plans p
    ON p.subscription_id = s.id
   AND p.plan = pnm.canonical
   AND p.tier = (c.target_tiers)[1]
  WHERE c.plan_snapshot IS NULL
    AND c.state <> 'draft'
    AND c.submission_subscription_id IS NULL
    AND c.service_type IS NOT NULL
    AND c.plan_name IS NOT NULL
    AND array_length(c.target_tiers, 1) > 0
),
deliv_agg AS (
  SELECT
    d.plan_id,
    jsonb_agg(
      jsonb_build_object(
        'id',                     d.id,
        'kind',                   d.kind,
        'deliverable_type_id',    d.deliverable_type_id,
        'deliverable_type_name',  dt.name,
        'per_day',                d.per_day,
        'per_week',               d.per_week,
        'per_month',              d.per_month,
        'sort_order',             d.sort_order
      )
      ORDER BY d.sort_order
    ) AS deliverables
  FROM subscription_plan_deliverables d
  LEFT JOIN subscription_deliverable_types dt ON dt.id = d.deliverable_type_id
  WHERE d.plan_id IN (SELECT plan_id FROM plan_resolution)
  GROUP BY d.plan_id
),
pricing_agg AS (
  SELECT
    pr.plan_id,
    jsonb_agg(
      jsonb_build_object(
        'country_id',   pr.country_id,
        'price',        pr.price,
        'margin_value', pr.margin_value,
        'margin_type',  pr.margin_type
      )
    ) AS pricing
  FROM subscription_plan_pricing pr
  WHERE pr.plan_id IN (SELECT plan_id FROM plan_resolution)
  GROUP BY pr.plan_id
),
partner_pricing_agg AS (
  SELECT
    pp.plan_id,
    jsonb_agg(
      jsonb_build_object(
        'country_id', pp.country_id,
        'price',      pp.price
      )
    ) AS partner_pricing
  FROM subscription_plan_partner_pricing pp
  WHERE pp.plan_id IN (SELECT plan_id FROM plan_resolution)
  GROUP BY pp.plan_id
)
UPDATE subscription_cards c
SET plan_snapshot = jsonb_build_object(
  'plan', jsonb_build_object(
    'id',           p.id,
    'plan',         p.plan,
    'tier',         p.tier,
    'daily_hours',  p.daily_hours,
    'weekly_hours', p.weekly_hours
  ),
  'deliverables',     COALESCE(da.deliverables,     '[]'::jsonb),
  'pricing',          COALESCE(pa.pricing,          '[]'::jsonb),
  'partner_pricing',  COALESCE(ppa.partner_pricing, '[]'::jsonb),
  'snapshotted_at',   to_jsonb(now())
)
FROM plan_resolution pr
JOIN subscription_plans p          ON p.id = pr.plan_id
LEFT JOIN deliv_agg da             ON da.plan_id = pr.plan_id
LEFT JOIN pricing_agg pa           ON pa.plan_id = pr.plan_id
LEFT JOIN partner_pricing_agg ppa  ON ppa.plan_id = pr.plan_id
WHERE c.id = pr.card_id;
