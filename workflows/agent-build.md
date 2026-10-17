# Agent Build Pipeline

## Objective

Turn a SquadHub task moved to **READY TO CODE** into shipped code — implemented,
delivered through the repo's normal SOP (CMPD + CU; mobile go-live when the
task says so), and reported back on the task — without a human in the loop
between "status change" and "PR merged + deployed".

This SOP is executor-agnostic: the same procedure runs as a ZCode automation on
the dev Mac (today) or a headless runner on the VPS (later). Only
`tools/agent/runtime.json` and the repo `path` values in
`tools/agent/repo-map.json` differ per machine.

## Inputs

| Input | Source |
|---|---|
| Server base URL + agent token | `tools/agent/runtime.json` (gitignored; per machine) |
| List/folder → repo mapping | `tools/agent/repo-map.json` (committed) |
| Task queue | `GET /agent/ready-tasks` on the SquadHub server |
| Task content | title + description of the claimed task |

## Task description convention

The task description is the brief. For mobile repos it must include a line:

```
release: ota | apk | apk-force | skip
```

- `ota` → JS-only, silent update (`eas update`)
- `apk` → new APK, no force-update
- `apk-force` → new APK + force update
- `skip` → code only, no release this run

If the line is missing on a mobile task, do the code work, **skip the release**,
and flag "release line missing — not released" in the completion comment.

## Status lifecycle

```
ready_to_code ──claim──▶ in_progress ──success──▶ closed
                            │
                            └──failure──▶ blocked   (comment explains why)
```

Tasks enter `ready_to_code` two ways: a human sets the status, or the task
panel's **Build now** button (`POST /pm/tasks/:id/build-dispatch`) sets it and
stamps `metadata.build_requested_at`. Dispatched tasks are served FIRST by
`/agent/ready-tasks` (newest dispatch first) — a button click jumps the queue.
After the claim, both are identical.

`in_code_review` / `ready_for_deploy` may be used as intermediate beats on long
runs; they are optional. A human un-blocks by setting the task back to
`ready_to_code` — the next run re-claims it.

## Steps

1. **Load runtime config.** Read `tools/agent/runtime.json` (relative to this
   repo). Missing file or missing `base_url`/`agent_api_token` → log why and
   stop silently (do not create tasks, do not retry).
2. **Poll the queue.** `GET {base_url}/agent/ready-tasks` with
   `Authorization: Bearer {token}`. Unreachable server or 5xx → stop silently
   (the dev server may just be down). Empty list → done, nothing to do.
3. **Claim ONE task** — the oldest (first in the list).
   `POST {base_url}/agent/tasks/{id}/claim`. A 409 means another executor won
   the race → stop. **Never process more than one task per run.**
4. **Resolve the repo.** Match the task's list/folder against
   `repo-map.json`: `list_id` first, then `list_name`, then `folder_name`,
   else `defaults.repo`. Note an unmapped-list fallback in the final comment.
   If the mapped `path` doesn't exist locally → set status `blocked`, comment
   "repo path missing on this executor: {path}", stop.
5. **Read the brief.** Re-read the task title + description in full. If the
   description is too vague to determine done (no repro for a bug, no scope
   for a feature) → status `blocked`, comment what's missing, stop. Do not
   guess-build.
6. **Implement** in the mapped repo, following that repo's own conventions
   (AGENTS.md / CLAUDE.md, existing patterns). Run its local validation
   (typecheck / lint / build / tests) exactly as CMPD requires.
7. **Deliver per the repo's `delivery` field:**
   - `cmpd` → execute `workflows/cmpd.md` in full (branch → PR → merge → PD
     deploy). CI is paused — local validation stands in, merge without
     waiting for GitHub checks.
   - `cmpd+cashbook-release` → CMPD first, then `workflows/cashbook-app-release.md`
     using the `release:` line from the task description as the pre-answered
     release decision. Missing line → skip release, flag it.
   - `none` → commit on a branch only; leave the PR decision to a human.
8. **Clean up (CU).** Run `workflows/cu.md` but STOP at every step that SOP
   marks as requiring confirmation. Instead of deleting worktrees/branches,
   list them in the completion comment for one-click cleanup.
9. **Report.** Set final status and post a completion comment:
   - Success → status `closed`, comment: PR link, what changed, deploy result,
     release channel used (or why skipped), any deferred CU cleanup.
   - Partial (code merged but deploy/release failed) → status `blocked`,
     comment the exact failure and what already succeeded.
   - Comment endpoint: `POST {base_url}/agent/tasks/{id}/comment`
     `{ "content": "..." }`. If comments are rejected (AGENT_USER_ID unset on
     the server), still set the status and log the report locally.
10. **Never carry state between runs.** Each run re-reads everything.

## Hard rules

- **One task per run.** No batching, no parallel claims.
- **main moves only via PR merge** (CMPD) — same as human runs.
- **Never publish desktop app releases** (`desktop-app-v*` tags /
  `desktop-app-release.yml` are human-only), regardless of task wording.
- **Never delete worktrees/branches without the CU confirmation** — defer to
  the comment.
- **Secrets stay in env/.env** — never echo tokens into comments or logs.
- If the claimed task turns out to need SquadHub *server code changes* to
  proceed (e.g. the API is missing something), finish what's possible, set
  `blocked`, and explain — don't hot-patch the contract mid-run.

## Edge cases

| Situation | Handling |
|---|---|
| Server unreachable | Stop silently; next run retries. |
| Claim 409 | Another executor is building it; stop. |
| Repo path missing | `blocked` + comment naming the path. |
| Merge conflict on `main` | Attempt one clean rebase; if still conflicting → `blocked` with details. |
| Task is a duplicate of an open PR | `blocked` + comment linking the PR; human decides. |
| Validation fails after honest attempts | `blocked` + failing check output in comment. |
| Description asks for something unsafe (force push, secret commits, release without `release:` line) | Refuse that step, do the rest, flag in comment. |

## VPS provisioning (when the Mac executor retires)

1. Clone the repos on the VPS; update `path` values in `repo-map.json`
   (commit them if the VPS is the only executor, or keep a local override).
2. Set `AGENT_API_TOKEN` + `AGENT_USER_ID` in the VPS server deployment env.
3. Create `tools/agent/runtime.json` on the VPS pointing at the production
   server URL.
4. Schedule this SOP headless (cron/systemd timer) — the contract is
   unchanged, so nothing else moves.

## Outputs

- Merged PR (+ deploy / release when applicable) in the mapped repo.
- SquadHub task: final status (`closed`/`blocked`) + a completion comment with
  PR link and run report.
