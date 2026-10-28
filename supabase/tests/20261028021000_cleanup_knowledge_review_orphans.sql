BEGIN;
SET LOCAL session_replication_role = replica;
DO $$
DECLARE
  send_id uuid := gen_random_uuid(); other_send uuid := gen_random_uuid();
  recipient uuid := gen_random_uuid(); wrong_recipient uuid := gen_random_uuid();
  kept uuid := gen_random_uuid(); orphan uuid := gen_random_uuid(); wrong_kind uuid := gen_random_uuid();
  unrelated uuid := gen_random_uuid(); null_source uuid := gen_random_uuid(); fixture_list uuid := gen_random_uuid();
  removed bigint;
BEGIN
  INSERT INTO public.lms_task_sends(id,item_id,scope,title,source_kind) VALUES
    (send_id,gen_random_uuid(),'item','Knowledge fixture','knowledge'),
    (other_send,gen_random_uuid(),'item','Course fixture','course');
  -- A valid recipient beyond the usual 1000-row Data API page must survive.
  INSERT INTO public.lms_task_send_recipients(send_id,user_id)
    SELECT send_id,gen_random_uuid() FROM generate_series(1,1001);
  INSERT INTO public.lms_task_send_recipients(id,send_id,user_id) VALUES
    (recipient,send_id,gen_random_uuid()),(wrong_recipient,other_send,gen_random_uuid());
  INSERT INTO public.tasks(id,list_id,title,source_kind,source_id) VALUES
    (kept,fixture_list,'Keep valid review','knowledge',recipient),
    (orphan,fixture_list,'Missing recipient','knowledge',gen_random_uuid()),
    (wrong_kind,fixture_list,'Source is not knowledge','knowledge',wrong_recipient),
    (unrelated,fixture_list,'Unrelated task','course',gen_random_uuid()),
    (null_source,fixture_list,'Null source','knowledge',NULL);
  removed := public.cleanup_knowledge_review_orphans();
  ASSERT removed >= 3, 'Deletes orphaned knowledge tasks';
  ASSERT EXISTS(SELECT FROM public.tasks WHERE id=kept), 'Valid review beyond page limit preserved';
  ASSERT EXISTS(SELECT FROM public.tasks WHERE id=unrelated), 'Other task types preserved';
  ASSERT NOT EXISTS(SELECT FROM public.tasks WHERE id IN (orphan,wrong_kind,null_source)), 'Only invalid knowledge mirrors removed';
  ASSERT NOT has_function_privilege('anon','public.cleanup_knowledge_review_orphans()','EXECUTE'), 'Anonymous denied';
  ASSERT NOT has_function_privilege('authenticated','public.cleanup_knowledge_review_orphans()','EXECUTE'), 'User role denied';
  ASSERT has_function_privilege('service_role','public.cleanup_knowledge_review_orphans()','EXECUTE'), 'Service allowed';
END $$;
ROLLBACK;
