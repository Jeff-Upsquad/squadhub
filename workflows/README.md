# Workflows

This directory contains Markdown SOPs (Standard Operating Procedures) that define how to accomplish objectives.

## Purpose

Workflows are the instruction layer of the WAT framework. Each workflow defines a clear objective, required inputs, which tools to use and in what sequence, and how to handle edge cases.

## Keyword workflows (mandatory)

When the user invokes `CM`, `PD`, `CMPD`, or `CU` (case-insensitive, with or without a leading slash or words like `run`), read `workflows/README.md` and the matching workflow file completely, then execute it. Do not ask what the keyword means.

| Keyword | File | Meaning |
|---|---|---|
| **CM** | [cm.md](cm.md) | Validate and commit on a feature branch. No push, PR, or deployment. |
| **PD** | [pd.md](pd.md) | Sync `main` after a merged PR; deploy only when the PR touched deployable code. |
| **CMPD** | [cmpd.md](cmpd.md) | Complete code pipeline: branch → PR → merge → PD. Never publishes a desktop release. |
| **CU** | [cu.md](cu.md) | Safely clean a merged worktree/branch and temporary files. |

The critical boundary is deliberate: `CM`, `PD`, and `CMPD` can move source code, but only a tagged `desktop-app-v*` push or manual dispatch of `desktop-app-release.yml` may publish a desktop release. `main` only moves via PR merges — direct commits/pushes to `main` are not allowed in this pipeline. (Automated Greptile review is paused as of 2026-09-23; see [cmpd.md](cmpd.md) for how to restore it.)

If a workflow exposes a recurring failure or a safer method, update its SOP. Never silently weaken its validation, branch-safety, or deployment checks.

## Other SOPs

| File | Purpose |
|---|---|
| [deploy.md](deploy.md) | VPS Docker deployment details (`tools/deploy.sh`) |
| [rollback.md](rollback.md) | Rolling back a bad deploy via timestamp tags |
| [test-handoff.md](test-handoff.md) | Post-deploy plain-language handoff to the user |
| [push.md](push.md) | Legacy direct-push SOP (retired — use CMPD) |

## Workflow Template

Each workflow should include:
- **Objective**: What this workflow accomplishes
- **Inputs**: What data or configuration is needed before starting
- **Tools Used**: Which scripts from `../tools/` are called
- **Estimated Time**: How long this typically takes
- **Steps**: Numbered, clear instructions for the agent
- **Outputs**: What gets produced and where
- **Edge Cases**: Troubleshooting and recovery
