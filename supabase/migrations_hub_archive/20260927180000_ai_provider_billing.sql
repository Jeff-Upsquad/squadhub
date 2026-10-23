-- Billing credentials stay in server environment variables. Manual USD figures
-- are dated snapshots, never inferred from token counts or treated as live.
ALTER TABLE public.ai_providers
  ADD COLUMN billing_settings JSONB NOT NULL DEFAULT '{"mode":"unknown","key_env":null,"manual":null}'::jsonb;
COMMENT ON COLUMN public.ai_providers.billing_settings IS
  'Admin-only billing preferences, key variable name, and optional dated manual USD snapshot.';
NOTIFY pgrst, 'reload schema';
