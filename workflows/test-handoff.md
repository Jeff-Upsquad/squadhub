# Test Handoff — "Here's what to test"

## Objective
Whenever something becomes testable by the user, hand it off with a short, plain-language summary of **what changed** and **how to test it**. The user should never have to dig through the diff or guess what to click.

## When to Run (triggers)
Run this summary automatically — without being asked — at the end of any of these:

1. **CMPD** completes (Commit → Merge → Push → Deploy) — see [cmpd.md](cmpd.md)
2. **PD** completes (Push → Deploy, the last two steps of CMPD) — see [deploy.md](deploy.md)
3. **A localhost link is given** — any time you hand the user a `http://localhost:<port>` URL to look at
4. **An Android app is loaded onto the phone for testing** — OTA update pushed or a new APK built/installed — see [cashbook-app-release.md](cashbook-app-release.md)

## Output Format
Keep it simple and skimmable. Lead with where to go, then what to check. Avoid file paths and internal jargon — describe behavior the user can see.

```
✅ Deployed — here's what to test:

📍 Where: https://admin.squadhub.in  (or localhost:3001 / the Cash Book app on your phone)

What changed:
- <feature 1 in one plain sentence — what the user will now see or be able to do>
- <feature 2 …>

How to test:
1. <concrete step the user takes>
2. <what they should see if it worked>

Heads up (only if relevant):
- <anything to watch for: needs a hard refresh, only affects X tier, requires re-login, etc.>
```

For a **localhost** handoff, swap the header to `🔗 Running locally — here's what to test:` and give the exact URL + which surface it is (web / admin) and which port.

For an **Android** handoff, swap the header to `📱 Loaded on your phone — here's what to test:` and say whether it's an OTA update (just reopen the app) or a new APK (install required), plus the version.

## Notes
- **Cover the whole shipped range, not just your commits.** A push/deploy ships EVERYTHING unpushed on `main`, including commits from other sessions/worktrees. Before handing off, diff the deployed range (the `BEFORE_SHA -> AFTER_SHA` that `deploy.sh` prints, or `origin/main..main` before a push) and list every feature that went live — not only what you built this session. Re-check migrations across that FULL range too (`deploy.sh` doesn't run them).
- Map technical changes to user-visible behavior. "Added `brief_group_id` fan-out" → "Multi-tier briefs now show as one card with per-tier tabs."
- If the deploy touched multiple surfaces (web + admin), give the test steps per surface.
- If something shipped but couldn't be runtime-verified, say so plainly so the user knows to check it.
- This is a reporting step, not a gate — it runs after the work is done and successful.
