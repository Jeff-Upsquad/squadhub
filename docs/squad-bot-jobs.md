# Squad Bot jobs

The Squad Bots detail page now manages jobs and displays activity summaries.
Apply `supabase/migrations/20260927160000_squad_bot_jobs.sql` before deploying
these server/admin changes. These tables are server-only.

SquadHub stores instructions and scope; connected applications execute jobs.
This repository does not contain the SquadHire or Squad CRM job workers.
Creating a job does not create a scheduler or implement arbitrary actions.
Pipeline, stage, and person IDs refer to the connected application's records.
All supplied constraints must match. No IDs means no restriction of that type.

## Connected application contract

Use the bot's existing server-side API key as a Bearer token.

1. Read `GET /integrations/squad-bots/config`. `jobs` includes each job's ID,
   instructions, kind, audience, people IDs, pipeline/stage IDs, enabled flag,
   and effective status. Global/bot off overrides enabled jobs.
2. Before each operation, call `POST /integrations/squad-bots/jobs/:jobId/check`
   with `{ audience, person_id, pipeline_id, stage_id }` for the actual target.
   Derive these values from your own database, not a candidate's message.
   `allowed` permits preparation; `can_execute` is true only for a matching live
   job. Practice means log/draft only; approval means hold for human approval.
   Recheck immediately before sending or changing records. Fail closed if the
   check cannot be completed. The application remains responsible for honoring
   the check and its own permissions, and for supporting each requested action.
3. For replies through SquadHub, include `job_id` and `target` alongside the
   existing `messages` and optional `context` at `POST /integrations/squad-bots/reply`.
   Scope and enabled state are checked and job instructions are included.
   Once a bot has any jobs, unscoped reply requests are rejected. Deploy the
   client change before assigning the first job to an existing bot.
4. After each action, call `POST /integrations/squad-bots/activity`:

   ```json
   {
     "job_id": "<job UUID>",
     "event_id": "candidate-reply:<message ID>",
     "outcome": "completed",
     "note": "Answered the candidate's onboarding question.",
     "target_url": "https://your-app.example/candidates/123/conversation"
   }
   ```

   Outcomes: `completed`, `failed`, `skipped`, `drafted`. Report completed only
   after the action actually succeeds. Use a stable event ID, unique per bot,
   on retries; duplicate reports do not increment counts. Use distinct IDs for
   a draft and its eventual sent message. Notes contain up to 4,000 characters.
   Link to the exact conversation, record, or pipeline stage. Only HTTPS URLs
   and site-relative paths are accepted. Relative paths resolve on the admin
   site, so use absolute HTTPS links for other apps. Reports may arrive after a
   job is paused; this preserves in-flight outcomes. Reports are timestamped on
   receipt by SquadHub. Existing `/usage` reports remain AI-call telemetry and
   do not count as completed jobs.

## Reports

Daily, Monday–Sunday weekly, monthly, calendar quarterly, and yearly reports
use UTC boundaries. The date picker can select any earlier period. The UI
labels this timezone and displays individual activity times in browser-local
time. Totals aggregate in SQL across all rows, independent of pagination;
activity notes are paginated 25 at a time. Summaries distinguish completed,
failed, skipped, and drafted work, with per-job breakdowns and a job filter.
Jobs can be edited or switched off; activity retains the job name at reporting
time. Jobs cannot currently be deleted, preserving their history.
