#!/usr/bin/env python3
"""Use this repo's explicit production database; never infer it from CLI login."""
import argparse
import json
import os
import re
from pathlib import Path
import subprocess
import sys
from urllib.parse import quote, urlencode, urlsplit, unquote, parse_qs


def configuration(repo):
    target = json.loads((repo / 'supabase/production-target.json').read_text())
    common = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', '--git-common-dir'], text=True).strip()
    primary = (repo / common).resolve().parent
    locations = [repo / 'supabase/.env', primary / 'supabase/.env']
    credentials = next((p for p in locations if p.is_file()), None)
    if credentials is None:
        raise ValueError('Missing private supabase/.env; configure the current production database before continuing.')
    values = {}
    for line in credentials.read_text().splitlines():
        if line.strip() and not line.lstrip().startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    ref = target['project_ref']
    if values.get('PROJECT_REF') != ref:
        raise ValueError('Credential project differs from supabase/production-target.json.')
    host, user = values['PGHOST'], values['PGUSER']
    direct = host == 'db.' + ref + '.supabase.co' and user == 'postgres'
    pooler = host.endswith('.pooler.supabase.com') and user == 'postgres.' + ref
    if not (direct or pooler) or values.get('PGSSLMODE') != 'verify-full':
        raise ValueError('Production database host/user or TLS verification is incorrect.')
    if values['PGDATABASE'] != 'postgres' or values['PGPORT'] != '5432':
        raise ValueError('Use the production database with its direct/session connection on port 5432.')
    linked = repo / 'supabase/.temp/project-ref'
    if linked.exists() and linked.read_text().strip() != ref:
        raise ValueError('Stale Supabase CLI link; correct it before continuing.')
    cert = credentials.parent / '.ca.crt'
    if not cert.is_file():
        raise ValueError('Missing supabase/.ca.crt for TLS server verification.')
    query = urlencode({'sslmode': 'verify-full', 'sslrootcert': str(cert.resolve())})
    url = 'postgresql://' + quote(user, safe='') + ':' + quote(values['PGPASSWORD'], safe='') + '@' + host + ':5432/postgres?' + query
    return ref, url


def source_backup_status(repo, credentials):
    """Verify the hosted source using its existing read-only backup identity.

    This mode cannot execute migrations. It exists for a reviewed migration off
    hosted Supabase when no administrator password is installed on this machine.
    TLS, project identity and the dedicated read-only role are still mandatory.
    """
    target = json.loads((repo / 'supabase/production-target.json').read_text())
    ref = target.get('source_project_ref') if target.get('kind') == 'postgres' else target['project_ref']
    values = {}
    for line in credentials.read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    if (values.get('PROJECT_REF') != ref or values.get('PGHOST') != 'db.' + ref + '.supabase.co'
            or values.get('PGUSER') != 'squadhub_backup_v1' or values.get('PGSSLMODE') != 'verify-full'
            or values.get('PGDATABASE') != 'postgres' or values.get('PGPORT') != '5432'
            or not Path(values.get('PGSSLROOTCERT', '/missing')).is_file()):
        raise ValueError('Source backup credentials do not match the checked-in project and verified TLS target.')
    env = {**os.environ, **{k: values[k] for k in ('PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE', 'PGSSLROOTCERT')}}
    query = """BEGIN READ ONLY;
SELECT json_build_object('database',current_database(),'read_only',current_setting('transaction_read_only'),
  'migration_count',count(*),'latest_migration',max(version),
  'ledger_digest',md5(string_agg(version || ':' || coalesce(name,''),',' ORDER BY version)))
FROM supabase_migrations.schema_migrations;
ROLLBACK;"""
    result = subprocess.run(['psql', '-XqAt', '-v', 'ON_ERROR_STOP=1'], input=query, env=env,
                            capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise ValueError('Verified read-only source status failed; no migration was attempted.')
    data = json.loads(result.stdout.strip())
    if data['read_only'] != 'on' or data['database'] != 'postgres':
        raise ValueError('Source status did not run in a read-only transaction.')
    print(json.dumps({'production_source_project': ref, 'verified_tls': True, **data}))


def selected_migration(repo, url, version, apply):
    """Apply one reviewed migration when a shared ledger prevents a bulk push."""
    if not re.fullmatch(r'\d{14}', version):
        raise ValueError('A selected migration must use its exact 14-digit version.')
    matches = list((repo / 'supabase/migrations').glob(version + '_*.sql'))
    if len(matches) != 1:
        raise ValueError('Expected exactly one local SQL file for the selected version.')
    migration = matches[0]
    sql = migration.read_text()
    name = migration.stem[len(version) + 1:]
    if not sql.strip() or any(tag in sql for tag in ('$migration_sql$', '$migration_runner$')):
        raise ValueError('Migration is empty or contains a reserved SQL delimiter.')
    if not re.fullmatch(r'[a-zA-Z0-9_]+', name):
        raise ValueError('Migration filename must use letters, numbers and underscores.')
    if apply:
        query = f"""BEGIN;
SET LOCAL lock_timeout = '10s';
SELECT pg_advisory_xact_lock(hashtext('squadhub-selected-migration'));
DO $migration_runner$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '{version}') THEN
    EXECUTE $migration_sql${sql}$migration_sql$;
    INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
      VALUES ('{version}', '{name}', ARRAY[$migration_sql${sql}$migration_sql$]);
  ELSE
    RAISE EXCEPTION 'Selected migration is already recorded; inspect its schema before retrying';
  END IF;
END $migration_runner$;
COMMIT;
"""
    else:
        query = f"SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '{version}';"
    # Keep the verified connection string out of process arguments and output.
    connection = urlsplit(url)
    parameters = parse_qs(connection.query)
    connection_env = {**os.environ, 'PGHOST': connection.hostname, 'PGPORT': str(connection.port),
                      'PGUSER': unquote(connection.username), 'PGPASSWORD': unquote(connection.password),
                      'PGDATABASE': connection.path.lstrip('/'), 'PGSSLMODE': 'verify-full',
                      'PGSSLROOTCERT': parameters['sslrootcert'][0]}
    result = subprocess.run(
        ['psql', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--no-align', '--tuples-only'],
        input=query, env=connection_env, capture_output=True, text=True, timeout=120,
    )
    if result.returncode:
        raise ValueError('Selected migration command failed (exit ' + str(result.returncode) +
                         '); no transaction was committed. Connection details were not logged.')
    if apply:
        print('Applied and recorded only ' + migration.name)
    else:
        print('Selected migration: ' + migration.name)
        print('Ledger: ' + ('already applied' if result.stdout.strip() else 'pending'))
        print('No other migrations will be applied. Reviewed SQL:\n' + sql)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['status', 'dry-run', 'apply'])
    parser.add_argument('--migration', help='Exact 14-digit version; limit dry-run/apply to one reviewed migration.')
    parser.add_argument('--repo', type=Path, help='Explicit repository path when running this read-only helper from a temporary location.')
    parser.add_argument('--source-backup-config', type=Path, help='Status only: verify the hosted source with its dedicated read-only backup credentials.')
    args = parser.parse_args()
    repo = args.repo.resolve() if args.repo else Path(__file__).resolve().parent.parent
    try:
        if args.source_backup_config:
            if args.command != 'status' or args.migration:
                raise ValueError('Backup credentials can only perform read-only source status.')
            source_backup_status(repo, args.source_backup_config)
            return 0
        target = json.loads((repo / 'supabase/production-target.json').read_text())
        if target.get('kind') == 'postgres':
            sys.path.insert(0, str(repo / 'tools/postgres'))
            import production as postgres_production
            postgres_production.run(repo, args.command, args.migration)
            return 0
        ref, url = configuration(repo)
        if args.migration:
            if args.command == 'status':
                raise ValueError('--migration is only supported for dry-run and apply.')
            print('Production target: ' + ref + ' (' + args.command + ', selected migration)', flush=True)
            selected_migration(repo, url, args.migration, args.command == 'apply')
            return 0
        command = ['migration', 'list'] if args.command == 'status' else ['db', 'push']
        if args.command == 'dry-run':
            command += ['--dry-run']
        print('Production target: ' + ref + ' (' + args.command + ')', flush=True)
        # Database URL is explicit: no access token or expired migration PAT is required.
        result = subprocess.run(['supabase'] + command + ['--db-url', url, '--workdir', str(repo)], capture_output=True, text=True, timeout=900)
        if result.returncode:
            logs = repo / 'supabase/.temp'
            logs.mkdir(parents=True, exist_ok=True)
            private = logs / 'production-cli-error.log'
            private.write_text((result.stdout + result.stderr).replace(url, '[private connection]').replace(urlsplit(url).password or '', '[private password]'))
            private.chmod(0o600)
            raise ValueError('Supabase command failed; inspect the private supabase/.temp/production-cli-error.log. No fallback project was used.')
        print(result.stdout, end='')
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
