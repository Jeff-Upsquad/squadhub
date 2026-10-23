-- ============================================================
-- Allow fractional SOP strike points (e.g. 0.5 for low severity)
-- and unique-one-rule-per-page even when lesson_id is NULL.
-- ============================================================

ALTER TABLE sop_enforcement_rules
  ALTER COLUMN strike_points TYPE NUMERIC(6,2)
  USING strike_points::numeric(6,2);

ALTER TABLE sop_strikes
  ALTER COLUMN points TYPE NUMERIC(6,2)
  USING points::numeric(6,2);

-- UNIQUE (item_id, lesson_id) does not treat NULL as equal, so top-page
-- rules (lesson_id IS NULL) could duplicate and ON CONFLICT never matched.
-- Keep the newest row per (item, lesson) then switch to partial uniques.
DELETE FROM sop_enforcement_rules
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY item_id, COALESCE(lesson_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
    ) AS rn
    FROM sop_enforcement_rules
  ) d
  WHERE rn > 1
);

ALTER TABLE sop_enforcement_rules
  DROP CONSTRAINT IF EXISTS sop_enforcement_rules_item_id_lesson_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS sop_enforcement_rules_item_lesson_unique
  ON sop_enforcement_rules (item_id, lesson_id)
  WHERE lesson_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sop_enforcement_rules_item_only_unique
  ON sop_enforcement_rules (item_id)
  WHERE lesson_id IS NULL;

NOTIFY pgrst, 'reload schema';
