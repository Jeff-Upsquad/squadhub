# CMPD — Commit, Review, Merge, Push, Deploy

## Objective

Run the complete source-code pipeline: branch, commit, open a PR, get a Greptile review, merge, then `PD`. CMPD gets reviewed code onto `origin/main` and deploys when relevant. Greptile only reviews pull requests, so direct pushes to `main` are not allowed in this pipeline.

Desktop app releases (`desktop-app/` + `desktop-app-release.yml`) are never triggered by CMPD — they require an explicit tag or manual workflow dispatch.

## Steps

1. Read and execute [cm.md](cm.md), including `npx tsc --noEmit -p server/tsconfig.json` and `npm run check:shared-imports`. Work lands on a `feat/*`, `fix/*`, or `docs/*` branch — never on `main`.
2. Push the branch and open a PR against `main` (run in the same checkout CM used — never split branch work across checkouts):

   ```bash
   git push -u origin <branch>
   gh pr create --repo Jeff-Upsquad/squadhub --base main --head <branch> \
     --title "<imperative summary>" --body "<what changed and how to test>"
   ```

3. Wait for Greptile's review of the PR. Address every finding: fix on the branch, re-run checks, and push. Repeat until Greptile has no open blocking comments.
4. Merge only when checks are green and Greptile's review is resolved:

   ```bash
   gh pr merge --repo Jeff-Upsquad/squadhub <PR-number> --merge
   ```

   Do not delete the branch here — `CU` owns branch cleanup and requires confirmation first.
5. Sync the primary checkout and execute [pd.md](pd.md). Pass the merged PR number so deployment is scoped from that PR's changed files.
6. Confirm the primary checkout is clean and synchronized with `origin/main`.
7. Report the branch, PR link, Greptile outcome, merge commit, push, CI state, any deployment, and testing instructions (see [test-handoff.md](test-handoff.md)).

## Important boundary

Do not build or publish a desktop app release, tag `desktop-app-v*`, or dispatch `desktop-app-release.yml` from CMPD. Those actions require an explicit release tag or manual dispatch.

## Edge cases

- If there is nothing to commit and no open PR, report that the pipeline is already complete.
- If a PR is already open for the branch, reuse it instead of opening another.
- Stop on failed checks, an unresolved Greptile review, merge conflicts, rejected pushes, failed deployments, or unhealthy verification. Do not claim completion while a required step is failing. Do not merge over an unresolved review by using admin flags.
