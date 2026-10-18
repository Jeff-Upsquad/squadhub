# Remaining squads

Implemented on 18 October 2026 in coordinated feature worktrees for Profiles, SquadHub Web, SquadCRM and SquadHire CRM. The source catalog is `upsquad website/upsquad/client/src/data/squads.js`. This extends the existing Content Squad architecture with 20 additional specialist categories; Ads Specialist and Accountant retain their existing profiles and catalogs.

## Coverage

| Squad | New specialist categories |
| --- | --- |
| Marketing | SEO Specialist, Digital Marketing Team, Influencer Marketing Expert, Offline Marketing Specialist |
| Tech | Web Developer, App Developer, Automation Specialist, Software Developer |
| Accounts & Finance | CFO / Chartered Accountant, GST Expert, TDS Expert, Labour Law Expert, Incorporation & Licensing Specialist |
| Legal | Contract Drafting Specialist, IP Protection Specialist, Compliance Specialist, Business Formation Specialist |
| Hiring & HR | Recruitment Specialist, Team Building Specialist, HR Process Specialist |

Each category has a stable cross-project ID, an independent application route, three screening questions, professional title/summary and specialist context, editable specializations/skills/tools/AI tools, signup attribution, directory filters, reception routing, and both Jobs and Partner Program tracks. Finance and legal profiles also require qualifications and supported jurisdictions. Tech and marketing profiles require three work samples; finance, legal and HR do not require a portfolio. The native editor reads these rules from the category API.

Business users can submit subscriptions and assignments for every category. Briefs collect role-specific scope, outcomes, budget/currency and talent levels, schedule, language/location preferences, optional skills/tools and voice notes. SquadHub catalogs include 20 subscriptions, 300 plan/level combinations and 20 assignment services, with stable talent-category links. Initial catalog pricing/margins follow the existing Designer baseline, matching the Content Squad provisioning pattern; administrators can edit these values.

## CRM configuration

SquadHire CRM provisions five boards per new role (100 total): Partner Program candidates, Jobs candidates, talent onboarding for each track, and Partners. Candidate Live hands off to the corresponding talent board. Completing Partner Program onboarding opens an Active Partner card idempotently; Jobs remains independent. Roles without portfolios omit Portfolio Updation.

SquadCRM provisions 20 lead/deal pairs plus Clients and Onboarding boards for each squad (50 total). Qualified leads connect to their own deal board; won deals connect to their squad's delivery destinations. New CRM taxonomy categories let incoming briefs retain their specialist category. Shared words in names cannot route a specialist brief to another role.

Provisioning copies the existing Content Squad's stages, substages, reasons, automation rules, operator grants and template/quick-message availability. IDs inside configuration are remapped. Shared automation scopes are restricted to the new role. Existing boards and cards are preserved, and provisioning does not execute automations or send messages. Complete existing board sets are skipped on reruns; partial sets raise an error for review.

The existing atomic outbox and private receipt RPC cover all roles. Retry delivery reuses the same lead, and edits preserve operator stages. The outbox trigger retains SECURITY DEFINER and restricted function privileges.

## Release status and order

Apply these migrations in dependency order as part of the coordinated release through each repository's CMPD workflow:

1. Profiles `20261018180000_remaining_squad_form_types.sql`; commit these enum additions before dependent inserts.
2. Profiles `20261018180100_remaining_squad_categories.sql`.
3. SquadHire CRM `20261018180300_remaining_squad_pipelines.sql`.
4. Profiles `20261018180500_remaining_squad_crm_mapping.sql` after the candidate/talent boards exist.
5. SquadCRM `20261018180300_remaining_squad_pipelines.sql`, then `20261018180400_remaining_squad_brief_receipts.sql`.
6. SquadHub Web `20261018180200_remaining_squad_services.sql`, then `20261018180600_remaining_squad_brief_delivery.sql`.
7. Deploy the matching Profiles backend/frontend/admin/staff, SquadHub server/admin, and both CRM server/web changes. Release the updated native talent app separately.

Profiles/SquadHire CRM and SquadHub/SquadCRM use separate Supabase projects. Never apply these migrations to the wrong project. Pipeline migrations require the existing Content Squad template boards; category provisioning rejects conflicting stable IDs instead of silently breaking catalog links. After deployment, verify a fresh application and complete onboarding on both tracks plus a real business brief for each squad.

## Verification

- Profiles and both CRM servers and the SquadHub server build; web/admin TypeScript checks pass.
- Regression coverage checks all 20 signups, both work tracks, portfolio rules, subscriptions/assignments and required specialist fields.
- Commercial routing checks every specialist against every other specialist; registry checksums match across all four products.
- CRM handoff/graduation and squad navigation tests pass.
- Local PostgreSQL fixtures execute profile, catalog, board, receipt and outbox migrations. They verify repeated provisioning, 100 hiring boards, 50 business boards, stable category links, remapped configuration, retry idempotence and stage preservation on edits. Both board-provisioning migrations and the commercial catalog have also been rehearsed against the live schemas inside rollback transactions.
- Mobile browser checks render all 20 application pages and all 20 business briefs, verify specialist fields and optional work-sample labels, and report no runtime errors or horizontal overflow.
- Flutter analysis of the changed native editor passes. Frontend lint has no errors and retains existing warnings.

The reproducible isolated database check is `scripts/remaining-squads/verify-migrations.py` in Profiles. It requires a disposable local PostgreSQL server on port 55438 and explicit `--profiles`, `--hub`, `--crm`, and `--hire` checkout paths; it creates/replaces only its `remaining_*` fixture databases.
