-- Tenancy smoke test for the baseline. Runs inside a transaction and rolls back.
\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@example.test');
INSERT INTO users (id, email, display_name) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test', 'Alice'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@example.test', 'Bob');
INSERT INTO workspaces (id, name, slug, kind, owner_user_id) VALUES
  ('00000000-0000-0000-0000-00000000aaaa', 'Acme', 'acme', 'business', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000bbbb', 'Bob Talent', 'bob', 'talent', '00000000-0000-0000-0000-0000000000b1');
INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-0000000000b1', 'owner');

-- default label group seeded per workspace
DO $$ BEGIN
  IF (SELECT count(*) FROM label_groups WHERE workspace_id IN ('00000000-0000-0000-0000-00000000aaaa','00000000-0000-0000-0000-00000000bbbb')) <> 2 THEN
    RAISE EXCEPTION 'expected one default label group per workspace';
  END IF;
END $$;

INSERT INTO spaces (id, workspace_id, name, created_by) VALUES
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000aaaa', 'A space', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-00000000bbbb', 'B space', '00000000-0000-0000-0000-0000000000b1');
INSERT INTO lists (id, space_id, name, created_by) VALUES
  ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-0000000005a1', 'A list', '00000000-0000-0000-0000-0000000000a1');
INSERT INTO tasks (id, list_id, title, created_by, assignee_ids) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000001a1', 'A task',
   '00000000-0000-0000-0000-0000000000a1', ARRAY['00000000-0000-0000-0000-0000000000b1']::uuid[])
  ON CONFLICT DO NOTHING;

DO $$
DECLARE ws uuid; n int;
BEGIN
  -- lists/tasks inherit workspace_id from their parents
  SELECT workspace_id INTO ws FROM lists WHERE id = '00000000-0000-0000-0000-0000000001a1';
  IF ws <> '00000000-0000-0000-0000-00000000aaaa' THEN RAISE EXCEPTION 'list workspace not filled'; END IF;
  SELECT workspace_id INTO ws FROM tasks WHERE id = '00000000-0000-0000-0000-0000000000f1';
  IF ws <> '00000000-0000-0000-0000-00000000aaaa' THEN RAISE EXCEPTION 'task workspace not filled'; END IF;
  -- the assignment trigger wrote a notification, scoped to the task's workspace
  SELECT count(*) INTO n FROM notifications
   WHERE user_id = '00000000-0000-0000-0000-0000000000b1' AND workspace_id = '00000000-0000-0000-0000-00000000aaaa';
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 scoped task_assigned notification, got %', n; END IF;
  -- the creator became manager of the space through resource_memberships, scoped too
  SELECT count(*) INTO n FROM resource_memberships WHERE resource_id = '00000000-0000-0000-0000-0000000005a1' AND workspace_id = '00000000-0000-0000-0000-00000000aaaa';
  IF n <> 1 THEN RAISE EXCEPTION 'space creator membership not scoped'; END IF;

  -- a task whose workspace_id disagrees with its list is refused
  BEGIN
    INSERT INTO tasks (list_id, title, workspace_id) VALUES
      ('00000000-0000-0000-0000-0000000001a1', 'cross-tenant', '00000000-0000-0000-0000-00000000bbbb');
    RAISE EXCEPTION 'cross-tenant task insert was NOT refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- moving a list into another workspace's space is refused
  BEGIN
    UPDATE lists SET space_id = '00000000-0000-0000-0000-0000000005b1' WHERE id = '00000000-0000-0000-0000-0000000001a1';
    RAISE EXCEPTION 'cross-tenant list move was NOT refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- a space cannot change workspace
  BEGIN
    UPDATE spaces SET workspace_id = '00000000-0000-0000-0000-00000000bbbb' WHERE id = '00000000-0000-0000-0000-0000000005a1';
    RAISE EXCEPTION 'space workspace change was NOT refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- rows with no parent must name their workspace
  BEGIN
    INSERT INTO checkins (user_id, date) VALUES ('00000000-0000-0000-0000-0000000000b1', current_date);
    RAISE EXCEPTION 'checkin without workspace_id was accepted';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;

  -- cash book can never be enabled
  BEGIN
    INSERT INTO workspace_mini_apps (workspace_id, slug) VALUES ('00000000-0000-0000-0000-00000000aaaa', 'cash-book');
    RAISE EXCEPTION 'cash-book mini app was accepted';
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN NULL;
  END;
END $$;

-- seeds present
DO $$ BEGIN
  IF (SELECT count(*) FROM roles WHERE is_system) < 4 THEN RAISE EXCEPTION 'roles not seeded'; END IF;
  IF NOT EXISTS (SELECT 1 FROM status_groups WHERE key = 'task_workflow') THEN RAISE EXCEPTION 'task_workflow not seeded'; END IF;
  IF NOT EXISTS (SELECT 1 FROM mini_apps WHERE slug = 'check-ins') THEN RAISE EXCEPTION 'mini apps not seeded'; END IF;
  IF NOT EXISTS (SELECT 1 FROM plans WHERE is_default) THEN RAISE EXCEPTION 'default plan not seeded'; END IF;
END $$;
ROLLBACK;
SELECT 'tenancy smoke: ok' AS result;
