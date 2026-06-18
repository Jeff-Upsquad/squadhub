# CM — Commit, Merge

## Objective
Stage, commit, and (if on a feature branch) merge to `main` — **locally only**. No push, no deploy. Use this to checkpoint work or integrate a branch without shipping to production yet. The first half of **CMPD**.

## Inputs
- `git status` — to confirm what's changed
- A descriptive commit message

## Tools Used
- `git add -A` / `git commit` / `git checkout` / `git merge`

## Estimated Time
- ~30 seconds

## Steps

### 0. Pre-check
- Confirm there are changes worth committing (`git status`).
- Ensure the code compiles before committing:
  ```bash
  npx tsc --noEmit -p server/tsconfig.json
  ```

### 1. Commit
```bash
git add -A
git commit -m "<descriptive message>"
```
- Imperative mood, under 72 chars. Conventional Commits style.

### 2. Merge
If on a feature branch:
```bash
git checkout main
git merge --no-ff <branch>
```
If already on `main`, this step is a no-op — stop after the commit.

### 3. Stop
Do **not** push or deploy. To ship, follow **PD** ([pd.md](pd.md)) next, or run **CMPD** ([cmpd.md](cmpd.md)) for the whole pipeline.

## Edge Cases
- **Merge conflict:** resolve, `git add` the resolved files, `git commit`, then stop and report.
- **Nothing to commit:** inform the user and stop.
- **Build fails:** stop — fix before committing.
