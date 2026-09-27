# Document history

Apply `supabase/migrations/20260928090000_lms_document_history.sql` before deploying the server, admin, and web changes. No existing content is rewritten. History begins with the first content/settings change after the migration; earlier versions cannot be reconstructed.

The **Changes** control at the bottom of a page opens the document's previous saved versions. Selecting an entry opens a read-only snapshot with its own page picker and a return link. It is available in the admin editor, the main-app editor, and the main-app reader for document admins. There is no restore or edit action on historical content.

Snapshots live in `lms_item_versions`, outside the normal item/page tables. They are excluded from the library, navigation, search, bot retrieval, and SquadHire synchronization. Only the server can read them; history routes require global admin or document-admin access because snapshots may contain old drafts and quiz answers. Historical versions do not expand the current document's audience.

Database triggers save the full document before a content or settings write, including pages, rich text, block metadata/media URLs, language videos, and quizzes. Existing writes from both editors, bot integrations, and review approval are covered. A single database transaction creates one snapshot; separate autosaves create separate versions. Timestamp-only, review bookkeeping, and bot-sync writes are ignored. A failed transaction rolls its snapshot back. Deleting a page retains its historical content; deleting the entire document removes its history. Media URLs are preserved, not copies of external files, so history cannot recover a file deleted at its source.

Validation:

- `npm run test -w server -- src/__tests__/lmsHistory.test.ts src/__tests__/knowledgePublishing.test.ts src/__tests__/knowledgeDocAccess.test.ts src/__tests__/squadhireTrainingSync.test.ts`
- Run `server/src/__tests__/lmsDocumentHistory.sql` with `psql -v ON_ERROR_STOP=1 -f ...` only in an empty disposable PostgreSQL database. It creates test roles/tables and uses separate transactions to model saves.
- Server build and admin/web TypeScript checks.
