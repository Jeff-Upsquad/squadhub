#!/usr/bin/env python3
"""Encrypted offsite backups for the isolated local PostgreSQL deployment.

Reuses the existing verified R2 upload, encryption, retention and restore code.
Local state and R2 namespaces are separate; hosted backups cannot be pruned.
Install backup.py / compact_transport.py / restore_test.py alongside this file.
The default command only backs up local data; no timers are installed or changed.
"""
import argparse
import contextlib
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backup'))
import backup as lib


class LocalBackup(lib.Backup):
    def __init__(self, config_path):
        self.config_path = Path(config_path)
        self.c = lib.env_file(config_path)
        expected = {'DATABASE_KIND': 'postgres', 'PROJECT_REF': 'squadhub-local',
                    'PGHOST': 'db', 'PGPORT': '5432', 'PGUSER': 'local_backup',
                    'PGSSLMODE': 'disable', 'DOCKER_NETWORK': 'squadhub-local-data_data',
                    'RESTORE_ADMIN_USER': 'postgres'}
        if any(self.c.get(k) != v for k, v in expected.items()):
            raise ValueError('Local backup requires the isolated PostgreSQL configuration')
        if not lib.re.fullmatch(r'squadhub_trial_[0-9]{8}_[a-f0-9]{8}', self.c.get('PGDATABASE', '')):
            raise ValueError('Only a newly imported trial database is supported until cutover review')
        self.project = 'squadhub-local'
        self.root = Path(self.c.get('STATE_DIR', ''))
        if not self.root.is_absolute() or 'squadhub-local' not in self.root.name:
            raise ValueError('Separate absolute local backup state directory is required')
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.image = self.c['POSTGRES_IMAGE']
        if self.image != 'postgres:17.9-alpine':
            raise ValueError('Use the tested PostgreSQL image')
        self.key = bytes.fromhex(self.c['BACKUP_ENCRYPTION_KEY'])
        if len(self.key) != 32:
            raise ValueError('A 256-bit backup encryption key is required')
        self.app = lib.env_file(self.c['APP_ENV_FILE'])
        if self.c.get('ENABLE_ALERTS') == 'true':
            if self.c.get('ALERT_API_URL') != 'http://127.0.0.1:55400':
                raise ValueError('Local alerts must use the loopback data gateway')
            self.app['SUPABASE_URL'] = self.c['ALERT_API_URL']
        self.prefix = 'backups/postgres/squadhub-local/'

    def pg_env(self):
        return {k: self.c[k] for k in ('PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE')}

    def docker_client(self, env, command, *args, mounts=(), interactive=False):
        cmd = ['docker', 'run', '--rm', '--user', '0:0', '--network', self.c['DOCKER_NETWORK']]
        if interactive:
            cmd.append('-i')
        for source, target in mounts:
            cmd += ['-v', f'{source}:{target}']
        return cmd + ['--env-file', str(env), '--entrypoint', command, self.image, *args]

    @contextlib.contextmanager
    def snapshot(self, env):
        with super().snapshot(env) as (snap, query):
            query("SET timezone='UTC'; SET extra_float_digits=3")
            yield snap, query

    def source_metadata(self, query):
        return json.loads(query("SELECT json_build_object('server_version',current_setting('server_version'), 'database_bytes',pg_database_size(current_database()), 'vault_secrets',0, 'roles',(SELECT json_agg(json_build_object('name',rolname,'bypass_rls',rolbypassrls)) FROM pg_roles WHERE left(rolname,3)<>'pg_'), 'verification_settings',json_build_object('extra_float_digits',current_setting('extra_float_digits')))"))

    # Trial has no production notification side effects. External monitoring
    # must be wired and verified as part of the separate production cutover.
    def cache_push(self):
        if self.c.get('ENABLE_ALERTS') == 'true':
            return super().cache_push()

    def alerts(self):
        if self.c.get('ENABLE_ALERTS') == 'true':
            return super().alerts()
        return 0


if __name__ == '__main__':
    os.umask(0o077)
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['backup', 'restore-test', 'watchdog'])
    p.add_argument('--config', required=True)
    args = p.parse_args()
    job = LocalBackup(args.config)
    try:
        if args.command == 'restore-test':
            from restore_test import restore_test
            restore_test(args.config, backup_factory=LocalBackup)
        else:
            import fcntl
            with (job.root / 'job.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                job.backup() if args.command == 'backup' else job.watchdog()
    except BlockingIOError:
        print(json.dumps({'status': 'already_running'}))
    except Exception:
        job.queue_alert('Local database backup needs attention',
                        'The PostgreSQL backup or restore check failed. Check the private backup logs on the server.',
                        'local-backup-failure-' + lib.dt.datetime.now(lib.UTC).strftime('%Y-%m-%d'))
        with contextlib.suppress(Exception):
            job.alerts()
        print(json.dumps({'status': 'failed', 'command': args.command, 'diagnostics': 'private backup logs'}))
        raise SystemExit(1)
