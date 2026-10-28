#!/usr/bin/env python3
"""Encrypted, snapshot-consistent backups of the shared Supabase database.

Runs on the VPS, independently of the application and desktop. Secrets live in
/etc/squadhub-backup/.env; production never imports this module into the app.
"""
import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import io
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
import urllib.request
import uuid
import xml.etree.ElementTree as ET

MAGIC = b'SQHBACK1'
UTC = dt.timezone.utc
PROJECT = 'kfxdbhwxzvptzzcuzlal'
SUPPORTED_PROJECTS = {PROJECT, 'hvcpoxgkdybyscaebtik'}
DEFAULT_CONFIG = '/etc/squadhub-backup/.env'


def env_file(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            values[k.strip()] = v.strip().strip('\"').strip("'")
    return values


def atomic_json(path, value):
    path = Path(path)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, indent=2))
    os.chmod(temp, 0o600)
    temp.replace(path)


def sha256(path):
    with open(path, 'rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def encrypt_file(source, target, key):
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    header = MAGIC + secrets.token_bytes(12)
    enc = Cipher(algorithms.AES(key), modes.GCM(header[len(MAGIC):])).encryptor()
    enc.authenticate_additional_data(header)
    with open(source, 'rb') as inp, open(target, 'wb') as out:
        out.write(header)
        while chunk := inp.read(1024 * 1024):
            out.write(enc.update(chunk))
        out.write(enc.finalize())
        out.write(enc.tag)


def decrypt_stream(source, target, key):
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    header = source.read(len(MAGIC) + 12)
    if len(header) != len(MAGIC) + 12 or not header.startswith(MAGIC):
        raise ValueError('Unrecognized encrypted-backup format')
    dec = Cipher(algorithms.AES(key), modes.GCM(header[len(MAGIC):])).decryptor()
    dec.authenticate_additional_data(header)
    tail = b''
    while chunk := source.read(1024 * 1024):
        data = tail + chunk
        if len(data) > 16:
            target.write(dec.update(data[:-16]))
        tail = data[-16:]
    target.write(dec.finalize_with_tag(tail))


def retention_victims(manifests, now):
    """All six-hour copies for 7d; one per UTC day through 30d. Always keep latest."""
    if not manifests:
        return []
    ordered = sorted(manifests, key=lambda m: m['created_at'], reverse=True)
    keep = {ordered[0]['run_id']}
    days = set()
    for m in ordered:
        stamp = dt.datetime.fromisoformat(m['created_at'])
        age = now - stamp
        if age <= dt.timedelta(days=7):
            keep.add(m['run_id'])
        elif age <= dt.timedelta(days=30) and stamp.date() not in days:
            keep.add(m['run_id'])
            days.add(stamp.date())
    return [m for m in ordered if m['run_id'] not in keep]


def log(stage, **values):
    print(json.dumps({'stage': stage, **values}), flush=True)


class Backup:
    def __init__(self, config_path=DEFAULT_CONFIG):
        self.config_path = Path(config_path)
        self.c = env_file(config_path)
        self.project = self.c['PROJECT_REF']
        if self.project not in SUPPORTED_PROJECTS:
            raise ValueError('Unexpected source project')
        host = self.c['PGHOST'].lower()
        direct = host == f'db.{self.project}.supabase.co'
        pooler = host.endswith('.pooler.supabase.com') and self.c['PGUSER'].endswith('.' + self.project)
        if not (direct or pooler):
            raise ValueError('Database connection does not match the configured project')
        self.root = Path(self.c.get('STATE_DIR', '/var/lib/squadhub-backup'))
        if self.project != PROJECT:
            if self.project not in self.root.name:
                raise ValueError('Destination backup state must use a separate directory containing its project ref')
            if self.c.get('PGHOSTADDR'):
                raise ValueError('Do not carry a pinned source database address into the destination config')
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.image = self.c['POSTGRES_IMAGE']
        self.key = bytes.fromhex(self.c['BACKUP_ENCRYPTION_KEY'])
        if len(self.key) != 32:
            raise ValueError('A 256-bit backup key is required')
        self.app = env_file(self.c['APP_ENV_FILE'])
        self.prefix = f'backups/supabase/{self.project}/'

    def s3(self):
        import boto3
        return boto3.client('s3', endpoint_url=f"https://{self.app['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                            aws_access_key_id=self.app['R2_ACCESS_KEY_ID'],
                            aws_secret_access_key=self.app['R2_SECRET_ACCESS_KEY'], region_name='auto')

    def pg_env(self):
        return {key: self.c[key] for key in ('PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE', 'PGSSLROOTCERT')}

    @contextlib.contextmanager
    def client_env(self, folder):
        path = Path(folder) / 'client.env'
        path.write_text(''.join(f'{k}={v}\n' for k, v in self.pg_env().items()))
        os.chmod(path, 0o600)
        yield path
        path.unlink()

    def docker_client(self, env, command, *args, mounts=(), interactive=False):
        cmd = ['docker', 'run', '--rm', '--user', '0:0', '--network', 'host']
        cmd += ['-v', f'{self.c["PGSSLROOTCERT"]}:{self.c["PGSSLROOTCERT"]}:ro']
        if interactive:
            cmd.append('-i')
        for source, dest in mounts:
            cmd += ['-v', f'{source}:{dest}']
        return cmd + ['--env-file', str(env), '--entrypoint', command, self.image, *args]

    def run(self, cmd, *, target=None, stdin=None):
        with tempfile.TemporaryFile() as errors:
            proc = subprocess.run(cmd, input=stdin, stdout=target or subprocess.PIPE, stderr=errors,
                                  timeout=1800)
            if proc.returncode:
                # Never include database contents, URLs or credentials in public logs/alerts.
                errors.seek(0)
                (self.root / 'last-private-error.log').write_bytes(errors.read())
                raise RuntimeError(f'{Path(cmd[0]).name} command failed ({proc.returncode}); private error log saved')
            return proc.stdout

    @contextlib.contextmanager
    def snapshot(self, env):
        """Keep the exporting transaction alive through metadata and pg_dump."""
        errors = (self.root / 'snapshot-private-error.log').open('w')
        proc = subprocess.Popen(self.docker_client(env, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', interactive=True),
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors, text=True, bufsize=1)
        def query(sql):
            marker = '__SQH_END_' + secrets.token_hex(8)
            proc.stdin.write(sql + ';\n\\echo ' + marker + '\n')
            proc.stdin.flush()
            result = []
            while line := proc.stdout.readline():
                if line.strip() == marker:
                    return '\n'.join(result).strip()
                result.append(line.rstrip('\n'))
            raise RuntimeError('Snapshot transaction ended unexpectedly')
        try:
            query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
            snap = query('SELECT pg_export_snapshot()')
            if not re.fullmatch(r'[0-9A-Fa-f-]+', snap):
                raise RuntimeError('Invalid exported snapshot')
            yield snap, query
        finally:
            if proc.poll() is None:
                try:
                    query('ROLLBACK')
                    proc.stdin.close()
                    proc.wait(timeout=10)
                except (BrokenPipeError, RuntimeError, subprocess.TimeoutExpired):
                    proc.kill()
                    proc.wait()
            errors.close()

    def inventory(self, query):
        # The digest includes every row and column, sorted by row hash. No row
        # contents leave Postgres in this metadata query.
        sql = """SELECT coalesce(json_agg(json_build_object('schema',schemaname,'table',tablename,
         'verification',query_to_xml(format('SELECT count(*) AS rows, md5(string_agg(md5(row_to_json(t)::text), %L ORDER BY md5(row_to_json(t)::text))) AS digest FROM %I.%I t', '',schemaname,tablename),false,true,''))), '[]'::json)
         FROM pg_tables WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema'"""
        tables = json.loads(query(sql))
        for table in tables:
            xml = ET.fromstring(table.pop('verification'))
            table['rows'] = int(xml.findtext('.//rows'))
            table['digest'] = xml.findtext('.//digest') or None
        return tables

    def bundle(self, folder):
        env = folder / 'client.env'
        with self.snapshot(env) as (snap, query):
            info = json.loads(query("SELECT json_build_object('server_version',current_setting('server_version'),'database_bytes',pg_database_size(current_database()),'vault_secrets',(SELECT count(*) FROM vault.secrets),'roles',(SELECT json_agg(json_build_object('name',rolname,'bypass_rls',rolbypassrls)) FROM pg_roles WHERE rolname NOT LIKE 'pg_%'))"))
            if info['vault_secrets']:
                raise RuntimeError('Vault secrets found: encryption-root-key recovery must be configured first')
            info['tables'] = self.inventory(query)
            atomic_json(folder / 'inventory.json', info)
            log('dumping', tables=len(info['tables']))
            self.run(self.docker_client(env, 'pg_dump', '--format=custom', '--compress=6', '--snapshot', snap,
                                       '--file', '/backup/database.dump', mounts=[(folder, '/backup')]))
        # Measure the uncompressed logical data stream, not compressed file size:
        # compression on this VPS does not reduce Supabase -> VPS traffic.
        cmd = self.docker_client(env, 'pg_restore', '--data-only', '--file=-', '/backup/database.dump', mounts=[(folder, '/backup')])
        with (self.root / 'measure-private-error.log').open('w') as errors:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=errors)
            logical_bytes = 0
            while chunk := proc.stdout.read(1024 * 1024):
                logical_bytes += len(chunk)
            if proc.wait():
                raise RuntimeError('Could not measure logical backup size')
        # Capture encrypted application settings, including CRM encryption keys,
        # and configuration needed to rebuild the app independently of the VPS.
        settings = folder / 'settings'
        settings.mkdir(mode=0o700)
        files = json.loads(self.c['CONFIG_FILES_JSON'])
        for i, filename in enumerate(files):
            path = Path(filename)
            if not path.is_file():
                raise RuntimeError(f'Required settings file missing (entry {i})')
            shutil.copyfile(path, settings / f'{i:02d}-{path.name}')
        atomic_json(settings / 'paths.json', files)
        # client.env is a transient connection file, not part of the payload.
        payload = folder / 'payload.tar.gz'
        with tarfile.open(payload, 'w:gz') as tar:
            for name in ['database.dump', 'inventory.json', 'settings']:
                tar.add(folder / name, arcname=name)
        return payload, logical_bytes, info

    def queue_alert(self, title, body, dedupe_key):
        path = self.root / 'pending-alerts.json'
        pending = json.loads(path.read_text()) if path.exists() else []
        if not any(n['metadata']['dedupe_key'] == dedupe_key for n in pending):
            pending.append({'id': str(uuid.uuid4()), 'user_id': self.c['ALERT_USER_ID'],
                            'type': 'task_updated', 'reference_type': 'announcement',
                            'reference_id': self.c['ALERT_USER_ID'],
                            'created_at': dt.datetime.now(UTC).isoformat(),
                            'title': title, 'body': body,
                            'metadata': {'dedupe_key': dedupe_key, 'source': 'database_backup'}})
            atomic_json(path, pending)

    def alerts(self):
        path = self.root / 'pending-alerts.json'
        pending = json.loads(path.read_text()) if path.exists() else []
        left = []
        for notice in pending:
            # Repair notifications queued by the initial installer before the
            # required inbox reference was included. Only this job owns queue.
            notice.setdefault('reference_id', self.c['ALERT_USER_ID'])
            notice['reference_type'] = 'announcement'
            try:
                key = self.app['SUPABASE_SERVICE_ROLE_KEY']
                req = urllib.request.Request(self.app['SUPABASE_URL'] + '/rest/v1/notifications?on_conflict=id',
                        data=json.dumps(notice).encode(), method='POST',
                        headers={'apikey': key, 'Authorization': 'Bearer ' + key,
                                 'Content-Type': 'application/json', 'Prefer': 'resolution=ignore-duplicates'})
                with urllib.request.urlopen(req, timeout=15) as response:
                    response.read()
            except Exception:
                left.append(notice)
        atomic_json(path, left)
        # Browser push can still work when the Supabase database is unavailable.
        # Cache only the selected user's subscriptions in the root-only state dir.
        if left:
            cache = self.root / 'push-subscriptions.json'
            sent_file = self.root / 'push-alerted.json'
            sent = set(json.loads(sent_file.read_text())) if sent_file.exists() else set()
            notice = left[-1]
            if cache.exists() and notice['id'] not in sent:
                script = """let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',async()=>{try{
                const x=JSON.parse(s),w=require('web-push');w.setVapidDetails(process.env.WEB_PUSH_VAPID_SUBJECT||'mailto:support@squadhub.in',process.env.WEB_PUSH_VAPID_PUBLIC_KEY,process.env.WEB_PUSH_VAPID_PRIVATE_KEY);
                const r=await Promise.all(x.subscriptions.map(sub=>w.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},JSON.stringify({title:x.notice.title,body:x.notice.body,tag:x.notice.id,url:'/?open_inbox='+x.notice.id})).then(()=>1).catch(()=>0)));
                process.stdout.write(JSON.stringify({delivered:r.reduce((a,b)=>a+b,0)}))}catch{process.stdout.write('{"delivered":0}')} });"""
                try:
                    result = self.run(['docker', 'exec', '-i', 'squadhub-server', 'node', '-e', script],
                            stdin=json.dumps({'subscriptions': json.loads(cache.read_text()), 'notice': notice}).encode())
                    if json.loads(result)['delivered']:
                        sent.add(notice['id'])
                        atomic_json(sent_file, sorted(sent)[-1000:])
                except Exception:
                    pass  # Keep the inbox alert queued; do not create another failure.
        return len(left)

    def cache_push(self):
        try:
            key = self.app['SUPABASE_SERVICE_ROLE_KEY']
            req = urllib.request.Request(self.app['SUPABASE_URL'] + '/rest/v1/web_push_subscriptions?select=endpoint,p256dh,auth&user_id=eq.' + self.c['ALERT_USER_ID'],
                    headers={'apikey': key, 'Authorization': 'Bearer ' + key})
            with urllib.request.urlopen(req, timeout=15) as response:
                atomic_json(self.root / 'push-subscriptions.json', json.load(response))
        except Exception:
            pass  # Keep the previous cache if the database is unavailable.

    def prune(self, s3, now):
        bucket = self.app['R2_BUCKET_NAME']
        manifests = []
        for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=self.prefix):
            for item in page.get('Contents', []):
                if item['Key'].endswith('/manifest.json'):
                    m = json.loads(s3.get_object(Bucket=bucket, Key=item['Key'])['Body'].read())
                    expected = self.prefix + m['run_id'] + '/'
                    if m.get('verified') and item['Key'] == expected + 'manifest.json' and m['object_key'] == expected + 'backup.enc':
                        manifests.append(m)
        for m in retention_victims(manifests, now):
            s3.delete_objects(Bucket=bucket, Delete={'Objects': [{'Key': m['object_key']}, {'Key': self.prefix + m['run_id'] + '/manifest.json'}]})

    def backup(self):
        stamp = dt.datetime.now(UTC)
        run_id = stamp.strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex
        state = {'run_id': run_id, 'started_at': stamp.isoformat(), 'status': 'running'}
        atomic_json(self.root / 'status.json', state)
        self.cache_push()
        with tempfile.TemporaryDirectory(prefix='run-', dir=self.root) as temp:
            folder = Path(temp)
            with self.client_env(folder):
                payload, logical_bytes, info = self.bundle(folder)
            encrypted = self.root / (run_id + '.enc')
            encrypt_file(payload, encrypted, self.key)
            checksum = sha256(encrypted)
            s3 = self.s3()
            bucket = self.app['R2_BUCKET_NAME']
            object_key = self.prefix + run_id + '/backup.enc'
            log('uploading', encrypted_bytes=encrypted.stat().st_size, logical_data_bytes=logical_bytes)
            s3.upload_file(str(encrypted), bucket, object_key,
                           ExtraArgs={'ContentType': 'application/octet-stream', 'Metadata': {'sha256': checksum, 'encryption': 'AES-256-GCM'}})
            # A full download/decrypt/checksum round trip is required before this
            # run is considered successful or any retention deletion is allowed.
            downloaded = folder / 'downloaded.enc'
            s3.download_file(bucket, object_key, str(downloaded))
            if sha256(downloaded) != checksum:
                raise RuntimeError('Offsite checksum mismatch')
            restored_payload = folder / 'verified.tar.gz'
            with downloaded.open('rb') as inp, restored_payload.open('wb') as out:
                decrypt_stream(inp, out, self.key)
            if sha256(restored_payload) != sha256(payload):
                raise RuntimeError('Offsite decryption mismatch')
            manifest = {'run_id': run_id, 'created_at': stamp.isoformat(), 'object_key': object_key,
                        'sha256': checksum, 'encrypted_bytes': encrypted.stat().st_size,
                        'logical_data_bytes': logical_bytes, 'verified': True}
            s3.put_object(Bucket=bucket, Key=self.prefix + run_id + '/manifest.json',
                          Body=json.dumps(manifest).encode(), ContentType='application/json')
            atomic_json(self.root / (run_id + '.verified.json'), manifest)
            atomic_json(self.root / 'latest.json', manifest)
            state.update(status='success', finished_at=dt.datetime.now(UTC).isoformat(), **manifest)
            atomic_json(self.root / 'status.json', state)
            self.prune(s3, dt.datetime.now(UTC))
            # Only remove old *verified* local files after a new offsite success.
            for old_manifest in sorted(self.root.glob('*.verified.json'), reverse=True)[2:]:
                old = self.root / (old_manifest.name.removesuffix('.verified.json') + '.enc')
                old.unlink(missing_ok=True)
                old_manifest.unlink()
            log('complete', run_id=run_id, tables=len(info['tables']), logical_data_bytes=logical_bytes)
        self.alerts()
        return state

    def watchdog(self):
        self.alerts()
        path = self.root / 'status.json'
        state = json.loads(path.read_text()) if path.exists() else {}
        latest_path = self.root / 'latest.json'
        latest = json.loads(latest_path.read_text()) if latest_path.exists() else {}
        if latest:
            age = dt.datetime.now(UTC) - dt.datetime.fromisoformat(latest['created_at'])
        else:
            age = dt.timedelta(days=365)
        max_age = float(self.c.get('STALE_HOURS', '30'))
        if age > dt.timedelta(hours=max_age):
            day = dt.datetime.now(UTC).strftime('%Y-%m-%d')
            self.queue_alert('Database backup needs attention',
                             f'No verified database backup within {max_age:g} hours. Check the backup service on the server.',
                             'stale-' + day)
            self.alerts()
        return state


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['backup', 'watchdog', 'alert-test'])
    parser.add_argument('--config', default=DEFAULT_CONFIG)
    args = parser.parse_args()
    backup = Backup(args.config)
    with (backup.root / 'job.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log('already_running')
            return
        try:
            if args.command == 'backup':
                backup.backup()
            elif args.command == 'watchdog':
                backup.watchdog()
            else:
                backup.queue_alert('Database backup alerts are connected',
                                   'This is a test. Real backup failures will appear in this inbox.', 'setup-alert-test')
                if backup.alerts():
                    raise RuntimeError('Test alert has not reached the inbox')
                log('alert_test_delivered')
        except Exception as exc:
            if args.command != 'backup':
                log('failure', command=args.command, error_type=type(exc).__name__)
                raise SystemExit(1)
            # Retain the last successful manifest; record/alert this failure.
            path = backup.root / 'status.json'
            state = json.loads(path.read_text()) if path.exists() else {}
            state.update(status='failure', failed_at=dt.datetime.now(UTC).isoformat(), error_type=type(exc).__name__)
            atomic_json(path, state)
            backup.queue_alert('Database backup failed',
                               'The database backup did not finish. The last successful offsite backup is retained. Check the server backup service.',
                               'failure-' + state.get('run_id', str(uuid.uuid4())))
            with contextlib.suppress(Exception):
                backup.alerts()
            log('failure', error_type=type(exc).__name__)
            raise SystemExit(1)


if __name__ == '__main__':
    main()
