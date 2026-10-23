-- ============================================================
-- Normalize task status casing: 'OPEN' vs 'open' split boards into two
-- groups because grouping keys on the raw TEXT value.
--
-- tasks.status must hold the stable KEY from the list's effective status
-- group (list > folder > space > template > default). This heals existing
-- rows created before server-side normalization (POST/PUT /pm/tasks now
-- resolves via normalizeTaskStatusForList).
--
-- Scoped to task_type='task' rows whose lowercased value is a known
-- workflow key, so custom space statuses (which store NAME, e.g.
-- 'In Progress') are untouched.
--
-- Idempotent — safe to re-run.
-- ============================================================

UPDATE tasks
SET status = lower(status)
WHERE task_type_id IN (SELECT id FROM task_types WHERE key = 'task')
  AND status <> lower(status)
  AND lower(status) IN (
    'open','empty','scheduled','reminder','back_burner','up_next',
    'this_week','tomorrow','front_burner','today','focus_now',
    'emergency','urgent','over_due','high_priority','priority',
    'active','in_progress','in_code_review','testing_qa',
    'ready_for_deploy','time_tracked','active_daily','planning',
    'ready_to_code','routines','imp_routines',
    'waiting_on_dependency','blocked','on_hold','follow_ups',
    'help','unblocked','closed','cancelled'
  );
