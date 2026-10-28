BEGIN;
SET LOCAL session_replication_role = replica;
DO $$
DECLARE
 u uuid := gen_random_uuid(); other_user uuid := gen_random_uuid(); l uuid := gen_random_uuid();
 assigned uuid := gen_random_uuid(); own_empty uuid := gen_random_uuid(); own_null uuid := gen_random_uuid();
 other_assigned uuid := gen_random_uuid(); reviewed uuid := gen_random_uuid(); completed uuid := gen_random_uuid();
 mirrored uuid := gen_random_uuid(); routine uuid := gen_random_uuid();
 actual uuid[]; expected uuid[];
BEGIN
 INSERT INTO public.tasks(id,list_id,title,status,created_by,assignee_ids,focused_at) VALUES
 (assigned,l,'assigned fixture','open',other_user,ARRAY[u],NULL),
 (own_empty,l,'empty fixture','open',u,'{}',now()),
 (own_null,l,'custom status fixture','video_editing',u,'{}',now()),
 (other_assigned,l,'other fixture','open',u,ARRAY[other_user],NULL),
 (reviewed,l,'reviewed fixture','open',other_user,ARRAY[u],NULL),
 (completed,l,'completed fixture','closed',u,ARRAY[u],now()),
 (mirrored,l,'mirror fixture','open',u,ARRAY[u],NULL),
 (routine,l,'routine fixture','open',u,ARRAY[u],NULL);
 UPDATE public.tasks SET source_kind='knowledge' WHERE id=mirrored;
 UPDATE public.tasks SET recurrence='{"frequency":"daily"}'::jsonb WHERE id=routine;
 INSERT INTO public.task_reviews(task_id,user_id) VALUES(reviewed,u),(assigned,other_user);
 SELECT array_agg(id ORDER BY id) INTO actual FROM public.pm_home_task_candidates(u,'new');
 SELECT array_agg(x ORDER BY x) INTO expected FROM unnest(ARRAY[assigned,own_empty,own_null]) x;
 ASSERT actual=expected, 'Assignment, empty assignees, own reviews, mirrors, routines and completed membership';
 ASSERT EXISTS(SELECT FROM public.pm_home_task_candidates(u,'new',false,true) WHERE id=reviewed), 'Show reviewed retained';
 ASSERT EXISTS(SELECT FROM public.pm_home_task_candidates(u,'focused') WHERE id=own_null), 'Custom-status focus retained';
 ASSERT NOT EXISTS(SELECT FROM public.pm_home_task_candidates(u,'focused') WHERE id=completed), 'Completed focus excluded';
 ASSERT EXISTS(SELECT FROM public.pm_home_task_candidates(u,'focused',true) WHERE id=completed), 'Include completed retained';
 ASSERT NOT EXISTS(SELECT FROM public.pm_home_task_candidates(u,'unknown')), 'Unknown mode fails closed';
 ASSERT NOT has_function_privilege('anon','public.pm_home_task_candidates(uuid,text,boolean,boolean)','EXECUTE'), 'Anonymous denied';
 ASSERT NOT has_function_privilege('authenticated','public.pm_home_task_candidates(uuid,text,boolean,boolean)','EXECUTE'), 'User role denied';
 ASSERT has_function_privilege('service_role','public.pm_home_task_candidates(uuid,text,boolean,boolean)','EXECUTE'), 'Service allowed';
END $$;
ROLLBACK;
