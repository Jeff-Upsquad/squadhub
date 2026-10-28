-- Fresh database comparison on every poll; unchanged full task bodies stay
-- beside the data. This is a transport optimization, not a time-based cache.
CREATE OR REPLACE FUNCTION public.pm_home_task_snapshot(
  p_user_id uuid, p_kind text,
  p_include_done boolean DEFAULT false,
  p_include_reviewed boolean DEFAULT false,
  p_task_ids uuid[] DEFAULT NULL,
  p_known_digest text DEFAULT NULL
)
RETURNS json LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  WITH selected AS (
    SELECT c.* FROM public.pm_home_task_candidates(p_user_id,p_kind,p_include_done,p_include_reviewed) c
      WHERE p_kind IN ('new','focused')
    UNION ALL
    SELECT t.* FROM public.tasks t
      WHERE p_kind='assigned' AND t.assignee_ids @> ARRAY[p_user_id]
      AND t.recurrence IS NULL
      AND (p_include_done OR t.status NOT IN ('done','closed','cancelled','Done','Closed','Cancelled'))
    UNION ALL
    SELECT t.* FROM public.tasks t
      WHERE p_kind='worked' AND t.id=ANY(p_task_ids)
      AND (p_include_done OR t.status IS NULL OR t.status NOT IN ('done','closed','cancelled','Done','Closed','Cancelled'))
  ), payload AS (
    SELECT coalesce(json_agg(s ORDER BY CASE WHEN p_kind='assigned' THEN s.due_date ELSE NULL END ASC NULLS LAST,s.id),'[]'::json) AS body FROM selected s
  ), fingerprint AS (
    SELECT body,encode(extensions.digest(convert_to(body::text,'UTF8'),'sha256'),'hex') AS digest FROM payload
  ) SELECT json_build_object('digest',digest,'rows',CASE WHEN digest=p_known_digest THEN NULL::json ELSE body END) FROM fingerprint;
$$;
REVOKE ALL ON FUNCTION public.pm_home_task_snapshot(uuid,text,boolean,boolean,uuid[],text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pm_home_task_snapshot(uuid,text,boolean,boolean,uuid[],text) TO service_role;
NOTIFY pgrst, 'reload schema';
