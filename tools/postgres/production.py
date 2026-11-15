"""Explicit local-PostgreSQL production target and selected-migration runner."""
import json
from pathlib import Path
import re
import subprocess
import uuid


def target_configuration(repo):
    target = json.loads((repo / 'supabase/production-target.json').read_text())
    if (target.get('kind') != 'postgres' or target.get('project_ref') != 'squadhub-local'
            or target.get('ssh_host') != 'root@72.61.245.97'
            or target.get('container') != 'squadhub-local-data-db-1'
            or target.get('compose_project') != 'squadhub-local-data'
            or not re.fullmatch(r'squadhub_trial_[0-9]{8}_[a-f0-9]{8}', target.get('database', ''))):
        raise ValueError('Checked-in PostgreSQL production target is invalid')
    uuid.UUID(target['deployment_id'])
    return target


def execute(repo, target, query):
    payload = {'target': target, 'query': query}
    # No database passwords are copied to this machine or passed in arguments.
    # SSH uses the existing verified host key. SQL travels over stdin only.
    script = """import json,subprocess
payload=json.loads(PAYLOAD)
t=payload['target']
d=json.loads(subprocess.check_output(['docker','inspect',t['container']]))[0]
labels=d['Config'].get('Labels') or {}
assert labels.get('com.docker.compose.project')==t['compose_project'] and labels.get('com.docker.compose.service')=='db','Unexpected container identity'
assert not d['HostConfig'].get('PortBindings'),'Database must not have host ports'
for network in d['NetworkSettings']['Networks']:
 assert json.loads(subprocess.check_output(['docker','network','inspect',network]))[0]['Internal'],'Database must be internal-only'
cmd=['docker','exec','-i',t['container'],'psql','-U','postgres','-d',t['database'],'-XqAt','-v','ON_ERROR_STOP=1']
guard=subprocess.run(cmd,input=b'BEGIN READ ONLY; SELECT row_to_json(t) FROM hub_identity.deployment_identity t; ROLLBACK;',capture_output=True,check=True)
identity=json.loads(guard.stdout.decode().strip())
assert identity['deployment_id']==t['deployment_id'] and identity['project_ref']==t['project_ref'],'Deployment marker differs from checked-in target'
r=subprocess.run(cmd,input=payload['query'].encode(),capture_output=True)
if r.returncode:
 raise RuntimeError('Verified PostgreSQL operation failed; production migration was rolled back')
print(r.stdout.decode(),end='')
""".replace('PAYLOAD', repr(json.dumps(payload)))
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', target['ssh_host'], 'python3', '-'],
                            input=script, capture_output=True, text=True, timeout=300)
    if result.returncode:
        raise ValueError('PostgreSQL target verification/operation failed; no fallback database was used.')
    return result.stdout.strip()


def run(repo, command, version=None):
    target = target_configuration(repo)
    if command == 'status':
        if version:
            raise ValueError('Status does not accept a migration selection')
        data = json.loads(execute(repo, target, """BEGIN READ ONLY;
SELECT json_build_object('database',current_database(),'read_only',current_setting('transaction_read_only'),
  'migration_count',count(*),'latest_migration',max(version),
  'ledger_digest',md5(string_agg(version || ':' || coalesce(name,''),',' ORDER BY version)))
FROM supabase_migrations.schema_migrations; ROLLBACK;"""))
        print(json.dumps({'kind': 'postgres', 'project_ref': target['project_ref'], 'deployment_id': target['deployment_id'], **data}))
        return
    if not version or not re.fullmatch(r'\d{14}', version):
        raise ValueError('PostgreSQL dry-run/apply requires one exact --migration version; bulk replay is disabled')
    files = list((repo / 'supabase/migrations').glob(version + '_*.sql'))
    if len(files) != 1:
        raise ValueError('Expected exactly one selected local migration file')
    file = files[0]
    sql = file.read_text()
    name = file.stem[len(version) + 1:]
    if not sql.strip() or not re.fullmatch(r'[a-zA-Z0-9_]+', name) or any(x in sql for x in ('$migration_sql$', '$migration_runner$')):
        raise ValueError('Invalid selected migration')
    if command == 'dry-run':
        ledger = execute(repo, target, f"BEGIN READ ONLY; SELECT version FROM supabase_migrations.schema_migrations WHERE version='{version}'; ROLLBACK;")
        print('Selected migration: ' + file.name + '\nLedger: ' + ('already applied' if ledger else 'pending') + '\nReviewed SQL:\n' + sql)
        return
    if command != 'apply':
        raise ValueError('Unknown production operation')
    query = f"""BEGIN;
SET LOCAL lock_timeout='10s';
SELECT pg_advisory_xact_lock(hashtext('squadhub-selected-migration'));
DO $migration_runner$ BEGIN
IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='{version}') THEN
 RAISE EXCEPTION 'Selected migration is already applied';
END IF;
EXECUTE $migration_sql${sql}$migration_sql$;
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES('{version}','{name}',ARRAY[$migration_sql${sql}$migration_sql$]);
END $migration_runner$;
COMMIT;"""
    execute(repo, target, query)
    print('Applied and recorded only ' + file.name)
