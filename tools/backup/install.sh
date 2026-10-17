#!/usr/bin/env bash
# Installs reviewed code and units. Enabling timers is deliberately separate:
# run/restore/traffic verification must pass before scheduling production jobs.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ "$(id -u)" = 0 ] || { echo 'Run on the VPS as root.' >&2; exit 1; }
[ -s /etc/squadhub-backup/.env ] || { echo 'Provision the root-only backup configuration first.' >&2; exit 1; }
python3 -c 'import boto3, cryptography'
install -d -m 700 /opt/squadhub-backup /var/lib/squadhub-backup
install -m 700 "$ROOT/backup.py" /opt/squadhub-backup/backup.py
install -m 700 "$ROOT/restore_test.py" /opt/squadhub-backup/restore_test.py
install -m 644 "$ROOT"/systemd/* /etc/systemd/system/
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/squadhub-backup{,-watchdog,-restore-check}.{service,timer}
echo 'Installed. Run an initial backup and isolated restore test before enabling timers.'
