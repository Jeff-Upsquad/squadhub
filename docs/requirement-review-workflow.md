# Requirement delivery and review

Business requirements submitted through the shared/public brief form or a completed client share link are queued for automatic publication and broadcast after their targeting details are saved. Subscriptions, assignments and per-item business-service requests use the same publisher across every service category and squad. Existing pricing, tier expansion and audience matching still apply. A business hiring card becomes eligible when its job profile is attached; the existing job and business profile completeness checks still apply.

The former New Deals and Published queues appear together as **New for Review**. Drafts, recalled requirements, and live requirements without a requirement review appear here. Delivery does not mark a card reviewed. Reviewed live cards move to the existing Broadcasted, Selected or Assigned bucket according to their state. Cancelled, paused and archived cards retain their lifecycle buckets.

**Mark as Reviewed** records the authenticated reviewer ID, a display-name snapshot, and a database timestamp. Repeated clicks preserve the first review. Each tier has its own audit record; the grouped review button reviews all unreviewed tiers. Recall clears the current requirement review while preserving its activity event, so corrections need a new review. These fields are separate from the existing selection/assignment review and do not promote a lead into Clients.

**Broadcast to all** is enabled for internally created cards (`internal_brief`, `custom`, `request`, or sales `submission`). Cards submitted directly by a business (`shared_form`, `landing_page_form`) show an inactive action. The API enforces the same origin rule. If a business completes an internally created card through a share link, it automatically delivers while retaining its internal creator origin. Internal drafts can publish and broadcast in one action. A recalled business requirement automatically delivers again when its corrections are published.

The database queue survives restarts, leases work across server processes, and retries failures with backoff. Tier publication and copying of location targeting are transactional, so failed or concurrent publication cannot leave partial/duplicate siblings. Administrators can see pending automatic delivery or its latest retry error in the card review bar. Recall, cancellation, archival and deletion stop queued delivery. A signed `notify_talents` webhook flag requests talent notifications for broadcasts while ordinary content sync remains silent.

## Release

Deploy the Profiles backend that accepts `notify_talents`, then apply Hub migration `20261027140000_requirement_review_workflow.sql` before deploying the Hub shared package, server, admin and web app. The migration does not automatically send existing backlog cards.

## Verification

Hub targeted tests:

```sh
npm test --workspace=@squadhub/server -- --run src/__tests__/requirementWorkflow.test.ts src/__tests__/publishRequirementCard.test.ts src/__tests__/perUnitPricing.test.ts src/__tests__/squadhireCardPricing.test.ts src/__tests__/contentBriefCrmOutbox.test.ts
```

PostgreSQL transaction, review history, leasing, privilege and hiring-readiness tests use an empty disposable database:

```sh
psql "$REQUIREMENT_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f server/src/__tests__/requirementWorkflow.fixture.sql
```

The fixture creates minimal tables; use a dedicated empty database. Profiles regression tests include `subscription-broadcast-contract.test.ts`, `content-squad.test.ts` and `remaining-squads.test.ts`. Browser verification uses mocked API data and does not publish cards or send real notifications.
