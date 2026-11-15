#!/usr/bin/env python3
"""Prove a verified R2 archive restores into vanilla PostgreSQL, offline.

Run on the backup VPS. Reads an existing encrypted backup only; never connects
to the production database. Generated disposable container has no network,
published ports, persistent volumes, or production credentials. Report contains
counts only. Password hashes and row contents never leave the container.
"""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time


def portable_catalog(catalog):
    """Vault's extension is absent from vanilla PG. Nothing else is omitted."""
    kept, removed = [], []
    for line in catalog.splitlines():
        if not line.startswith(';') and re.search(r'\b(?:vault|supabase_vault)\b', line):
            removed.append(line)
        else:
            kept.append(line)
    return '\n'.join(kept) + '\n', removed


def rehearse(config, backup_module_dir, image, staging_container=None):
    os.umask(0o077)
    sys.path.insert(0, str(backup_module_dir))
    import backup as lib
    job = lib.Backup(config)
    manifest = json.loads((job.root / 'latest.json').read_text())
    if not manifest.get('verified') or not manifest['object_key'].startswith(job.prefix):
        raise RuntimeError('Expected verified archive for the configured project')
    name = staging_container or 'sqh-plain-pg-rehearsal-' + secrets.token_hex(6)
    database = 'squadhub_trial_' + lib.dt.datetime.now(lib.UTC).strftime('%Y%m%d') + '_' + secrets.token_hex(4)
    if staging_container:
        # Only the explicitly isolated Compose stack is a valid persistent
        # destination. Never accept a hostname, production container or DB URL.
        inspected = json.loads(subprocess.check_output(['docker', 'inspect', staging_container]))[0]
        labels = inspected['Config'].get('Labels') or {}
        if labels.get('com.docker.compose.project') != 'squadhub-local-data' or labels.get('com.docker.compose.service') != 'db':
            raise RuntimeError('Only the isolated squadhub-local-data db container is allowed')
        networks = list(inspected['NetworkSettings']['Networks'])
        if not networks or inspected['HostConfig'].get('PortBindings'):
            raise RuntimeError('Trial database must have no published ports')
        for network in networks:
            details = json.loads(subprocess.check_output(['docker', 'network', 'inspect', network]))[0]
            if not details.get('Internal'):
                raise RuntimeError('Trial database must use internal networks only')
    with tempfile.TemporaryDirectory(prefix='plain-pg-', dir=job.root) as temp:
        folder = Path(temp)
        enc = folder / 'backup.enc'
        job.s3().download_file(job.app['R2_BUCKET_NAME'], manifest['object_key'], str(enc))
        if lib.sha256(enc) != manifest['sha256']:
            raise RuntimeError('Archive checksum mismatch')
        with enc.open('rb') as source, (folder / 'payload.tar.gz').open('wb') as target:
            lib.decrypt_stream(source, target, job.key)
        with tarfile.open(folder / 'payload.tar.gz') as archive:
            for member in ['database.dump', 'inventory.json']:
                with archive.extractfile(member) as source, (folder / member).open('wb') as target:
                    shutil.copyfileobj(source, target)
        inventory = json.loads((folder / 'inventory.json').read_text())
        if inventory.get('vault_secrets') != 0 or any(t['rows'] for t in inventory['tables'] if t['schema'] == 'vault'):
            raise RuntimeError('Nonempty Vault cannot be omitted: migrate its encryption first')
        try:
            if not staging_container:
                job.run(['docker', 'run', '-d', '--name', name, '--network', 'none', '--memory', '1g',
                         '--cpus', '0.75', '--tmpfs', '/var/lib/postgresql/data:rw,size=768m',
                         '--env-file', '/dev/stdin', image],
                        stdin=('POSTGRES_PASSWORD=' + secrets.token_hex(32) + '\nPOSTGRES_HOST_AUTH_METHOD=trust\n').encode())
            for _ in range(60):
                check = subprocess.run(['docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if check.returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError('Disposable PostgreSQL did not become ready')
            def sql(statement, database=database):
                return job.run(['docker', 'exec', '-i', name, 'psql', '-h', '127.0.0.1', '-U', 'postgres',
                                '-d', database, '-XqAt', '-v', 'ON_ERROR_STOP=1'], stdin=statement.encode()).decode().strip()
            for role in inventory['roles']:
                ident = '"' + role['name'].replace('"', '""') + '"'
                literal = "'" + role['name'].replace("'", "''") + "'"
                sql(f'DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname={literal}) THEN CREATE ROLE {ident} NOLOGIN; END IF; END $$;', 'postgres')
            # Historical inventories used LIKE 'pg_%' (underscore wildcard),
            # accidentally omitting pgbouncer along with PostgreSQL roles.
            sql("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='pgbouncer') THEN CREATE ROLE pgbouncer NOLOGIN; END IF; END $$;", 'postgres')
            sql(f'CREATE DATABASE {database} TEMPLATE template0;', 'postgres')
            job.run(['docker', 'cp', str(folder / 'database.dump'), name + ':/tmp/database.dump'])
            catalog = job.run(['docker', 'exec', name, 'pg_restore', '--list', '/tmp/database.dump']).decode()
            selected, removed = portable_catalog(catalog)
            (folder / 'portable.list').write_text(selected)
            job.run(['docker', 'cp', str(folder / 'portable.list'), name + ':/tmp/portable.list'])
            job.run(['docker', 'exec', name, 'pg_restore', '-h', '127.0.0.1', '-U', 'postgres', '--no-owner',
                     '--exit-on-error', '--use-list=/tmp/portable.list', '-d', database, '/tmp/database.dump'])
            checked = []
            digits = int(inventory.get('verification_settings', {}).get('extra_float_digits', 0))
            if digits not in range(-15, 4):
                raise RuntimeError('Invalid inventory float-rendering setting')
            for table in inventory['tables']:
                if table['schema'] == 'vault':
                    continue
                schema = '"' + table['schema'].replace('"', '""') + '"'
                tab = '"' + table['table'].replace('"', '""') + '"'
                # Hosted Supabase and its restore image use extra_float_digits=0;
                # vanilla PostgreSQL defaults to 1. Match the historical JSON
                # inventory's float rendering rather than reporting false data loss.
                actual = json.loads(sql(f"SET timezone='UTC'; SET extra_float_digits={digits}; SELECT json_build_object('rows',count(*),'digest',md5(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)))) FROM {schema}.{tab} t;"))
                if actual != {'rows': table['rows'], 'digest': table['digest']}:
                    raise RuntimeError(f"Row verification failed for {table['schema']}.{table['table']}")
                checked.append(table)
            # Imported hashes can be retained if bcrypt-compatible; never print them.
            hashes = json.loads(sql("SELECT json_build_object('users',count(*),'bcrypt',count(*) FILTER (WHERE encrypted_password ~ '^\\$2[aby]\\$'),'without_password',count(*) FILTER (WHERE coalesce(encrypted_password,'')='')) FROM auth.users"))
            result = {'source_run_id': manifest['run_id'], 'target_image': image,
                      'verified_at': lib.dt.datetime.now(lib.UTC).isoformat(), 'isolated_network': True,
                      'tables_verified': len(checked), 'rows_verified': sum(t['rows'] for t in checked),
                      'all_row_digests_match': True, 'auth_hash_compatibility': hashes,
                      'omitted_empty_vault_catalog_entries': len(removed),
                      'production_changed': False}
            if staging_container:
                result['staging_database'] = database
            lib.atomic_json(job.root / 'plain-postgres-rehearsal.json', result)
            return result
        finally:
            if not staging_container:
                subprocess.run(['docker', 'rm', '-f', '-v', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                # Plain dump contains hashes and private business records. It
                # must not remain in the container's writable filesystem.
                subprocess.run(['docker', 'exec', name, 'rm', '-f', '/tmp/database.dump', '/tmp/portable.list'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config', default='/etc/squadhub-backup/.env')
    p.add_argument('--backup-module-dir', type=Path, default=Path('/opt/squadhub-backup'))
    p.add_argument('--image', default='postgres:17.9-alpine')
    p.add_argument('--staging-container', help='Import into a NEW database in the isolated Compose db service only')
    args = p.parse_args()
    try:
        print(json.dumps(rehearse(args.config, args.backup_module_dir, args.image, args.staging_container)))
    except Exception as error:
        # The helper saves underlying SQL diagnostics to its root-only private
        # error log. Never print pg_restore COPY errors containing customer data.
        print(json.dumps({'status': 'failed', 'reason': str(error)}))
        raise SystemExit(1)
