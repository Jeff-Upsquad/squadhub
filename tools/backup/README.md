# Shared SquadHub / CRM database backups

This VPS service backs up the complete shared Supabase database (all application
schemas, user accounts and password hashes, schema definitions, policies, grants,
functions, triggers, sequences and table data) without stopping the apps. An
exported repeatable-read snapshot ties the dump to the exact row-count/digest
inventory. A separate encrypted settings bundle includes SquadHub, CRM, Squad
Bots and SMM configuration. Uploaded R2 media is **not** copied by this database
backup; its independent protection remains a separate task.

## Secrets and runtime

- Reviewed source is installed under `/opt/squadhub-backup`.
- Root-only `/etc/squadhub-backup/.env` contains a dedicated read-only database
  login, 32-byte encryption key and non-secret paths/options. Never commit it.
- The DB login has `BYPASSRLS` plus `pg_read_all_data` so exports cannot silently
  omit protected rows. It has no table-write privileges; default transactions
  are read-only. Credentials remain outside app source and command arguments.
- R2 credentials and inbox notification credentials are read from the existing
  server environment file, not embedded into scripts.
- Keep a recovery copy of the backup `.env` away from both the VPS and R2.
  Losing the encryption key means encrypted backup objects cannot be restored.
- PostgreSQL client/server image must match the source major version. The tested
  Supabase image includes its extensions; a vanilla image is insufficient for
  an exact restore involving the Vault extension.
- Python dependencies: boto3 and cryptography; host dependencies: Docker/systemd.

## Operations

After provisioning the root-only configuration and read-only database role:

```sh
sudo bash /opt/squadhub/tools/backup/install.sh
sudo /usr/bin/python3 /opt/squadhub-backup/backup.py backup
sudo /usr/bin/python3 /opt/squadhub-backup/restore_test.py
sudo /usr/bin/python3 /opt/squadhub-backup/backup.py alert-test
```

Run the restore test and inspect traffic before enabling schedules:

```sh
sudo systemctl enable --now squadhub-backup.timer
sudo systemctl enable --now squadhub-backup-watchdog.timer
sudo systemctl enable --now squadhub-backup-restore-check.timer
systemctl list-timers 'squadhub-backup*'
systemctl status squadhub-backup.service
journalctl -u squadhub-backup.service --since today
```

The supplied schedule runs every six hours, with a fifteen-minute freshness
watchdog and weekly isolated full restore check. Times are configured explicitly
in UTC. `Persistent=true` catches a missed job after a reboot. A non-blocking
process lock prevents overlapping backups. Private errors stay on the VPS and
are not sent into alerts or public logs. Temporary plaintext lives only in a
root-only directory and is removed when each job exits normally or on a handled
error. Systemd caps total execution time.

`logical_data_bytes` estimates the uncompressed database-to-VPS transfer. Use
that figure plus metadata overhead and ordinary application traffic against the
Free plan's egress allowance. Compressing the dump on the VPS saves R2 storage
but does not reduce the preceding Supabase download. Adjust the timer and
`STALE_HOURS` together if six-hour backups do not fit the traffic budget.

## Encryption, verification and retention

Each backup is encrypted with AES-256-GCM and a fresh random nonce before upload.
The format is `SQHBACK1` (8 bytes), nonce (12 bytes), ciphertext, tag (16 bytes).
The header and nonce are authenticated. A full R2 download/decrypt/checksum test
must pass before the new snapshot is marked successful or retention runs. R2
may be a public application bucket: only authenticated ciphertext and minimal
operational manifests go there; plaintext data and secrets never do.

Retain all successful snapshots for seven days, then one per UTC day through
30 days. Never prune the latest verified snapshot. Retention only touches this
job's `backups/supabase/<project-ref>/` namespace; it cannot remove uploads or the
separate CRM cleanup archive. Keep the two latest verified encrypted copies
locally. Failed/unverified uploads do not authorize deletion of older backups.

The watchdog retries failed inbox delivery and alerts when the most recent
verified snapshot is too old. It targets only the configured user, with stable
notification IDs to prevent duplicate inbox rows. A cached browser subscription
allows a direct push attempt when the database is down; inbox delivery retries
when it recovers. A complete VPS/network outage prevents this on-server monitor
from running, so an independent external uptime monitor is recommended for that
failure case. Test messages are clearly labeled.

## Restore and disaster recovery

`restore_test.py` downloads and decrypts a verified R2 object, restores the full
custom-format dump into a disposable Postgres container with **no network, no
published ports and no production mounts**, then compares every table's row
count and digest with the source snapshot. This includes `auth.users` and hashed
password data. A successful check is recorded in
`/var/lib/squadhub-backup/restore-verification.json`; failure alerts go to the
configured inbox. The isolated container and its data are removed afterward.

For a real disaster:

1. Obtain the off-server recovery `.env` and the latest verified R2 manifest.
2. Download `backup.enc`, verify SHA-256, and decrypt with `decrypt_stream`.
3. Extract `database.dump`, `inventory.json` and `settings/` into a private folder.
4. Restore to a separate compatible Supabase project first. Enable the same
   extensions and preserve/recreate custom roles, ACLs and managed-schema
   customizations. Do not run a restore against the live project by default.
5. Configure Supabase Auth settings/API keys and app credentials from the saved
   settings. DB role passwords are not copied from `pg_roles`; provision them
   separately. Vault secrets cause backups to fail closed until a supported
   encryption-root-key recovery procedure is configured (currently Vault empty).
6. Validate all rows, permissions, user login, CRM automations, app integrations
   and uploaded-file links before switching the apps to the restored project.

A database restore alone does not create a new Supabase project's service API
settings or recreate Cloudflare objects. Preserve account access separately.
The plan transfer is a separate operation; this installation does not change
Supabase organizations, subscriptions or billing.

References:
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/manage-your-usage/egress
