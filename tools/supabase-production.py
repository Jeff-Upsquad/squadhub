#!/usr/bin/env python3
"""Use this repo's explicit production database; never infer it from CLI login."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import quote, urlencode, urlsplit


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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['status', 'dry-run', 'apply'])
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    try:
        ref, url = configuration(repo)
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
