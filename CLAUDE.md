# Agent Instructions — Squad Hub SaaS

This is **Squad Hub SaaS** (app.squadhub.in): a Slack-style product for
SquadHire **businesses** and **talents**. It is a fork of the internal Squad Hub
app (`~/squadhub web`) with every internal-only module removed and a
multi-tenant model added. It is a SEPARATE product with its own Supabase project.

- Git remote **`hub`** points at the internal Squad Hub repo (`~/squadhub web`)
  so fixes can be cherry-picked (`git fetch hub && git cherry-pick <sha>`).
  Expect conflicts in anything touching workspaces, permissions or removed modules.
- **No GitHub repo, no deploy pipeline, no production environment yet.** Never
  push, deploy, create Supabase projects, or apply migrations to a remote
  database unless the user explicitly sets that up.
- Hub-owned data (client cards, job cards, assignments, partner payouts,
  payments, support tickets) is NOT stored here. It comes from the Hub over the
  server-to-server bridge: **[docs/bridge-contract.md](docs/bridge-contract.md)**.
  Screens that show it are shells marked `TODO(bridge)`; their server routes
  answer 501 until the bridge client lands. Signing helper:
  `server/src/utils/bridgeSign.ts` (must stay identical in both repos).

## WAT framework

Workflows (`workflows/`) → Agents (you) → Tools (`tools/`). Read the relevant
SOP, run tools in order, fix and document failures, keep SOPs current (ask before
creating/overwriting one unless told to). Secrets live in `.env` files only.

## Monorepo

npm workspaces: `shared/` (types), `server/` (Express + Socket.IO), `web/`
(Next.js). `admin/`, the desktop apps, partner portal, Squad Bots, Cashbook,
CRM/Leads/Sales, Candidates, LMS/Resources, SOP breaches, HR/timesheets and all
Hub admin routes were removed — don't reintroduce them.

## Tenancy (read before touching the server)

- A `workspaces` row **is the account**: `kind` = business | talent | shared |
  internal_staff, `status` = active | suspended, external ids
  (`hub_client_id`, `hub_partner_user_id`, `squadhire_business_id`,
  `squadhire_talent_id`), `host_workspace_id` for shared workspaces.
  Helpers: `server/src/utils/accounts.ts` (createAccount / ensureAccount / audit).
- `workspace_members.role` = owner | admin | member | guest (+ `is_upsquad_staff`).
  Shared workspaces also resolve for owners/admins of participant accounts
  linked through active `shared_workspace_links`.
- `requireAuth` resolves the active workspace from `X-Workspace-Id` (and any
  `workspace_id` query/body param — they must agree), verifies membership and
  binds it for the request (`req.workspaceId`, `currentWorkspaceId()`).
  `middleware/workspace.ts` is the single source of membership truth.
- `checkResourceAccess` resolves the resource's OWN workspace and refuses users
  who can't reach it — admin/role/permission lookups are per workspace.
- The server uses the service-role key: **RLS protects nothing. Every query on
  a tenant table must filter by `workspace_id` or carry a
  `// tenant-scope: <reason>` comment.** `npm run check:tenant-scope`
  enforces this with NO baseline — any unscoped chain fails CI. A
  `workspace_id` inside `.select(...)` does not count; resolve a resource's
  workspace with `workspaceIdOf()`. Patterns:
  - by-id lookups / hydration of ids from an authorised read:
    `.in('workspace_id', await reachableWorkspaceIds())` (memoised per request,
    fail-closed outside one);
  - work on a known resource: `.eq('workspace_id', <resource's workspace>)`;
  - workspace listings: the verified active workspace (`req.workspaceId`).
- Admin bypasses (locks, archived items, delete-anyone's) use the RESOURCE's
  workspace: `isAdminOfResource()` / `isWorkspaceAdmin(user, resourceWs)` —
  never the active workspace. `requirePermission` evaluates in the target
  container's workspace.
- My Tasks, Inbox/notifications, meetings and calendar/day-plan views aggregate
  across every workspace the user belongs to (`getUserWorkspaceIds` /
  `reachableWorkspaceIds`).
- Mini apps are per workspace (`workspace_mini_apps`); talent accounts start
  with `check-ins` + `partner-payments`. Cashbook is never offered.

## Database

- `supabase/migrations/0001_saas_baseline.sql` is a fresh consolidated baseline
  (NOT a replay of Hub migrations; those are archived in
  `supabase/migrations_hub_archive/` for reference only and are never applied).
- Collaboration tables carry `workspace_id NOT NULL`; child rows get it from
  their parent via `saas_fill_workspace_id()` triggers, which also REJECT a
  mismatching workspace (cross-tenant links can't be written).
- Validate locally without Docker:
  `PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres bash supabase/validate/validate_baseline.sh`
  (applies stubs + migrations to a throwaway DB and runs `tenancy_smoke.sql`).
- New migrations: `supabase/migrations/NNNN_name.sql`, grants for
  `service_role` only, RLS enabled, `workspace_id` on every tenant table.

## Checks before committing

```bash
npm run build -w shared
npx tsc --noEmit -p server/tsconfig.json
npm run check:tenant-scope
npm test -w server            # includes tenantIsolation.test.ts
npm run build -w web          # when web changed
```

## Keyword workflows

`CM` and `CU` exist (see `workflows/README.md`). `PD`/`CMPD` are not set up —
there is nothing to deploy to yet.

## Test handoff

After anything becomes testable (a localhost link today; a deploy later), give
a short plain-language summary: where to go, what changed for the user, how to
test it. If nothing user-facing changed, say so.
