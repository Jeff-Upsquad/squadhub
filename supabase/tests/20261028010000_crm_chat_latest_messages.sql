BEGIN;
SET LOCAL session_replication_role = replica;
DO $$
DECLARE
  ch uuid := gen_random_uuid();
  other_ch uuid := gen_random_uuid();
  empty_ch uuid := gen_random_uuid();
  author uuid := (SELECT id FROM public.users LIMIT 1);
  ws uuid := (SELECT id FROM public.workspaces LIMIT 1);
  stamp timestamptz := statement_timestamp();
  actual jsonb;
BEGIN
  ASSERT author IS NOT NULL AND ws IS NOT NULL, 'Run against an isolated rehearsal with fixture users/workspaces';
  INSERT INTO public.channels(id,workspace_id,name) VALUES
    (ch,ws,'Migration preview fixture'),(other_ch,ws,'Excluded fixture'),(empty_ch,ws,'Empty fixture');
  INSERT INTO public.messages(id,channel_id,sender_id,content,created_at,is_deleted) VALUES
    (gen_random_uuid(),ch,author,'Old history',stamp - interval '1 hour',false),
    ('00000000-0000-0000-0000-000000000001',ch,author,'Earlier tie',stamp,false),
    ('00000000-0000-0000-0000-000000000002',ch,author,'Latest preview',stamp,false),
    (gen_random_uuid(),ch,author,'Deleted newer message',stamp + interval '1 minute',true),
    (gen_random_uuid(),other_ch,author,'Other channel',stamp,false);
  SELECT jsonb_agg(to_jsonb(m)) INTO actual FROM public.crm_chat_latest_messages(ARRAY[ch,ch,empty_ch]) m;
  ASSERT jsonb_array_length(actual) = 1, 'One latest live message per requested channel; duplicate IDs do not duplicate rows';
  ASSERT actual->0->>'content' = 'Latest preview', 'Ignores old history and deleted messages; deterministic timestamp ties';
  ASSERT actual->0->>'channel_id' = ch::text, 'Never returns an unrequested channel';
  ASSERT (SELECT count(*) FROM public.crm_chat_latest_messages(ARRAY[]::uuid[])) = 0, 'Empty input';
  ASSERT (SELECT count(*) FROM public.crm_chat_latest_messages(NULL::uuid[])) = 0, 'Null input';
  ASSERT NOT has_function_privilege('anon','public.crm_chat_latest_messages(uuid[])','EXECUTE'), 'Anonymous access denied';
  ASSERT NOT has_function_privilege('authenticated','public.crm_chat_latest_messages(uuid[])','EXECUTE'), 'User-scoped access denied';
  ASSERT has_function_privilege('service_role','public.crm_chat_latest_messages(uuid[])','EXECUTE'), 'Server access allowed';
END $$;
ROLLBACK;
