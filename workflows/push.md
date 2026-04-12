# Push to GitHub

## Objective
Commit all changes with an auto-generated message and push to `origin/main`.

## When to Use
When the user says "push".

## Steps

1. Run `git status` to check for changes. If nothing has changed, inform the user and stop.
2. Run `git diff --stat` and `git diff --cached --stat` to understand the scope.
3. Run `git add -A` to stage everything. (`.gitignore` already excludes secrets, `node_modules/`, `.tmp/`, build artifacts.)
4. Run `git diff --cached` to get the full staged diff.
5. Analyze the diff and generate a commit message:
   - Imperative mood, under 72 characters
   - Match the repo's existing style (e.g., "Fix nav icon colors", "Add user type system")
   - Focus on the "what" and "why", not the "how"
6. Run `git commit -m "<generated message>"` using a HEREDOC for formatting.
7. Run `git push origin main`.
8. Report the commit hash and push result to the user.

## Edge Cases

- **Push rejected (remote ahead):** Run `git pull --rebase origin main`, then retry the push. If merge conflicts arise, stop and ask the user for help.
- **Nothing to commit:** Inform the user "Nothing to push — working tree is clean."
- **Sensitive files:** Never commit `.env`, `credentials.json`, or `token.json`. These are already in `.gitignore`, but verify if `git status` shows them as untracked.
