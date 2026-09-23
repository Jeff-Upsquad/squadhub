# CM — Commit on a branch

## Objective

Validate, stage, and commit the current changes on a feature branch. Do not push, open a PR, or deploy. This is the first half of `CMPD`. Direct commits to `main` are not allowed — `main` only moves via PR merges (or fast-forward sync).

## Steps

1. Inspect `git status`, the current branch, worktrees, and the complete diff. Preserve unrelated user changes and do not commit secrets or generated artifacts.
2. Confirm there are changes worth committing. If there are none, report that and stop.
3. Work must happen on a feature branch in this checkout. If on `main`, create one from synced `main` first. All git operations in CM run in the invoking checkout — never split branch creation and committing across checkouts:

   ```bash
   git pull --ff-only origin main
   git checkout -b <feat|fix|docs>/<slug>
   ```

   Branch names use `feat/` for features, `fix/` for bug fixes, and `docs/` for docs/SOP-only changes. If already on a non-`main` branch, verify it matches one of those prefixes before committing; otherwise create a new branch.
4. Run repository checks before committing:

   ```bash
   npx tsc --noEmit -p server/tsconfig.json
   npm run check:shared-imports
   ```

   For web/admin-heavy changes, also verify:

   ```bash
   npm run build -w shared && npm run build -w web --if-present && npm run build -w admin --if-present
   ```

   Stop on validation failure and fix it before committing.
5. Stage only the intended files and commit with an imperative message under 72 characters.
6. Report the branch and commit. Do not push, open a PR, merge, or deploy — `CMPD` handles the rest.

## Safety and edge cases

- Never commit directly on `main`. If `main` itself is dirty, stop and ask for scope instead of committing there.
- Never add `.env`, `.env.production`, `credentials.json`, `token.json`, APKs, or other ignored secrets/artifacts.
- If unrelated changes overlap the intended commit, stop and ask for scope.
- If `npx tsc` or `check:shared-imports` fails, do not commit — fix first.
