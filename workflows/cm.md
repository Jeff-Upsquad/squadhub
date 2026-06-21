# CM — Commit, Merge (cloud-aware)

## Objective
Stage and commit work, then make sure it is **preserved**. Behaviour depends on where the session runs:

- **Local session:** commit and (on a feature branch) merge to `main` — **locally only**, no push. A fast checkpoint.
- **Cloud session:** commit, then **push the feature branch** to GitHub so the work survives the container and is one `git pull` away on your machine. A cloud container is ephemeral — un-pushed commits are **lost** when it is reclaimed, so "commit only" is not safe here.

Still the first half of **CMPD**. It never pushes `main` and never deploys.

## Why cloud is different
A cloud session runs in an isolated, throwaway container with **no access to your local disk**. The only bridge to your machine is GitHub, so to "land it in local" the work has to be pushed to the remote branch, then pulled on your machine:

```
cloud commit → push (feature branch) → GitHub → git pull on your laptop → your local folder
```

The cloud container **cannot** run the final `git pull` for you — that step happens on your machine (see Step 3).

## Inputs
- `git status` — to confirm what's changed
- A descriptive commit message
- Whether this is a **cloud** session (remote-execution environment) or **local**

## Tools Used
- `git add -A` / `git commit` / `git checkout` / `git merge` / `git push`

## Estimated Time
- ~30 seconds (local) / ~45 seconds (cloud, includes push)

## Steps

### 0. Pre-check
- Confirm there are changes worth committing (`git status`).
- Ensure the code compiles before committing (when deps are installed):
  ```bash
  npx tsc --noEmit -p server/tsconfig.json
  ```

### 1. Commit
```bash
git add -A
git commit -m "<descriptive message>"
```
- Imperative mood, under 72 chars. Conventional Commits style.

### 2. Preserve the work
**Local session** — if on a feature branch, merge to `main` locally:
```bash
git checkout main
git merge --no-ff <branch>
```
If already on `main`, this is a no-op — stop after the commit. **Do not push.**

**Cloud session** — push the feature branch so it leaves the container and is retrievable:
```bash
git push -u origin <branch>
```
- Do **NOT** push `main` (that is **PD**/**CMPD**, and needs explicit go-ahead).
- Do **not** merge to `main` inside the container — that merge is ephemeral and never leaves the container. Merge on your machine instead (Step 3) or open a PR.
- On network failure, retry with backoff (2s, 4s, 8s, 16s).

### 3. Pull to your local machine (cloud only)
Run this **on your own machine** (the cloud container cannot do it):
```bash
git fetch origin <branch>
git checkout <branch>        # or: git pull origin <branch>
```
Then, if you want it on `main`, merge locally there or open a PR.

> Optional convenience — add a git alias on your machine so one command grabs the latest cloud work:
> ```bash
> git config --global alias.cloudpull '!f(){ git fetch origin "$1" && git checkout "$1" && git pull origin "$1"; }; f'
> # usage:  git cloudpull <branch>
> ```

### 4. Stop
No deploy. To ship, follow **PD** ([pd.md](pd.md)) next, or run **CMPD** ([cmpd.md](cmpd.md)) for the whole pipeline.

## Edge Cases
- **Merge conflict (local merge):** resolve, `git add` the resolved files, `git commit`, then stop and report.
- **Nothing to commit:** inform the user and stop.
- **Build fails:** stop — fix before committing.
- **Push fails (network):** retry with exponential backoff (2s, 4s, 8s, 16s).
- **Commit shows "Unverified" locally:** SSH-signed commits report `%G?` = `N` without a local `gpg.ssh.allowedSignersFile`; they still verify on GitHub once pushed. Re-signing won't change the local result.
