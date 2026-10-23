# Workflows

Markdown SOPs (the instruction layer of the WAT framework) for **Squad Hub SaaS**.

## Keyword workflows

| Keyword | File | Meaning |
|---|---|---|
| **CM** | [cm.md](cm.md) | Validate and commit on a feature branch. No push, PR, or deployment. |
| **CU** | [cu.md](cu.md) | Safely clean a merged worktree/branch and temporary files. |

`PD` / `CMPD` are **not set up** in this repo yet: there is no GitHub repo, no
deploy pipeline and no production environment for app.squadhub.in. Do not push,
deploy, or run migrations against any remote database until the user sets those
up and writes the SOPs.

## Other SOPs

| File | Purpose |
|---|---|
| [test-handoff.md](test-handoff.md) | Plain-language handoff after something becomes testable (adapt URLs once app.squadhub.in exists) |
| [google-meet-setup.md](google-meet-setup.md) | Meeting-link provider setup (inherited from Squad Hub) |
| [huddles-setup.md](huddles-setup.md) | LiveKit huddles setup (inherited from Squad Hub) |
| [migrate_from_hub.md](migrate_from_hub.md) | Move existing Hub businesses/talents into SaaS accounts (plan → copy → freeze tooling in `tools/migrate_from_hub/`) |
