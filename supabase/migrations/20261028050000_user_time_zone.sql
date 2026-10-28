-- Per-user IANA timezone (e.g. 'Asia/Kolkata'), captured from the client's
-- X-Time-Zone header via the auth middleware. Used by background jobs that
-- need a day boundary in the USER'S local time (time-block auto-completion).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS time_zone text;
