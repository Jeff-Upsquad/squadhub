-- Keep the existing orphan cleanup beside the data instead of downloading
-- all recipient IDs and knowledge-task IDs every thirty seconds.
CREATE OR REPLACE FUNCTION public.cleanup_knowledge_review_orphans()
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE removed bigint;
BEGIN
  DELETE FROM public.tasks t
  WHERE t.source_kind = 'knowledge' AND NOT EXISTS (
    SELECT 1 FROM public.lms_task_send_recipients r
    JOIN public.lms_task_sends s ON s.id = r.send_id
    WHERE r.id = t.source_id AND s.source_kind = 'knowledge');
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION public.cleanup_knowledge_review_orphans() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_knowledge_review_orphans() TO service_role;
NOTIFY pgrst, 'reload schema';
