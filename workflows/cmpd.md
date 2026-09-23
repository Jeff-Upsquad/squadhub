# CMPD — Commit, Merge, Push, Deploy

## Objective

Run the complete source-code pipeline: branch, commit, open a PR, merge, then `PD`. CMPD gets code onto `origin/main` via a PR and deploys when relevant. Direct pushes to `main` are not allowed in this pipeline — `main` only moves through a PR merge.

> **Greptile review is PAUSED (2026-09-23).** The automated Greptile review step is intentionally skipped for now; the PR still gates the merge, but no external review is awaited. To bring it back, restore step 3 below (wait for Greptile, address every finding, repeat until no open blocking comments) and re-add the "unresolved review" stop condition.

Desktop app releases (`desktop-app/` + `desktop-app-release.yml`) are never triggered by CMPD — they require an explicit tag or manual workflow dispatch.

## Steps

1. Read and execute [cm.md](cm.md), including `npx tsc --noEmit -p server/tsconfig.json` and `npm run check:shared-imports`. Work lands on a `feat/*`, `fix/*`, or `docs/*` branch — never on `main`.
2. Push the branch and open a PR against `main` (run in the same checkout CM used — never split branch work across checkouts):

   ```bash
   git push -u origin <branch>
   gh pr create --repo Jeff-Upsquad/squadhub --base main --head <branch> \
     --title "<imperative summary>" --body "<what changed and how to test>"
   ```

3. _(Paused: Greptile review.)_ Skip waiting for an automated review. If a human leaves review comments on the PR, still address them before merging.
4. Merge once checks are green:

   ```bash
   gh pr merge --repo Jeff-Upsquad/squadhub <PR-number> --merge
   ```

   Do not delete the branch here — `CU` owns branch cleanup and requires confirmation first.
5. Sync the primary checkout and execute [pd.md](pd.md). Pass the merged PR number so deployment is scoped from that PR's changed files.
6. Confirm the primary checkout is clean and synchronized with `origin/main`.
7. Report the branch, PR link, merge commit, push, CI state, any deployment, and testing instructions (see [test-handoff.md](test-handoff.md)).

## Important boundary

Do not build or publish a desktop app release, tag `desktop-app-v*`, or dispatch `desktop-app-release.yml` from CMPD. Those actions require an explicit release tag or manual dispatch.

## Edge cases

- If there is nothing to commit and no open PR, report that the pipeline is already complete.
- If a PR is already open for the branch, reuse it instead of opening another.
- Stop on failed checks, unresolved human review comments, merge conflicts, rejected pushes, failed deployments, or unhealthy verification. Do not claim completion while a required step is failing. Do not merge with admin flags to bypass failing checks.
