-- Preserve Home's existing membership checks while leaving discarded full
-- task bodies inside Postgres. Custom status/category filtering stays in Node.
CREATE OR REPLACE FUNCTION public.pm_home_task_candidates(
  p_user_id uuid, p_kind text,
  p_include_done boolean DEFAULT false,
  p_include_reviewed boolean DEFAULT false
)
RETURNS SETOF public.tasks
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT t.* FROM public.tasks t
  WHERE CASE p_kind
    WHEN 'new' THEN
      t.recurrence IS NULL AND t.source_kind IS NULL
      AND t.status NOT IN ('done','closed','cancelled','Done','Closed','Cancelled')
      AND (p_user_id = ANY(t.assignee_ids)
        OR (t.created_by = p_user_id AND coalesce(cardinality(t.assignee_ids),0) = 0))
      AND (p_include_reviewed OR NOT EXISTS (
        SELECT 1 FROM public.task_reviews r
        WHERE r.task_id = t.id AND r.user_id = p_user_id))
    WHEN 'focused' THEN
      t.created_by = p_user_id AND t.focused_at IS NOT NULL
      AND (p_include_done OR t.status IS NULL
        OR t.status NOT IN ('done','closed','cancelled','Done','Closed','Cancelled'))
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.pm_home_task_candidates(uuid,text,boolean,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pm_home_task_candidates(uuid,text,boolean,boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
