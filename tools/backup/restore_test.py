#!/usr/bin/env python3
"""Restore a verified offsite backup into a network-isolated disposable DB.

Never restores into production. Destructive commands are restricted to a uniquely
named disposable container created here; no ports, env files or persistent host
volumes are attached to the restore database.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import tarfile
import tempfile
import time
import backup as lib


def restore_test(config, run_id=None):
    os.umask(0o077)
    job = lib.Backup(config)
    s3 = job.s3()
    if run_id is None:
        manifest = json.loads((job.root / 'latest.json').read_text())
    else:
        if not lib.re.fullmatch(r'[0-9]{8}T[0-9]{6}Z-[a-f0-9]{32}', run_id):
            raise ValueError('Invalid backup run id')
        manifest = json.loads(s3.get_object(Bucket=job.app['R2_BUCKET_NAME'], Key=job.prefix + run_id + '/manifest.json')['Body'].read())
    if not manifest.get('verified') or not manifest['object_key'].startswith(job.prefix):
        raise RuntimeError('A verified archive from this project is required')
    name = 'sqh-backup-restore-' + secrets.token_hex(6)
    with tempfile.TemporaryDirectory(prefix='restore-', dir=job.root) as temp:
        folder = Path(temp)
        enc = folder / 'backup.enc'
        s3.download_file(job.app['R2_BUCKET_NAME'], manifest['object_key'], str(enc))
        if lib.sha256(enc) != manifest['sha256']:
            raise RuntimeError('Offsite checksum mismatch')
        payload = folder / 'payload.tar.gz'
        with enc.open('rb') as source, payload.open('wb') as target:
            lib.decrypt_stream(source, target, job.key)
        with tarfile.open(payload) as archive:
            # No extractall: only these two known files are needed for the test.
            for member in ['database.dump', 'inventory.json']:
                with archive.extractfile(member) as source, (folder / member).open('wb') as target:
                    lib.shutil.copyfileobj(source, target)
        inventory = json.loads((folder / 'inventory.json').read_text())
        password = secrets.token_hex(32)
        # Secrets are passed through stdin env-file, never printed or passed as
        # password command-line arguments. No credentials from the real app go
        # into this isolated database container.
        client = ['docker', 'exec', '-i', name]
        def sql(statement):
            return job.run(client + ['psql', '-U', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'], stdin=statement.encode()).decode().strip()
        try:
            job.run(['docker', 'run', '-d', '--name', name, '--network', 'none', '--memory', '768m',
                     '--cpus', '1', '--tmpfs', '/var/lib/postgresql/data:rw,size=768m',
                     '--env-file', '/dev/stdin', job.image],
                    stdin=('POSTGRES_PASSWORD=' + password + '\nPOSTGRES_HOST_AUTH_METHOD=trust\n').encode())
            for attempt in range(60):
                check = subprocess.run(['docker', 'exec', name, 'pg_isready', '-U', 'postgres'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if check.returncode == 0:
                    break
                time.sleep(2)
            else:
                raise RuntimeError('Disposable restore database did not become ready')
            # Roles/ACL dependencies are needed even though ownership is mapped
            # to postgres. All restored roles stay NOLOGIN in this test.
            for role in inventory['roles']:
                ident = '"' + role['name'].replace('"', '""') + '"'
                literal = "'" + role['name'].replace("'", "''") + "'"
                sql(f'DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname={literal}) THEN CREATE ROLE {ident} NOLOGIN; END IF; END $$;')
            job.run(['docker', 'cp', str(folder / 'database.dump'), name + ':/tmp/database.dump'])
            job.run(client + ['pg_restore', '-U', 'postgres', '--no-owner', '--clean', '--if-exists', '--exit-on-error', '-d', 'postgres', '/tmp/database.dump'])
            # The restored DB is offline: cron/network extensions cannot contact
            # WhatsApp, webhooks, customer endpoints, or any production service.
            for table in inventory['tables']:
                schema = '"' + table['schema'].replace('"', '""') + '"'
                tab = '"' + table['table'].replace('"', '""') + '"'
                actual = json.loads(sql(f"SET timezone='UTC'; SELECT json_build_object('rows',count(*),'digest',md5(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)))) FROM {schema}.{tab} t;"))
                if actual != {'rows': table['rows'], 'digest': table['digest']}:
                    raise RuntimeError(f"Restored table verification failed: {table['schema']}.{table['table']}")
            result = {'run_id': manifest['run_id'], 'verified_at': lib.dt.datetime.now(lib.UTC).isoformat(),
                      'tables_verified': len(inventory['tables']), 'rows_verified': sum(t['rows'] for t in inventory['tables']),
                      'auth_users_verified': next(t['rows'] for t in inventory['tables'] if (t['schema'],t['table'])==('auth','users')),
                      'all_row_digests_match': True, 'isolated_network': True}
            lib.atomic_json(job.root / 'restore-verification.json', result)
            lib.log('restore_verified', **result)
            return result
        finally:
            # This name is generated here and cannot target an existing app.
            subprocess.run(['docker', 'rm', '-f', '-v', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default=lib.DEFAULT_CONFIG)
    parser.add_argument('--run-id')
    args = parser.parse_args()
    try:
        restore_test(args.config, args.run_id)
    except Exception:
        job=lib.Backup(args.config)
        job.queue_alert('Database backup restore test failed',
                        'The latest backup could not pass the isolated full restore check. Keep the current Supabase plan until this is resolved.',
                        'restore-failure-'+lib.dt.datetime.now(lib.UTC).strftime('%Y-%m-%d'))
        with lib.contextlib.suppress(Exception):job.alerts()
        lib.log('restore_failed')
        raise SystemExit(1)
