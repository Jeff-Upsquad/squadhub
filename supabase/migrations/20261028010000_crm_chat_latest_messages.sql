-- Chat previews need one live message per channel, not every message body.
-- The caller checks workspace membership and passes only visible channel IDs.
CREATE OR REPLACE FUNCTION public.crm_chat_latest_messages(p_channel_ids uuid[])
RETURNS TABLE (channel_id uuid, content text, created_at timestamptz, is_deleted boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  SELECT c.channel_id, m.content, m.created_at, m.is_deleted
  FROM (SELECT DISTINCT unnest(p_channel_ids) AS channel_id) c
  CROSS JOIN LATERAL (
    SELECT msg.content, msg.created_at, msg.is_deleted
    FROM public.messages msg
    WHERE msg.channel_id = c.channel_id AND msg.is_deleted = false
    ORDER BY msg.created_at DESC, msg.id DESC LIMIT 1
  ) m;
$$;
REVOKE ALL ON FUNCTION public.crm_chat_latest_messages(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_chat_latest_messages(uuid[]) TO service_role;
NOTIFY pgrst, 'reload schema';
