#!/usr/bin/env python3
"""Provision a read-only trial backup identity in the isolated local DB only."""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backup'))
from backup import env_file


def configure(stack_dir, source_config, report_path):
    os.umask(0o077)
    stack_dir = stack_dir.resolve()
    target = stack_dir / '.backup.env'
    if target.exists():
        raise ValueError('Trial backup configuration already exists; review before rotation')
    report = json.loads(report_path.read_text())
    database = report.get('staging_database', '')
    if not report.get('all_row_digests_match') or not re.fullmatch(r'squadhub_trial_[0-9]{8}_[a-f0-9]{8}', database):
        raise ValueError('A verified, newly imported trial database is required')
    container = 'squadhub-local-data-db-1'
    inspected = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
    labels = inspected['Config'].get('Labels') or {}
    if labels.get('com.docker.compose.project') != 'squadhub-local-data' or labels.get('com.docker.compose.service') != 'db':
        raise ValueError('Refusing a non-trial database')
    password = secrets.token_hex(48)
    statement = """DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='local_backup')
      THEN CREATE ROLE local_backup LOGIN BYPASSRLS; END IF; END $$;
      ALTER ROLE local_backup PASSWORD '%s'; GRANT pg_read_all_data TO local_backup;
      ALTER ROLE local_backup SET default_transaction_read_only=on;
    """ % password
    subprocess.run(['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', database,
                    '-Xq', '-v', 'ON_ERROR_STOP=1'], input=statement.encode(), check=True, stdout=subprocess.DEVNULL)
    source = env_file(source_config)
    root = Path('/var/lib/squadhub-local-backup')
    root.mkdir(mode=0o700, exist_ok=True)
    values = {**source, 'DATABASE_KIND': 'postgres', 'PROJECT_REF': 'squadhub-local', 'PGHOST': 'db',
              'PGPORT': '5432', 'PGUSER': 'local_backup', 'PGPASSWORD': password, 'PGDATABASE': database,
              'PGSSLMODE': 'disable', 'DOCKER_NETWORK': 'squadhub-local-data_data',
              'RESTORE_ADMIN_USER': 'postgres', 'POSTGRES_IMAGE': 'postgres:17.9-alpine',
              'STATE_DIR': str(root), 'BACKUP_TRANSPORT': 'native'}
    values.pop('PGHOSTADDR', None)
    values.pop('PGSSLROOTCERT', None)
    values['CONFIG_FILES_JSON'] = json.dumps(json.loads(source['CONFIG_FILES_JSON']) + [str(stack_dir / '.env'), str(target)])
    with target.open('x') as out:
        for key, value in values.items():
            if '\n' in str(value):
                raise ValueError('Multiline configuration values are not supported')
            out.write(f'{key}={value}\n')
    target.chmod(0o600)
    return {'configured': True, 'database': database, 'destination': 'Cloudflare R2',
            'namespace': 'backups/postgres/squadhub-local/', 'production_timers_changed': False}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--stack-dir', type=Path, required=True)
    p.add_argument('--source-config', type=Path, default=Path('/etc/squadhub-backup/.env'))
    p.add_argument('--report', type=Path, default=Path('/var/lib/squadhub-backup-hvcpoxgkdybyscaebtik/plain-postgres-rehearsal.json'))
    args = p.parse_args()
    print(json.dumps(configure(args.stack_dir, args.source_config, args.report)))
