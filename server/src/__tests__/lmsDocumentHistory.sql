-- Run only in an empty disposable database. Uses separate transactions to model saves.
\set ON_ERROR_STOP on
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE lms_items(id UUID PRIMARY KEY, title TEXT, summary TEXT, updated_at TIMESTAMPTZ DEFAULT now(), squadhire_synced_at TIMESTAMPTZ, squadhire_last_error TEXT);
CREATE TABLE lms_lessons(id UUID PRIMARY KEY, item_id UUID REFERENCES lms_items ON DELETE CASCADE, title TEXT, summary TEXT, position INT DEFAULT 0, is_active BOOLEAN DEFAULT true, parent_lesson_id UUID REFERENCES lms_lessons ON DELETE CASCADE, updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE lms_content_blocks(id UUID PRIMARY KEY, lesson_id UUID REFERENCES lms_lessons ON DELETE CASCADE, position INT DEFAULT 0, type TEXT DEFAULT 'text', text_content JSONB, updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE lms_content_block_videos(id UUID PRIMARY KEY, block_id UUID REFERENCES lms_content_blocks ON DELETE CASCADE, language TEXT, file_url TEXT);
CREATE TABLE lms_quiz_questions(id UUID PRIMARY KEY, block_id UUID REFERENCES lms_content_blocks ON DELETE CASCADE, position INT DEFAULT 0, prompt TEXT);
INSERT INTO lms_items(id,title) VALUES ('10000000-0000-4000-8000-000000000001','Hiring knowledge');
INSERT INTO lms_lessons(id,item_id,title) VALUES ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Onboarding');
INSERT INTO lms_content_blocks(id,lesson_id,text_content) VALUES ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','{"text":"Original answer"}');
\ir ../../../supabase/migrations/20260928090000_lms_document_history.sql
-- Model two versions saved before page IDs were recorded. The second is a
-- same-title page addition and must not be assigned to the existing page.
INSERT INTO lms_item_versions(item_id,transaction_id,change_label,page_title,snapshot) VALUES
 ('10000000-0000-4000-8000-000000000001',-1,'Content updated','Onboarding',
  '{"document":{"title":"Hiring knowledge"},"pages":[{"id":"20000000-0000-4000-8000-000000000001","title":"Onboarding","blocks":[]}]}'),
 ('10000000-0000-4000-8000-000000000001',-2,'Page added','Onboarding',
  '{"document":{"title":"Hiring knowledge"},"pages":[{"id":"20000000-0000-4000-8000-000000000001","title":"Onboarding","blocks":[]}]}');
\ir ../../../supabase/migrations/20260928170000_lms_page_history.sql
DO $$ BEGIN
 ASSERT (SELECT page_id = '20000000-0000-4000-8000-000000000001' FROM lms_item_versions WHERE transaction_id = -1), 'Existing page history is assigned by stable ID';
 ASSERT (SELECT page_id IS NULL FROM lms_item_versions WHERE transaction_id = -2), 'Same-title additions are not attributed to another page';
END $$;
DELETE FROM lms_item_versions WHERE transaction_id IN (-1,-2);
GRANT SELECT, INSERT, UPDATE, DELETE ON lms_items, lms_lessons, lms_content_blocks, lms_content_block_videos, lms_quiz_questions TO service_role;
SET ROLE service_role;
UPDATE lms_content_blocks SET text_content = '{"text":"New answer"}';
DO $$ BEGIN
 ASSERT (SELECT count(*) = 1 FROM lms_item_versions), 'Every saved change captures history';
 ASSERT (SELECT page_id = '20000000-0000-4000-8000-000000000001' FROM lms_item_versions), 'Changes identify their page';
 ASSERT (SELECT snapshot->'pages'->0->'blocks'->0->'text_content'->>'text' = 'Original answer' FROM lms_item_versions), 'History contains the pre-save content';
 ASSERT (SELECT count(*) = 1 FROM lms_lessons), 'History must not create navigation pages';
 ASSERT NOT has_table_privilege('anon','lms_item_versions','SELECT'), 'No anonymous history reads';
 ASSERT NOT has_table_privilege('authenticated','lms_item_versions','SELECT'), 'No direct user history reads';
 ASSERT NOT has_table_privilege('service_role','lms_item_versions','UPDATE'), 'Snapshots cannot be edited';
 ASSERT NOT has_function_privilege('authenticated','capture_lms_item_version(uuid,text,text,uuid)','EXECUTE'), 'Cannot invoke privileged snapshot function';
END $$;
UPDATE lms_content_blocks SET text_content = '{"text":"New answer"}', updated_at = now();
UPDATE lms_items SET squadhire_synced_at = now(), squadhire_last_error = 'retry', updated_at = now();
DO $$ BEGIN ASSERT (SELECT count(*) = 1 FROM lms_item_versions), 'No-op writes and sync bookkeeping must not produce versions'; END $$;
BEGIN;
UPDATE lms_lessons SET title = 'New title';
UPDATE lms_content_blocks SET text_content = '{"text":"Two edits"}';
COMMIT;
DO $$ BEGIN
 ASSERT (SELECT count(*) = 2 FROM lms_item_versions), 'Bulk transaction is one complete version';
 ASSERT (SELECT snapshot->'pages'->0->>'title' = 'Onboarding' FROM lms_item_versions ORDER BY changed_at DESC LIMIT 1), 'Captures original page title';
 ASSERT (SELECT snapshot->'pages'->0->'blocks'->0->'text_content'->>'text' = 'New answer' FROM lms_item_versions ORDER BY changed_at DESC LIMIT 1), 'Full state before the first change';
END $$;
BEGIN;
UPDATE lms_content_blocks SET text_content = '{"text":"Rolled back"}';
ROLLBACK;
DO $$ BEGIN ASSERT (SELECT count(*) = 2 FROM lms_item_versions), 'Failed/rolled back changes leave no history'; END $$;
INSERT INTO lms_content_block_videos VALUES ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','en','https://example.com/original.mp4');
UPDATE lms_content_block_videos SET file_url = 'https://example.com/new.mp4';
DO $$ BEGIN
 ASSERT (SELECT snapshot->'pages'->0->'blocks'->0->'videos'->0->>'file_url' = 'https://example.com/original.mp4' FROM lms_item_versions ORDER BY changed_at DESC LIMIT 1), 'Language videos preserved';
END $$;
INSERT INTO lms_quiz_questions VALUES ('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',0,'Original question');
UPDATE lms_quiz_questions SET prompt = 'Updated question';
DO $$ BEGIN
 ASSERT (SELECT snapshot->'pages'->0->'blocks'->0->'quiz_questions'->0->>'prompt' = 'Original question' FROM lms_item_versions ORDER BY changed_at DESC LIMIT 1), 'Quiz changes preserved';
END $$;
DELETE FROM lms_content_blocks;
DO $$ BEGIN
 ASSERT (SELECT jsonb_array_length(snapshot->'pages'->0->'blocks') = 1 FROM lms_item_versions ORDER BY changed_at DESC LIMIT 1), 'Deleted blocks preserved';
END $$;
UPDATE lms_items SET title = 'Renamed document';
DO $$ BEGIN
 ASSERT (SELECT snapshot->'document'->>'title' = 'Hiring knowledge' FROM lms_item_versions ORDER BY changed_at DESC LIMIT 1), 'Document metadata preserved';
END $$;
DELETE FROM lms_lessons;
DO $$ BEGIN
 ASSERT (SELECT count(*) > 0 FROM lms_item_versions), 'Deleting a page retains document history';
 ASSERT (SELECT jsonb_array_length(snapshot->'pages') = 1 FROM lms_item_versions ORDER BY changed_at DESC LIMIT 1), 'Deleted pages preserved';
END $$;
DELETE FROM lms_items;
DO $$ BEGIN ASSERT (SELECT count(*) = 0 FROM lms_item_versions), 'Deleting a document removes its private history'; END $$;
RESET ROLE;

-- A document's initial auto-page is not history. Review approval moves the
-- draft pages, then deletes the old pages; the original must retain its past.
SET ROLE service_role;
INSERT INTO lms_items(id,title) VALUES
 ('10000000-0000-4000-8000-000000000001','Original'),
 ('10000000-0000-4000-8000-000000000002','Review draft');
INSERT INTO lms_lessons(id,item_id,title) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Original page'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Replacement page');
DO $$ BEGIN ASSERT (SELECT count(*) = 0 FROM lms_item_versions), 'No empty initial version'; END $$;
UPDATE lms_lessons SET item_id = '10000000-0000-4000-8000-000000000001' WHERE id = '20000000-0000-4000-8000-000000000002';
DELETE FROM lms_lessons WHERE id = '20000000-0000-4000-8000-000000000001';
DELETE FROM lms_items WHERE id = '10000000-0000-4000-8000-000000000002';
DO $$ BEGIN
 ASSERT EXISTS (SELECT 1 FROM lms_item_versions WHERE item_id = '10000000-0000-4000-8000-000000000001' AND snapshot->'pages'->0->>'title' = 'Original page'), 'Review replacement preserves previous pages';
END $$;
RESET ROLE;

-- Editing two pages in one transaction gives each page its own pre-change entry.
SET ROLE service_role;
INSERT INTO lms_items(id,title) VALUES ('10000000-0000-4000-8000-000000000003','Two pages');
INSERT INTO lms_lessons(id,item_id,title) VALUES
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','First'),
 ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000003','Second');
INSERT INTO lms_content_blocks(id,lesson_id,text_content) VALUES
 ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','{"text":"First before"}'),
 ('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000004','{"text":"Second before"}');
BEGIN;
UPDATE lms_content_blocks SET text_content = '{"text":"After"}' WHERE id IN ('30000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000004');
COMMIT;
DO $$ BEGIN
 ASSERT (SELECT count(*) = 2 FROM lms_item_versions WHERE item_id = '10000000-0000-4000-8000-000000000003' AND change_label = 'Content updated'), 'Both edited pages get history';
 ASSERT (SELECT count(DISTINCT page_id) = 2 FROM lms_item_versions WHERE item_id = '10000000-0000-4000-8000-000000000003' AND change_label = 'Content updated'), 'Page histories do not overlap';
END $$;
RESET ROLE;
