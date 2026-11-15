#!/bin/sh
set -eu
psql -U postgres -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  --set=authenticator_password="$LOCAL_AUTHENTICATOR_PASSWORD" \
  --set=identity_password="$LOCAL_IDENTITY_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE anon NOLOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') \gexec
SELECT 'CREATE ROLE authenticated NOLOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') \gexec
SELECT 'CREATE ROLE service_role NOLOGIN BYPASSRLS' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') \gexec
SELECT 'CREATE ROLE authenticator LOGIN NOINHERIT' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticator') \gexec
SELECT 'CREATE ROLE local_identity LOGIN NOINHERIT' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='local_identity') \gexec
ALTER ROLE authenticator PASSWORD :'authenticator_password';
ALTER ROLE local_identity PASSWORD :'identity_password';
GRANT anon, authenticated, service_role TO authenticator;
SQL
psql -U postgres -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f /opt/squadhub/bootstrap.sql
