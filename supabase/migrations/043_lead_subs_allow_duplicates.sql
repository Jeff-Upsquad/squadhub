-- ============================================================
-- 043: Allow a lead to stage the same (subscription, plan) multiple times.
--   Drops the UNIQUE (submission_id, subscription_id, plan_id) constraint
--   added in 039_sales_pipeline_statuses.sql. PostgreSQL auto-names
--   unnamed UNIQUE constraints based on columns, and truncates at 63 chars,
--   so we find it dynamically by matching the key columns.
-- Idempotent — safe to re-run.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT c.conname INTO v_conname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'client_submission_subscriptions'
    AND c.contype = 'u'
    AND (
      SELECT array_agg(att.attname::text ORDER BY att.attname::text)
      FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = k.attnum
    ) = ARRAY['plan_id', 'submission_id', 'subscription_id']::text[]
  LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE client_submission_subscriptions DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
