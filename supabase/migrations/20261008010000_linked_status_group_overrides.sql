-- Migration: Allow toggling statuses and replacing inherited statuses in linked status groups
ALTER TABLE public.status_groups
  ADD COLUMN IF NOT EXISTS disabled_status_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS status_replacements JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.status_groups
  ADD CONSTRAINT status_groups_disabled_keys_array CHECK (jsonb_typeof(disabled_status_keys) = 'array'),
  ADD CONSTRAINT status_groups_replacements_object CHECK (jsonb_typeof(status_replacements) = 'object');
