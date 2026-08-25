-- ============================================================
-- Round fractional hours everywhere (companion to migration 086)
-- ============================================================
-- Migration 086 rounded subscription_plans.daily_hours for the 3
-- subscriptions that existed then. Two gaps remained:
--   1. Migration 105 (Accountant) seeded plans with the old
--      fractional template (2.5 / 4.5 / 6.5) AFTER 086 ran.
--   2. subscription_plan_deliverables, its per-client mirrors
--      (client_subscription_deliverables), and the frozen
--      subscription_cards.plan_snapshot copies were never rounded,
--      so cards still display "2.5 hrs/day · 12.5 hrs/week · 50
--      hrs/month".
--
-- Rounding direction matches 086: 2.5 -> 2, 4.5 -> 4, 6.5 -> 6
-- (i.e. FLOOR for the seeded half-values). Hours-kind deliverable
-- rows with fractional values are re-synced to the plan's canonical
-- daily/weekly/monthly hours so day/week/month stay consistent.
-- Whole-number custom values are left untouched.

-- 1. Plans: floor any fractional daily_hours (catches Accountant).
UPDATE subscription_plans
SET daily_hours = FLOOR(daily_hours)
WHERE daily_hours IS NOT NULL
  AND daily_hours % 1 <> 0;

-- 2. Plan-level default deliverables: re-sync fractional hours rows
--    to the plan's canonical hours.
UPDATE subscription_plan_deliverables d
SET per_day   = COALESCE(p.daily_hours,   FLOOR(d.per_day))::numeric,
    per_week  = COALESCE(p.weekly_hours,  FLOOR(d.per_week))::numeric,
    per_month = COALESCE(p.monthly_hours, FLOOR(d.per_month), FLOOR(d.per_week) * 4)::numeric,
    updated_at = now()
FROM subscription_plans p
WHERE d.plan_id = p.id
  AND d.kind = 'hours'
  AND (d.per_day % 1 <> 0 OR d.per_week % 1 <> 0 OR d.per_month % 1 <> 0);

-- 3. Per-client mirrors of the plan defaults: same treatment.
UPDATE client_subscription_deliverables cd
SET per_day   = COALESCE(p.daily_hours,   FLOOR(cd.per_day))::numeric,
    per_week  = COALESCE(p.weekly_hours,  FLOOR(cd.per_week))::numeric,
    per_month = COALESCE(p.monthly_hours, FLOOR(cd.per_month), FLOOR(cd.per_week) * 4)::numeric,
    updated_at = now()
FROM client_subscriptions cs
JOIN subscription_plans p ON p.id = cs.plan_id
WHERE cd.client_subscription_id = cs.id
  AND cd.kind = 'hours'
  AND (cd.per_day % 1 <> 0 OR cd.per_week % 1 <> 0 OR cd.per_month % 1 <> 0);

-- 4. Frozen plan snapshots on published cards: rewrite fractional
--    hours entries in place using the snapshot's own plan id.
UPDATE subscription_cards c
SET plan_snapshot = jsonb_set(
  c.plan_snapshot,
  '{deliverables}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN d->>'kind' = 'hours'
             AND ( ((d->>'per_day')::numeric   % 1 <> 0)
                OR ((d->>'per_week')::numeric  % 1 <> 0)
                OR ((d->>'per_month')::numeric % 1 <> 0) )
        THEN jsonb_build_object(
          'id',                    d->'id',
          'kind',                  d->'kind',
          'deliverable_type_id',   d->'deliverable_type_id',
          'deliverable_type_name', d->'deliverable_type_name',
          'per_day',   COALESCE(p.daily_hours,   FLOOR((d->>'per_day')::numeric),  0)::int,
          'per_week',  COALESCE(p.weekly_hours,  FLOOR((d->>'per_week')::numeric), 0)::int,
          'per_month', COALESCE(p.monthly_hours, FLOOR((d->>'per_month')::numeric), FLOOR((d->>'per_week')::numeric) * 4, 0)::int,
          'sort_order', d->'sort_order'
        )
        ELSE d
      END
      ORDER BY ord
    )
    FROM jsonb_array_elements(c.plan_snapshot->'deliverables')
         WITH ORDINALITY AS t(d, ord)
  ),
  true
)
FROM subscription_plans p
WHERE c.plan_snapshot IS NOT NULL
  AND p.id = (c.plan_snapshot->'plan'->>'id')::uuid
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(c.plan_snapshot->'deliverables') d
    WHERE d->>'kind' = 'hours'
      AND ( ((d->>'per_day')::numeric   % 1 <> 0)
         OR ((d->>'per_week')::numeric  % 1 <> 0)
         OR ((d->>'per_month')::numeric % 1 <> 0) )
  );
