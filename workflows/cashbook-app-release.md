# Cash Book Mobile App — Release Workflow

## Overview

After making changes to the Cash Book mobile app (`/Users/jeffzeena/squadhub-cashbook`), follow this workflow to build, deploy, and optionally force-update all users.

## Post-Change Checklist

After completing any code changes to the Cash Book app, **always do the following before closing the task:**

1. Read the current version from `app.json` → `expo.version`
2. Determine if the change is **JS-only** or **native** (see below)
3. Ask the user:

> The current live version is **{current_version}**.
>
> - Changes made: {brief summary of changes}
> - Change type: {JS-only / Native}
>
> **Options:**
> 1. **OTA update** — Push JS changes silently. Users get it on next app open. No new APK needed.
> 2. **New APK + force update** — Build a new APK (version {next_version}), and force all users to update before they can use the app.
> 3. **New APK only** — Build a new APK but don't force existing users to update yet.
> 4. **Skip** — Don't release yet.
>
> Which would you like?

## Change Type Detection

| Change | Type | Release method |
|--------|------|---------------|
| UI tweaks, bug fixes, new screens, logic changes | JS-only | OTA update (`eas update`) |
| New native package added/removed | Native | New APK required |
| Expo SDK upgrade | Native | New APK required |
| Android permissions changed | Native | New APK required |
| `app.json` plugins changed | Native | New APK required |

## Release Procedures

### Option 1: OTA Update (JS-only)

```bash
cd /Users/jeffzeena/squadhub-cashbook
eas update --channel preview --message "{description}"
```

To push to all production users:
```bash
eas update --channel production --message "{description}"
```

No version bump needed. No APK build needed.

### Option 2: New APK + Force Update

1. Bump version in `app.json` (e.g. `1.0.0` → `1.1.0`)
2. Build new APK:
   ```bash
   cd /Users/jeffzeena/squadhub-cashbook
   npx eas build --platform android --profile preview --non-interactive
   ```
3. Copy the build URL from the EAS output
4. SSH into VPS and update env vars:
   ```bash
   ssh root@72.61.245.97
   cd /opt/squadhub
   # Edit .env and set:
   # CASHBOOK_MIN_VERSION=1.1.0
   # CASHBOOK_DOWNLOAD_URL=https://expo.dev/accounts/upsquad_connect/projects/squadhub-cashbook/builds/<build-id>
   echo 'CASHBOOK_MIN_VERSION=1.1.0' >> .env
   echo 'CASHBOOK_DOWNLOAD_URL=<build-url>' >> .env
   docker compose up -d server
   ```
5. Verify: `curl https://api.squadhub.in/cashbook/app-config`

All users on older versions will now see "Update Required" until they install the new APK.

### Option 3: New APK Only (no force)

1. Optionally bump version in `app.json`
2. Build new APK:
   ```bash
   cd /Users/jeffzeena/squadhub-cashbook
   npx eas build --platform android --profile preview --non-interactive
   ```
3. Share the build URL with users who need it
4. Do NOT update `CASHBOOK_MIN_VERSION` on the server

### Option 4: Skip

No action needed. Changes stay local until the next release.

## Verification

- OTA: Open app → it should auto-update on launch (check Settings for version)
- Forced update: `curl https://api.squadhub.in/cashbook/app-config` should return the new `minVersion`
- Old app should show "Update Required" screen

## Hand off for testing

Once the app is loaded on the user's phone (OTA pushed or APK built/installed), give a plain-language summary of what changed and how to test it on the phone. Follow [test-handoff.md](test-handoff.md) — say whether it's an OTA (just reopen) or a new APK (install required) and the version. Do this automatically.

## Current State

| Field | Value |
|-------|-------|
| Live version | `1.0.0` |
| EAS project | `c6d5becd-e89f-412a-ae81-f20c3093a7ea` |
| App config endpoint | `https://api.squadhub.in/cashbook/app-config` |
| Server env location | `/opt/squadhub/.env` on VPS `72.61.245.97` |
