# VPS trial results — 16 November 2026

Branch: `codex/postgres-auth-replacement`. Production was not switched.

## Implemented and running privately

- Vanilla PostgreSQL 17.9, PostgREST 14.5, local identity, and Caddy gateway.
- Existing SquadHub server image with the compiled local-identity changes,
  isolated on the private trial network with crons disabled.
- Gateway bound only to `127.0.0.1:55400`. PostgreSQL has no host port.
- Trial files: `/opt/squadhub-postgres-rehearsal` on the VPS.
- Account creation: administrator/invitation only, per the user's decision.
- Existing password hashes, account IDs, RLS policies and application data kept.
- Production DB settings, DNS, routing, images and backup timers left in place.

## Verified

- Imported **395 tables / 197,714 rows** from the existing verified R2 backup.
  Every imported row digest matched. Empty Vault objects were explicitly omitted;
  a nonempty Vault would stop the importer.
- All **39 auth accounts** use compatible bcrypt password hashes.
- A new local-database Cloudflare R2 backup and isolated plain-PostgreSQL restore
  verified **398 tables**, including local sessions, tickets and rate limits.
- **463 existing/new server tests passed**, plus **14 identity tests** on real
  PostgreSQL. TypeScript checks passed. Backup/config tests passed (one optional
  pre-existing PostgreSQL transport test skips without its test environment).
- The new identity runtime dependency audit reported zero known vulnerabilities.
- Server validation used the checked-in Squad Bots revision
  `afce51de4249094f86d70e41cb1ce572cdd68475`; the sibling working checkout was not
  changed to make tests pass.

The real app smoke test covered password login, profile lookup, notifications,
unread counts, active timer lookup, database RPCs, embedded relationships,
profile access restrictions, password changes with caller-session continuity,
and logout revocation. It also verified:

- Public signup and uninvited Hub registration are rejected.
- A confirmed shared identity without a Hub profile cannot log into Hub.
- An accepted Hub invitation creates an active profile and working login.
- CRM-style admin invitation links work through the Hub proxy, allow SDK password
  setup, reject arbitrary redirects and cannot be redeemed twice.
- Synthetic test accounts and invitations are removed afterward; 39 original
  auth accounts remain and no probe accounts remain.

## Capacity sample

A small test of **100 protected requests at 10 concurrent clients** completed
without failures in **2.44 seconds**, with **456 ms p95 latency**. This is a
limited smoke/load sample, not a production capacity guarantee.

An idle sample of the DB, identity, REST, gateway and trial app used about
**360 MiB** together. The VPS still had about **4 GiB available memory** and
**21 GiB free disk** after installing the trial.

## Before release

This is a working isolated implementation, not a completed production cutover.
Browser/mobile acceptance and shared-app configuration still need verification.
Browser clients that call the SDK directly need a reviewed HTTPS auth/data
endpoint, exact allowed origins, and updated public URL/key settings. The trial
does not expose those endpoints publicly.

Use a fresh, write-frozen final snapshot; the trial started from an older backup.
Coordinate every shared-DB writer, configure the real invitation callback URLs,
review migration tooling / target identity and backup scheduling, and define
rollback/data reconciliation before accepting production writes. See README.
