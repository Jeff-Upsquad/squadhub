# Squad Bot channels

Apply `supabase/migrations/20260928100000_squad_bot_channels.sql` before deploying
server, web and admin. It adopts existing private channels whose name matches
the bot slug and whose creator is an internal platform admin in that workspace.
It does not add users to existing channels. Each bot has at most one channel;
new bots and their private channels are created in one database transaction.

In Admin → Squad Bots → a bot → Bot channel, choose internal workspace users
as channel admins. Existing members can be promoted without duplicate entries.
Channel admins use **Invite teammates** in the channel to add other internal
workspace users, using the existing membership roles. Manager means channel
admin. Viewers can read questions; commenters, members and managers can respond.
The invitation API rejects non-internal, suspended, banned and non-workspace
users, including when called directly.

Question cards appear above team discussion, with context and an exact source
link. **Tell bot what to do** saves guidance and queues an action. **Take over**
records the handover before navigating to the source. A takeover can cancel
queued work, but cannot cancel an action a worker has already claimed. Failed
actions can also be taken over. Opening the source alone does not take over.
Ordinary channel messages remain team discussion; only an explicit question
response teaches the bot.

## Connected app contract

SquadHire/CRM workers are not in this repository. They must implement this
contract before bots can raise questions or execute the resulting instructions.
These endpoints use the existing per-bot Bearer API key. No client-side bot key
or arbitrary callback URL is needed. A key can reach only its own bot's data.

1. When uncertain, **stop work for that conversation/operation** and POST
   `/integrations/squad-bots/doubts`:

   ```json
   {
     "event_id": "candidate:123:message:456:needs-guidance",
     "question": "Can I confirm a remote first week?",
     "context": "The onboarding plan says the first week is in the office.",
     "source_url": "https://your-app.example/candidates/123/thread/456",
     "job_id": "<job UUID>",
     "target": { "audience": "candidates", "person_id": "123" }
   }
   ```

   Supply a stable `event_id` on retries. Repeated reports return the original
   question and never replace guidance. Supply `job_id` when the bot has jobs;
   it must belong to this bot. Derive the target from the application's own
   records. Use an exact HTTPS source link for another application. Relative
   paths resolve on SquadHub. The bot channel must already exist.
2. Poll `GET /integrations/squad-bots/doubts/:id`, or list questions using
   `GET /integrations/squad-bots/doubts?status=instructed&page=0` (100 per page,
   stable chronological order). `open` means wait. `taken_over` means stop and
   leave the conversation to the named `resolved_by` teammate. Continue checking
   the takeover state before any autonomous work on the affected conversation.
3. For `instructed`, POST `/integrations/squad-bots/doubts/:id/claim` immediately
   before action. Only one worker wins; others receive 409. The response contains
   the saved instruction and an `execution_token`. The server rechecks job scope,
   job enablement, bot status, and the emergency stop. Off and practice modes
   never authorize execution. An explicit human instruction permits an action
   in approval mode as well as live mode. A 423 leaves it queued.
4. Execute the instruction in the source app, including sending the requested
   message when applicable, while enforcing that app's own permissions. Persist
   the claim and use the doubt ID as the action's idempotency key in the source
   app. There is intentionally no expiring lease or automatic re-execution of
   uncertain sends: after a network failure, reconcile the existing operation
   before resuming. Do not send again just because an outcome report timed out.
5. POST `/integrations/squad-bots/doubts/:id/outcome` with
   `{ "execution_token": "<claim UUID>", "status": "completed", "note": "Reply sent in the candidate thread." }`.
   Use `failed` with an explanation if the action failed. Identical outcome
   retries succeed; conflicting outcomes or other tokens receive 409. Only
   report completed after the action succeeds. Reports can arrive after a pause
   so already-started work can finish reporting.

## Knowledge

Explicit guidance is stored in `squad_bot_learnings` in the same transaction as
its decision, attributed to the teammate and original question. Concurrent
instructions cannot teach two conflicting answers for one question. Taking over
alone does not invent knowledge or claim that an action completed.

SquadHub's AI gateway includes recent learned guidance in future bot replies
(including admin tests). Connected apps running their own AI must read
`GET /integrations/squad-bots/learnings?page=0` and include relevant guidance in
their knowledge retrieval. This endpoint returns 100 rows per page in stable
chronological order; keep fetching until a shorter page. These learnings are
separate from curated Resources documents returned by `/knowledge` and are not
automatically mirrored into SquadHire's existing Knowledge Center.

## Validation

Focused server tests cover access levels, internal membership, bot ownership,
unsafe source links, duplicate event handling, execution claims, scope checks,
emergency stop and outcome authorization. Migration testing on a temporary
PostgreSQL database checks channel adoption, atomic learning, competing replies,
takeover cancellation, cross-bot rejection and Data API grants. UI checks use
mock data to exercise replies, admin assignment and internal-only invitations.
