# Migrate existing businesses and talents from Squad Hub → Squad Hub SaaS

Plan: https://claude.ai/artifact/UJsWDEWWmuzEg98tRMfota ("Moving existing users":
dry run → copy → link → switch → freeze). Tools: `tools/migrate_from_hub/`.

Run every step **as a module from the repo root** (`python3 -m tools.migrate_from_hub.<step>`),
never as `python3 tools/migrate_from_hub/copy.py` — a file named `copy.py` first on
`sys.path` would shadow Python's own `copy` module (the scripts refuse to run that way).
Python 3.9 stdlib only; `psql` (Postgres 16 client) for writes. No pip/npm installs.

## Objective

Every active business (Hub client with client users or a live engagement) and every
talent (Hub `partner` / `partner_employee`) gets its own SaaS account; every business
with a live engagement gets one **shared workspace** (host = the business) holding
the client's Hub work; talents and Upsquad account managers are linked into it.

## Inputs

| Input | Where |
|---|---|
| Hub credentials (read-only use) | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `~/squadhub web/server/.env`, read at runtime, never printed (override path with `HUB_ENV_FILE`) |
| SaaS DB URL (copy only) | `--target postgresql://…` or `SAAS_DB_URL` |
| SaaS auth admin (copy, real target) | `SAAS_SUPABASE_URL` + `SAAS_SUPABASE_SERVICE_ROLE_KEY` env |

## Steps

### 1. Dry run — `plan.py` (read-only)
```bash
python3 -m tools.migrate_from_hub.plan            # live Hub, GET-only
```
Writes `.tmp/migration_plan.json` (input to steps 2 and 5) and `.tmp/migration_plan.md`
(review). Both contain names/emails → stay in gitignored `.tmp/`, never commit or paste.
The Hub reader can only send HTTP GET to PostgREST `/rest/v1/<allow-listed table>` —
there is no write path. Review every **blocker** and **warn** with the user before step 2.

How the plan maps the Hub:
- **Business account** = Hub `clients` row with ≥1 active non-internal `client_user_access`
  user or a live engagement. Owner = the client user whose email equals `clients.email`,
  else the first `client` user, else the first user; if none, a new user from the client's
  contact email (warn) or the account is skipped (blocker). Other client users: `admin`
  (`client`) / `member` (`client_staff`).
- **Talent account** = every active `partner`/`partner_employee` (suspended ones only when on
  a live card, or with `--include-suspended`). `squadhire_talent_id` comes from
  `subscription_card_external_recipients.external_user_id` matched by email.
  Mini apps `check-ins` + `partner-payments` switched on.
- **Live engagement** = `subscription_cards` not deleted/cancelled and `state='assigned'`, or
  with an `active` `subscription_assignment_terms` row. Talent = term `recipient_id`
  (SquadHire id) → recipient email → Hub user. Client = `card.client_id` → linked folder's
  `client_id` → submission → email → company (same order as `activatedClientSpaces.ts`).
  Category from `service_type` (Designers→designer, Editors→video-editor, …).
- **Shared workspace** = one per business with live engagements. Links: `host` (business
  account) + one `talent` link per talent (`hub_card_id` = latest card, `card_category`,
  `paused` if the card is paused). Account managers = `card.assignee_id` + `collaborator_ids`
  (active internal users) → members with `is_upsquad_staff`.
- **Content** (client folder tree under "Client Spaces"): each client-space template child
  folder (Design Space, Video Editing Space…) → its own SaaS space tagged with its
  category; the client root folder's remaining lists/sub-folders → a space named after the
  brand; legacy `spaces.client_id` spaces → spaces. Channels linked to any copied
  folder/list/space come along with messages, threads and reactions. Clients without a live
  engagement keep this content in their business workspace. Each owner's Hub personal
  space goes to their own account. CRM/support/internal channels never move.

### 2. Copy — `copy.py` (default dry run)
```bash
python3 -m tools.migrate_from_hub.copy --plan .tmp/migration_plan.json          # SQL into .tmp/copy_dry_run/
python3 -m tools.migrate_from_hub.copy --plan .tmp/migration_plan.json --execute \
    --target "$SAAS_DB_URL" --auth-mode supabase-admin [--only shared:<client_id>]
```
- Real writes need `--execute` **and** `--target`, plus `--auth-mode`. A target whose URL
  contains the Hub project ref or the Hub's host is refused. `local-stub` auth mode (writes
  `auth.users` directly) is refused unless the target is localhost.
- Refuses when the plan has blockers unless `--allow-blockers` (blocked items are already
  left out of the plan; the flag just acknowledges them).
- Idempotent: SaaS ids are `uuid5(namespace, hub table + id)`, inserts are
  `ON CONFLICT DO NOTHING`, rows are recorded in `hub_migration.id_map`, finished targets in
  `hub_migration.targets` (skipped on re-run). `--resync` re-runs finished targets to top up
  Hub rows added since (existing rows are never overwritten).
- Users: an existing SaaS user with the same `hub_user_id` or email is adopted (its
  `hub_user_id` back-filled); a different `hub_user_id` on that email stops the run.
  Users only referenced as authors get a SaaS user too (internal → active, others →
  `suspended`) so authorship survives; rows by users deleted from the Hub are skipped.
- Each target is one transaction. Notification and auto-row triggers
  (`trg_notify_*`, `trg_*_auto_member`, `trg_space_statuses`) are disabled inside that
  transaction and re-enabled before COMMIT — this takes ACCESS EXCLUSIVE locks, so run the
  real copy in a maintenance window. Tenancy fill/guard triggers stay ON (they verify every
  child row's workspace).
- Files are NOT copied: `file_url` / `object_key` keep pointing at R2.
- Access: business owner/admins = manager on everything, business members = member,
  Upsquad staff = member on everything, talents = member only on spaces of their card's
  category (or their card's linked folder) and those spaces' channels; plus every Hub
  membership that maps.
- Not copied: DMs (counted in the plan), status groups/stages (tasks keep their status text;
  Hub space status catalog is copied per space), checklists, time entries, task activity,
  whiteboards/list views, meetings/huddles, labels.

### 3. Link
Done by step 2 (external ids on accounts, `users.hub_user_id`, staff members, links). Verify
in the SaaS super-admin list before the switch.

### 4. Switch
Point SquadHire "Open Squad Hub", mobile app server URL and email links at
app.squadhub.in (separate work; see the plan's Mobile section).

### 5. Freeze — `freeze.py` (generates SQL, never applies)
```bash
python3 -m tools.migrate_from_hub.freeze --plan .tmp/migration_plan.json [--block-login]
```
Writes `.tmp/hub_freeze.sql` + `.tmp/hub_freeze_rollback.sql`. The SQL adds
`users.moved_to_saas_at` / `saas_redirect_url`, snapshots then sets moved users'
`resource_memberships` to `viewer` and locks (`is_locked`) every copied space/folder/list,
optionally `status='suspended'` (blocks login with today's code). It **ends with ROLLBACK**:
review, change to COMMIT, apply on the Hub only with the user's go-ahead. The rollback file
only works after a committed freeze (it reads `saas_freeze_snapshot`). A Hub login-guard
change that reads `moved_to_saas_at` and shows the redirect message is still to be built.

## Testing (synthetic data only)
```bash
bash tools/migrate_from_hub/tests/run_local_copy_test.sh [WORKDIR]
```
Creates a throwaway Postgres 16 cluster (no Docker; `LC_ALL=C initdb --no-locale`), loads
the SaaS baseline via `supabase/validate/validate_baseline.sh`, runs plan → copy (safety
refusals, dry run, execute, re-run, resync) → freeze on the fixture from
`tests/make_fixture.py`, and checks `tests/assertions.sql`.

## Edge cases / lessons
- `initdb` fails with "invalid locale settings" on this Mac unless run with `LC_ALL=C --no-locale`.
- SaaS `tasks.created_via` has a CHECK list — keep the Hub value (the copy marks migrated
  tasks with `metadata.hub_task_id` instead).
- `platform_audit_log.id` is an identity column; the audit row is guarded with NOT EXISTS.
- Hub `subscription_cards.client_id` is often NULL; the linked folder's `client_id` resolves it.
- Hub `subscription_assignment_terms.recipient_id` is the SquadHire talent id, not a Hub user id.
- A talent can have only one link per shared workspace (UNIQUE); several cards with one
  business → latest card on the link, all categories granted (plan shows an info item).
