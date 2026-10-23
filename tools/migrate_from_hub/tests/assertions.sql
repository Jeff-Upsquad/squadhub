-- Assertions run against the throwaway local SaaS DB after copy --execute.
\set ON_ERROR_STOP 1
DO $$
DECLARE n int; ws uuid; sw uuid;
BEGIN
  SELECT count(*) INTO n FROM public.workspaces WHERE kind = 'business';
  IF n <> 2 THEN RAISE EXCEPTION 'expected 2 business accounts, got %', n; END IF;
  SELECT count(*) INTO n FROM public.workspaces WHERE kind = 'talent';
  IF n <> 3 THEN RAISE EXCEPTION 'expected 3 talent accounts, got %', n; END IF;
  SELECT count(*) INTO n FROM public.workspaces WHERE kind = 'shared';
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 shared workspace, got %', n; END IF;

  SELECT id INTO sw FROM public.workspaces WHERE kind = 'shared';
  SELECT host_workspace_id INTO ws FROM public.workspaces WHERE id = sw;
  IF ws IS NULL OR NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = ws AND kind = 'business' AND hub_client_id IS NOT NULL)
    THEN RAISE EXCEPTION 'shared workspace host not linked to business'; END IF;
  SELECT count(*) INTO n FROM public.shared_workspace_links WHERE shared_workspace_id = sw;
  IF n <> 2 THEN RAISE EXCEPTION 'expected host+talent links, got %', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shared_workspace_links WHERE shared_workspace_id = sw AND participant_role = 'talent'
                 AND hub_card_id IS NOT NULL AND card_category = 'designer')
    THEN RAISE EXCEPTION 'talent link missing card/category'; END IF;
  SELECT count(*) INTO n FROM public.workspace_members WHERE workspace_id = sw AND is_upsquad_staff;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 Upsquad staff member, got %', n; END IF;

  -- content landed in the shared workspace with consistent workspace_id
  SELECT count(*) INTO n FROM public.spaces WHERE workspace_id = sw;
  IF n <> 3 THEN RAISE EXCEPTION 'expected 3 spaces in shared ws, got %', n; END IF;
  SELECT count(*) INTO n FROM public.tasks WHERE workspace_id = sw;
  IF n <> 5 THEN RAISE EXCEPTION 'expected 5 tasks in shared ws, got %', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tasks c JOIN public.tasks p ON p.id = c.parent_task_id WHERE c.workspace_id = sw)
    THEN RAISE EXCEPTION 'subtask parent link lost'; END IF;
  SELECT count(*) INTO n FROM public.task_comments WHERE workspace_id = sw;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 comment (deleted-author one skipped), got %', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.task_attachments WHERE file_url LIKE 'https://files.example.org/%')
    THEN RAISE EXCEPTION 'attachment url not kept as-is'; END IF;
  SELECT count(*) INTO n FROM public.channels WHERE workspace_id = sw AND linked_resource_id IS NOT NULL;
  IF n <> 3 THEN RAISE EXCEPTION 'expected 3 linked channels, got %', n; END IF;
  SELECT count(*) INTO n FROM public.messages WHERE workspace_id = sw;
  IF n <> 4 THEN RAISE EXCEPTION 'expected 4 messages (ghost sender skipped), got %', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.message_threads) THEN RAISE EXCEPTION 'thread link lost'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reactions) THEN RAISE EXCEPTION 'reaction lost'; END IF;
  IF EXISTS (SELECT 1 FROM public.messages WHERE content LIKE 'crm only%') THEN RAISE EXCEPTION 'CRM channel leaked'; END IF;
  IF EXISTS (SELECT 1 FROM public.tasks WHERE title = 'Should not copy') THEN RAISE EXCEPTION 'deleted list copied'; END IF;

  -- no cross-tenant rows (children agree with parents)
  IF EXISTS (SELECT 1 FROM public.tasks t JOIN public.lists l ON l.id = t.list_id WHERE t.workspace_id <> l.workspace_id)
    THEN RAISE EXCEPTION 'task/list workspace mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM public.resource_memberships rm JOIN public.spaces s ON s.id = rm.resource_id
             WHERE rm.resource_type = 'space' AND rm.workspace_id <> s.workspace_id)
    THEN RAISE EXCEPTION 'membership workspace mismatch'; END IF;

  -- talent sees only their category space (+ its channel), not the video space
  IF EXISTS (SELECT 1 FROM public.resource_memberships rm JOIN public.spaces s ON s.id = rm.resource_id
             JOIN public.users u ON u.id = rm.user_id
             WHERE u.email = 'tom@talent.example.org' AND s.name = 'Video Editing Space')
    THEN RAISE EXCEPTION 'talent was granted the video space'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.resource_memberships rm JOIN public.spaces s ON s.id = rm.resource_id
                 JOIN public.users u ON u.id = rm.user_id
                 WHERE u.email = 'tom@talent.example.org' AND s.name = 'Design Space')
    THEN RAISE EXCEPTION 'talent missing design space'; END IF;

  -- migration triggers were suppressed: no notifications, and they're enabled again
  SELECT count(*) INTO n FROM public.notifications;
  IF n <> 0 THEN RAISE EXCEPTION 'copy produced % notifications', n; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_notify_task_assigned','trg_space_statuses','trg_notify_message_mention')
             AND tgenabled = 'D') THEN RAISE EXCEPTION 'a trigger was left disabled'; END IF;

  -- users: hub ids recorded, referenced internal author is active staff
  SELECT count(*) INTO n FROM public.users WHERE hub_user_id IS NOT NULL;
  IF n <> 9 THEN RAISE EXCEPTION 'expected 9 users with hub_user_id, got %', n; END IF;
  SELECT count(*) INTO n FROM public.workspace_mini_apps WHERE slug IN ('check-ins','partner-payments');
  IF n <> 6 THEN RAISE EXCEPTION 'expected talent mini apps on 3 accounts, got %', n; END IF;
  SELECT count(*) INTO n FROM public.space_statuses ss JOIN public.spaces s ON s.id = ss.space_id WHERE s.workspace_id = sw;
  IF n <> 9 THEN RAISE EXCEPTION 'expected Hub statuses copied (3 per space), got %', n; END IF;
  RAISE NOTICE 'assertions passed';
END $$;
