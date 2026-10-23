# Squad Hub ⇄ Squad Hub SaaS — Bridge API contract (v1)

Plan: https://claude.ai/artifact/UJsWDEWWmuzEg98tRMfota

Two systems, each owns its data, nothing stored twice:
- **Hub** = internal Squad Hub (`squadhub web` repo, api.squadhub.in, existing Supabase `kfxdbhwxzvptzzcuzlal`). Owns: clients, subscription_cards, job cards, assignments/terms, payments/billing, partner payouts (partner_payment_statuses), support tickets.
- **SaaS** = app.squadhub.in (`~/squadhub-saas` repo, NEW Supabase project). Owns: accounts (workspaces), members, shared workspaces, spaces/tasks/chat/huddles, time entries, check-ins, plans, seat limits, mini-app entitlements, platform audit log.

Server-to-server only. Browsers and phones never call the other system.

## Auth (both directions)

Env on both: `SAAS_BRIDGE_SECRET` (same value). Hub also: `SAAS_API_URL`. SaaS also: `HUB_API_URL`.
Bridge disabled (routes 503, outbound calls no-op + log) when the secret is unset.

Headers on every request:
- `X-Bridge-Timestamp`: unix seconds
- `X-Bridge-Signature`: hex HMAC-SHA256(secret, `${timestamp}.${METHOD}.${pathWithQuery}.${sha256hex(rawBody || "")}`)
- `X-Bridge-Actor` (optional): JSON `{"hub_user_id": "...", "email": "..."}` for super-admin actions (audit)

Receiver rejects |now − timestamp| > 300s, and compares with `crypto.timingSafeEqual`. Body is JSON. Responses: `{ success: true, data }` / `{ success: false, error }` (same shape as the existing APIs).

Shared helper (copy into both repos, identical): `server/src/utils/bridgeSign.ts` exporting `signBridgeRequest(method, pathWithQuery, rawBody, secret, now?)` and `verifyBridgeRequest(req, secret)`, plus Express middleware `requireBridge`.

## Identity mapping

Every SaaS account (workspace) row stores:
`hub_client_id` (business) | `hub_partner_user_id` (talent), `squadhire_business_id` | `squadhire_talent_id`.
Every SaaS user row stores `hub_user_id` when it maps to a Hub user (migrated users, Upsquad staff).
Bridge calls identify accounts by `saas_account_id` plus the Hub-side id.

## Hub serves (mounted at `/bridge/v1` on Hub, called by SaaS)

| Method | Path | Purpose |
|---|---|---|
| GET | `/bridge/v1/business/:hubClientId/cards` | business's subscription + job cards, status, assignee summary |
| GET | `/bridge/v1/business/:hubClientId/payments` | payment history + invoices |
| GET | `/bridge/v1/talent/:hubPartnerUserId/assignments` | talent's assigned cards |
| GET | `/bridge/v1/talent/:hubPartnerUserId/opportunities` | open opportunities for the talent |
| GET | `/bridge/v1/talent/:hubPartnerUserId/payouts?month=YYYY-MM` | payout summary (same calculator as partner-payments mini app) |
| GET | `/bridge/v1/talent/:hubPartnerUserId/payouts/history` | payout history |
| POST | `/bridge/v1/support/tickets` | create ticket `{saas_account_id, saas_user:{id,email,name}, hub_user_id?, category, subject, body, attachments?}` → `{ticket_id, ticket_number}` |
| GET | `/bridge/v1/support/tickets?saas_user_id=` | list a user's tickets |
| GET | `/bridge/v1/support/tickets/:id/messages` | ticket thread |
| POST | `/bridge/v1/support/tickets/:id/messages` | reply from the SaaS user |
| POST | `/bridge/v1/support/tickets/:id/close` / `/reopen` | |
| POST | `/bridge/v1/time-totals` | `{date, entries:[{hub_card_id, hub_partner_user_id, minutes}]}` idempotent upsert per (date, card, partner) |
| GET | `/bridge/v1/staff/:hubUserId` | verify an internal staff member is active (for "Sign in with Squad Hub") |

Support tickets created over the bridge land in the existing support desk (support channel threads); the SaaS user is represented on Hub by a lightweight external-requester record, NOT a full Hub user account.

## SaaS serves (mounted at `/bridge/v1` on SaaS, called by Hub)

| Method | Path | Purpose |
|---|---|---|
| POST | `/bridge/v1/accounts` | create/ensure account `{kind:'business'|'talent', owner:{email,name,phone?}, hub_client_id?, hub_partner_user_id?, squadhire_business_id?, squadhire_talent_id?, role_slug?}` → `{saas_account_id, owner_user_id, created}` (idempotent on hub id) |
| POST | `/bridge/v1/shared-workspaces/ensure` | `{business_saas_account_id | hub_client_id, hub_card_id, card_category, talent hub_partner_user_id, account_manager_hub_user_ids[]}` → creates shared workspace if missing, adds talent to the category's space, adds staff |
| POST | `/bridge/v1/shared-workspaces/:id/members/remove` | `{hub_partner_user_id | hub_user_id}` (swap/cancel) |
| POST | `/bridge/v1/shared-workspaces/:id/pause` / `/resume` / `/close` | card lifecycle |
| POST | `/bridge/v1/support/notify` | `{ticket_id, saas_user_id, preview}` agent replied → in-app notification |
| GET | `/bridge/v1/admin/accounts?q=&kind=&status=&page=` | super admin list |
| GET | `/bridge/v1/admin/accounts/:id` | detail: owner, members, shared workspaces, seats used/limit, plan, mini apps |
| POST | `/bridge/v1/admin/accounts/:id/suspend` / `/reactivate` | |
| POST | `/bridge/v1/admin/accounts/:id/owner` | `{user_id}` |
| POST | `/bridge/v1/admin/accounts/:id/members/:userId/remove` | |
| GET/POST/PUT | `/bridge/v1/admin/plans` | plans `{id,name,price_inr,free_staff_seats,is_default}` |
| POST | `/bridge/v1/admin/accounts/:id/plan` | `{plan_id}` |
| GET | `/bridge/v1/admin/mini-apps` | catalog |
| POST | `/bridge/v1/admin/accounts/:id/mini-apps` | `{slug, enabled}` |
| POST | `/bridge/v1/admin/impersonate` | `{user_id, reason}` → one-time login URL (10 min); audited |
| GET | `/bridge/v1/admin/audit?account_id=` | audit log |
| GET | `/bridge/v1/checkins?from=&to=&hub_partner_user_id=` | talent check-ins for Hub admin |
| POST | `/bridge/v1/staff/link` | `{hub_user_id, email, name}` → ensure SaaS staff user |
| GET | `/bridge/v1/staff/:hubUserId/workspaces` | shared workspaces + unread counts for "Client workspaces" in Hub |
| POST | `/bridge/v1/staff/sso` | `{hub_user_id}` → one-time login URL for "Sign in with Squad Hub" |

## Amendments (v1.1, from the Hub-side build)
- Sign the path starting at `/bridge/` (strip any proxy prefix such as `/api`) plus query string.
- `shared-workspaces/ensure` may carry `supersedes_hub_card_id` (upgrade/downgrade: move the link to the new card instead of closing). Reply with `shared_workspace_id`.
- Plans update: `PUT /bridge/v1/admin/plans` with `id` in the body.
- `admin/accounts/:id/suspend` may carry `{reason}`.
- `staff/sso` accepts optional `{workspace_id}` to land the staff member on that workspace; it must call link-or-create for the staff user if missing.
- List endpoints return `{ items, total, page, page_size }`.
- Business "first payment" = client activation on the Hub (invoices live in SquadBooks; `payments` returns `invoices: null`).

Default mini apps for talent accounts: `check-ins`, `partner-payments`. Cashbook never offered.
