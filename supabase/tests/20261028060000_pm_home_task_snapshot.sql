BEGIN;
SET LOCAL session_replication_role=replica;
DO $$
DECLARE u uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); l uuid:=gen_random_uuid(); task uuid:=gen_random_uuid(); closed_task uuid:=gen_random_uuid();
 a json; b json; c json;
BEGIN
 INSERT INTO public.tasks(id,list_id,title,status,created_by,assignee_ids,focused_at) VALUES
 (task,l,'snapshot fixture','open',u,ARRAY[u],now()),(closed_task,l,'completed fixture','closed',u,ARRAY[u],now());
 a:=public.pm_home_task_snapshot(u,'assigned');
 ASSERT json_array_length(a->'rows')=1, 'Assigned open membership';
 b:=public.pm_home_task_snapshot(u,'assigned',false,false,NULL,a->>'digest');
 ASSERT b->>'rows' IS NULL AND a->>'digest'=b->>'digest', 'Unchanged payload withheld after fresh comparison';
 UPDATE public.tasks SET description='Changed without waiting for a cache timeout' WHERE id=task;
 c:=public.pm_home_task_snapshot(u,'assigned',false,false,NULL,a->>'digest');
 ASSERT c->>'digest'<>a->>'digest' AND json_array_length(c->'rows')=1, 'Body changes observed immediately';
 ASSERT json_array_length(public.pm_home_task_snapshot(other_user,'assigned')->'rows')=0, 'Other users isolated';
 ASSERT json_array_length(public.pm_home_task_snapshot(u,'assigned',true)->'rows')=2, 'Include completed retained';
 ASSERT json_array_length(public.pm_home_task_snapshot(u,'worked',false,false,ARRAY[task,closed_task])->'rows')=1, 'Completed worked extras excluded before transfer';
 INSERT INTO public.task_reviews(task_id,user_id) VALUES(task,u);
 ASSERT json_array_length(public.pm_home_task_snapshot(u,'new')->'rows')=0, 'Reviewed excluded';
 ASSERT json_array_length(public.pm_home_task_snapshot(u,'new',false,true)->'rows')=1, 'Show reviewed retained';
 INSERT INTO public.tasks(list_id,title,status,created_by,assignee_ids) SELECT l,'page fixture','open',u,ARRAY[u] FROM generate_series(1,1001);
 ASSERT json_array_length(public.pm_home_task_snapshot(u,'new')->'rows')=1001, 'Eligible rows beyond Data API cap preserved';
 ASSERT NOT has_function_privilege('anon','public.pm_home_task_snapshot(uuid,text,boolean,boolean,uuid[],text)','EXECUTE'), 'Anonymous denied';
 ASSERT NOT has_function_privilege('authenticated','public.pm_home_task_snapshot(uuid,text,boolean,boolean,uuid[],text)','EXECUTE'), 'User role denied';
 ASSERT has_function_privilege('service_role','public.pm_home_task_snapshot(uuid,text,boolean,boolean,uuid[],text)','EXECUTE'), 'Service allowed';
END $$;
SET LOCAL ROLE service_role;
SELECT public.pm_home_task_snapshot('00000000-0000-0000-0000-000000000000','assigned');
ROLLBACK;
