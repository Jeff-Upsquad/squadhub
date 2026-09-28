# Knowledge Doc reviews

Apply `supabase/migrations/20260928150000_knowledge_review_tasks.sql` before deploying the server and web changes. The migration chooses the active internal user `jeff@upsquadconnect.com` as reviewer in `lms_knowledge_review_config`. To change the reviewer later, update that one row's `reviewer_user_id`.

The database queues edits to knowledge document metadata, pages and subpages, content blocks, videos, quizzes, and page access. It excludes review clones. The server drains that queue every 30 seconds, shares each document with the reviewer, and assigns one Resources task per document or page. Repeated edits reopen the same task; completing it removes the Home **Knowledge Doc** card when no reviews remain. The reviewer opens the task to inspect its page and uses **Mark reviewed** in the reader.

Existing published docs receive one whole-document task during migration. Future page changes receive page-specific tasks. The same mechanism covers pages generated or changed by a bot because it watches database writes rather than only the web editor.

Validation after deployment:

1. In Jeff's Resources, open **Squad Hiring Bot Knowledge** and check its page tree.
2. In Home, open **Knowledge Doc**; the existing document review should be assigned there.
3. Mark that task reviewed; the card disappears when it has no other tasks.
4. Create or edit a knowledge subpage. Within 30 seconds, a task for that page appears. Mark it reviewed, edit the page again, and confirm the same task reopens.
