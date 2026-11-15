# PostgreSQL and local identity trial

This replaces the **hosted Supabase dependency**, using vanilla PostgreSQL 17,
independent PostgREST, and a small local identity service. The existing
`supabase-js` client remains as a transport-compatible SDK; thousands of route
queries do not need to be rewritten at once. This is not the Supabase Docker
stack: it does not run GoTrue, Realtime, Storage, Vault, or Analytics. Files stay
in Cloudflare R2 and app live updates continue through Socket.IO.

## Isolation and current scope

- Compose project: `squadhub-local-data`, private **internal** Docker data network.
  Only the gateway also joins an entry bridge so Docker can publish its loopback
  port; the database and identity services remain internal-only.
- Gateway: **127.0.0.1:55400 only**. PostgreSQL and identity have no host ports.
- Independent volume, credentials, JWT signing secret, and R2 backup namespace.
- Limits: database 1 GB RAM / 0.75 CPU; identity 256 MB; REST 128 MB; gateway
  64 MB. Container logs rotate at 10 MB with three files each.
- The source production database, application env files, DNS, Caddy routing,
  migration ledger and production backup timers are not changed by setup.
- Existing imported password hashes and account UUIDs survive. Existing hosted
  access/refresh tokens do not: a future cutover requires users to log in again.
- Account creation is **administrator/invitation only**. Direct `/signup` is
  disabled, and SquadHub's public register endpoint checks a valid invitation
  before creating any login. Existing shared identities without a Hub profile
  may authenticate for sibling products but cannot log into SquadHub until
  provisioned there. No SMTP sender is required for this selected policy.
- CRM-style private invitation links expire after 24 hours and can be used once.
  They confirm the invited login and redirect with the session in the URL
  fragment, compatible with the existing CRM password-setup screen. Exact
  callback URLs must be listed in `LOCAL_AUTH_REDIRECT_URLS`; arbitrary redirects
  are rejected. `LOCAL_AUTH_PUBLIC_URL` points to SquadHub's
  `/auth/invite` route (trial default uses the loopback gateway). This route
  redeems the ticket internally and is excluded from access logs.
- The identity API implements the subset used by SquadHub: password sign-in,
  refresh, verification, logout, administrator account management and short-lived
  SSO handoffs. It is **not** a general GoTrue replacement. Sibling applications
  must be audited for OAuth, MFA, phone/OTP and other unimplemented endpoints.
  SMM's old signup screen receives a clear administrator/invitation-only error.

## Start an empty trial stack

From this directory on the VPS:

```sh
node generate-env.mjs
docker compose --env-file .env -f compose.yml config --quiet
docker compose --env-file .env -f compose.yml up -d --build
```

`generate-env.mjs` creates a mode-0600 ignored `.env` and refuses to overwrite
existing credentials. Never print `.env`, `.backup.env`, `.app-trial.env`, or
`docker compose config` without `--quiet`. API service-role keys are secrets.

An empty stack deliberately has no application profiles. Import the reviewed
snapshot before app testing. `bootstrap.sql` can be applied again after import;
it preserves existing tables, IDs, policies and data. It grants the local
identity role a policy on `auth.users` and a narrow private account-status
function, rather than granting it global RLS bypass or profile access.

## Offline migration rehearsal

Use an already verified Cloudflare R2 backup; do not export production again
just to rehearse. From the repository root on the backup VPS:

```sh
python3 tools/postgres/rehearse.py
```

This decrypts privately, creates a generated PostgreSQL container with **no
network**, restores the dump, and compares every non-Vault table's row count and
digest. It also checks all imported password hash formats. The only omitted
objects are Vault's unavailable extension and its **empty** table; nonempty
Vault fails closed. Source standard extensions, auth records, storage metadata,
SMM and migration history are retained. The disposable DB is always removed.

To retain a trial import:

```sh
python3 tools/postgres/rehearse.py --staging-container squadhub-local-data-db-1
```

The importer verifies Compose labels, absence of DB host ports and internal-only
networks. It creates a **new uniquely named database** and never overwrites an
existing one. The successful root-only report at
`/var/lib/squadhub-backup-hvcpoxgkdybyscaebtik/plain-postgres-rehearsal.json`
contains `staging_database`. Select that database as `LOCAL_POSTGRES_DB` in the
private `.env`, apply `bootstrap.sql` there as the local PostgreSQL administrator,
then recreate the trial services. No production app is connected automatically.
When reapplying SQL, pipe the **host** file into `docker exec -i ... psql` rather
than reading `/opt/squadhub/bootstrap.sql` inside an already running container:
replacing a single-file bind mount can leave it pointing at an older inode.

Historical dumps need a NOLOGIN `pgbouncer` compatibility role because their
inventory filter accidentally excluded it. Historical row digests used
`extra_float_digits=0`; future backups record that setting explicitly. Never
silence restore errors or skip non-Vault tables to force a passing report.

## Tests

```sh
# Local crypto tests; integration tests skip without an isolated test DB.
npm --prefix infrastructure/postgres/auth ci --ignore-scripts
npm --prefix infrastructure/postgres/auth test
python3 -m unittest discover -s tools/postgres -p 'test_*.py'
python3 -m unittest discover -s tools/backup -p 'test_*.py'
npx tsc --noEmit -p server/tsconfig.json
npx vitest run server/src/__tests__/authPerRequest.test.ts server/src/__tests__/localIdentity.test.ts
```

For real PostgreSQL identity tests, create `squadhub_identity_test` once in the
isolated stack, then run the test profile from this directory:

```sh
docker compose --env-file .env -f compose.yml exec -T db createdb -U postgres squadhub_identity_test
docker compose --env-file .env -f compose.yml run --build --rm identity-test
docker run --rm --network squadhub-local-data_data --memory 512m --cpus 0.5 \
  --env-file .env squadhub-local-data-identity-test node test/stack-smoke.mjs
```

The test suite refuses any database name other than `squadhub_identity_test`.
It covers SDK compatibility, RLS-enabled auth tables, inactive accounts,
refresh-token rotation, session revocation, password changes, SSO replay and
private-table privileges. `stack-smoke.mjs` uses the imported schema and removes
its synthetic account afterward. Set `TRIAL_APP_URL=http://app-trial:4000` to
also verify a separately isolated copy of the existing server API, including
password change followed by continued access and logout revocation.

The server opts into local identity with `IDENTITY_BACKEND=postgres`. Its
transport URL and key settings retain `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` names for compatibility. Default backend remains
`supabase`. In local mode, self-service password changes preserve the calling
session while revoking other sessions; administrative resets revoke all.

## Cloudflare backups for the local database

The local adapter reuses the existing encryption, checksum/decrypt verification,
30-day retention and isolated restore machinery. It creates a dedicated
read-only backup login and uses `backups/postgres/squadhub-local/` in R2, separate
from every hosted backup. Install/stage `tools/backup` alongside `tools/postgres`.

```sh
python3 tools/postgres/configure_backup.py --stack-dir infrastructure/postgres
python3 tools/postgres/backup_local.py backup --config infrastructure/postgres/.backup.env
python3 tools/postgres/backup_local.py restore-test --config infrastructure/postgres/.backup.env
```

This deliberately runs manually during trial. Existing production timers remain
in place. Local trial alerts are not connected to production. The local adapter
only accepts the isolated Docker network, fixed read-only role, new trial DB
name, tested image and separate state directory. Settings and login credentials
are included only inside the encrypted archive. Preserve the recovery key and
Cloudflare account access independently of the VPS.

## Before any production cutover

Building or running this trial is not a production migration. Required work:

1. Audit and test all consumers of the shared DB: SquadHub, both CRM deployments,
   Squad Bots, SMM, Squad Clips and any direct tools/mobile clients. Test their
   login, resets, permissions, signed SSO and required API/RPC behavior.
2. Finish representative browser and mobile workflows: chats, tasks, timers,
   check-ins, subscription cards, payments and integrations. The API smoke test
   is not equivalent to complete end-user acceptance or a security review.
3. Measure representative load including Docker builds and backups, monitor disk
   and memory, and configure external downtime / backup-freshness alerts.
4. Route all shared-DB writers together. Freeze writes, take a fresh final
   snapshot, import into a new target, verify counts/digests and test logins.
   Never cut over using the trial's older snapshot.
5. Update reviewed production-target/migration tooling for PostgreSQL, provision
   backup scheduling and test recovery, then release source via the repository's
   PR/merge/deploy workflow. No source pushes directly to main.
6. Agree on rollback before accepting writes. Routing back after writes begin
   requires reconciling new data; changing URLs alone is not a safe rollback.

No automatic production-cutover script is supplied. Trial credentials must not
be copied into frontend bundles or committed to Git.
