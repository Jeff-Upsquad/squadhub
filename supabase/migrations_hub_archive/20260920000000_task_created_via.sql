-- 20260920000000_task_created_via.sql
-- Track which client platform created each task.
--
-- `source_kind` (migration 127) is the DOMAIN origin (course/meeting/sop/post,
-- NULL = ordinary task). `created_via` is the CLIENT platform that performed
-- the insert. Both are needed: e.g. a course mirror task is source_kind='course'
-- + created_via='system', while a hand-typed task in the same list is
-- source_kind=NULL + created_via='web' | 'companion' | 'partner_app' | ...
--
-- Contract for all writers (in-repo + the 3 external native Android apps
-- Partner / Internal / Business):
--   1. Send header `X-Client-Source: <value>` on POST /pm/tasks (preferred), or
--   2. Send body field `client_source: <value>`.
-- Server allowlist lives in server/src/utils/clientSource.ts. Unknown / absent
-- values fall back to User-Agent heuristics, then 'unknown' — never rejected,
-- so old app versions keep working.
--
-- Existing rows predate tracking and stay 'unknown' (honest backfill).

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS created_via TEXT NOT NULL DEFAULT 'unknown';

-- Allowlist: every known writer. 'mobile_app' is the generic fallback for a
-- native app that has not upgraded to send its specific value yet.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_created_via_check'
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_created_via_check CHECK (
      created_via IN (
        'web', 'mobile_web', 'desktop_app', 'companion',
        'partner_app', 'internal_app', 'business_app', 'mobile_app',
        'public_form', 'system', 'api', 'unknown'
      )
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_created_via
  ON tasks (created_via);

COMMENT ON COLUMN tasks.created_via IS
  'Client platform that created the task (web|mobile_web|desktop_app|companion|partner_app|internal_app|business_app|mobile_app|public_form|system|api|unknown). Orthogonal to source_kind (domain origin).';
