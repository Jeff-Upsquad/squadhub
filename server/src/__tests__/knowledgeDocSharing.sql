-- Run only against an empty disposable PostgreSQL database:
-- psql <test-db> -v ON_ERROR_STOP=1 -f server/src/__tests__/knowledgeDocSharing.sql
BEGIN;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.squad_bots(id UUID PRIMARY KEY, slug TEXT UNIQUE);
CREATE TABLE public.lms_items(
  id UUID PRIMARY KEY, track TEXT, origin_item_id UUID,
  bot_id UUID REFERENCES public.squad_bots(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, UPDATE ON public.lms_items TO service_role;
GRANT SELECT ON public.squad_bots TO service_role;
INSERT INTO squad_bots VALUES
  ('00000000-0000-4000-8000-000000000001', 'squad-hiring-bot'),
  ('00000000-0000-4000-8000-000000000002', 'customer-bot');
INSERT INTO lms_items(id, track, bot_id) VALUES
  ('10000000-0000-4000-8000-000000000001', 'knowledge', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'knowledge', NULL),
  ('10000000-0000-4000-8000-000000000003', 'learning', NULL);

\ir ../../../supabase/migrations/20260927170000_shared_knowledge_docs.sql

DO $$ BEGIN
  ASSERT (SELECT count(*) = 2 FROM squad_bot_knowledge_docs), 'Backfill must preserve assigned and implicit hiring docs';
  ASSERT NOT has_table_privilege('authenticated', 'squad_bot_knowledge_docs', 'SELECT'), 'Links are server-only';
  ASSERT NOT has_function_privilege('anon', 'set_knowledge_doc_bots(uuid,uuid[])', 'EXECUTE'), 'Anonymous callers cannot change sharing';
END $$;

SET LOCAL ROLE service_role;
SELECT set_knowledge_doc_bots('10000000-0000-4000-8000-000000000001', ARRAY[
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000002'
]::uuid[]);
DO $$ BEGIN
  ASSERT (SELECT count(*) = 2 FROM squad_bot_knowledge_docs WHERE item_id = '10000000-0000-4000-8000-000000000001'), 'One doc must link to two bots without duplicate links';
  BEGIN
    PERFORM set_knowledge_doc_bots('10000000-0000-4000-8000-000000000001', ARRAY['00000000-0000-4000-8000-000000000099']::uuid[]);
    RAISE EXCEPTION 'Invalid bot was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  ASSERT (SELECT count(*) = 2 FROM squad_bot_knowledge_docs WHERE item_id = '10000000-0000-4000-8000-000000000001'), 'Invalid updates must preserve existing sharing';
  BEGIN
    PERFORM set_knowledge_doc_bots('10000000-0000-4000-8000-000000000003', ARRAY['00000000-0000-4000-8000-000000000001']::uuid[]);
    RAISE EXCEPTION 'Learning post was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END $$;

SELECT set_knowledge_doc_bots('10000000-0000-4000-8000-000000000001', ARRAY['00000000-0000-4000-8000-000000000002']::uuid[]);
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM squad_bot_knowledge_docs WHERE item_id = '10000000-0000-4000-8000-000000000001' AND bot_id = '00000000-0000-4000-8000-000000000001'), 'Unlinked bots must lose access';
END $$;
SELECT set_knowledge_doc_bots('10000000-0000-4000-8000-000000000001', ARRAY[]::uuid[]);
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM squad_bot_knowledge_docs WHERE item_id = '10000000-0000-4000-8000-000000000001'), 'Empty selection unlinks every bot';
  ASSERT EXISTS (SELECT 1 FROM lms_items WHERE id = '10000000-0000-4000-8000-000000000001'), 'Unlinking must not delete content';
END $$;
RESET ROLE;

-- Older creation paths still seed the link automatically; clones never do.
INSERT INTO lms_items(id, track, bot_id) VALUES ('10000000-0000-4000-8000-000000000004', 'knowledge', '00000000-0000-4000-8000-000000000002');
INSERT INTO lms_items(id, track, bot_id, origin_item_id) VALUES ('10000000-0000-4000-8000-000000000005', 'knowledge', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004');
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM squad_bot_knowledge_docs WHERE item_id = '10000000-0000-4000-8000-000000000004'), 'Legacy creators must still work';
  ASSERT NOT EXISTS (SELECT 1 FROM squad_bot_knowledge_docs WHERE item_id = '10000000-0000-4000-8000-000000000005'), 'Review clones must stay private';
END $$;
DELETE FROM squad_bots WHERE slug = 'customer-bot';
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM squad_bot_knowledge_docs WHERE bot_id = '00000000-0000-4000-8000-000000000002'), 'Deleting a bot removes its links';
  ASSERT EXISTS (SELECT 1 FROM lms_items WHERE id = '10000000-0000-4000-8000-000000000004'), 'Deleting a bot preserves docs';
END $$;
ROLLBACK;
