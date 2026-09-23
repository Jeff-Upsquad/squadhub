# Migration instructions

- Every migration that creates a table in `public` must include explicit Data
  API grants in the same migration.
- For server-only tables, explicitly revoke all privileges from `anon` and
  `authenticated`, then grant only the required access to `service_role`.
- Grant `authenticated` or `anon` only when the table is intentionally accessed
  through a user-scoped or public Data API client, and keep RLS enabled with
  appropriate policies.
- Grant the required sequence permissions when using serial or identity values.
- Do not restore automatic/default privileges for future objects.
- Follow the examples in `README.md`.
