-- ============================================================
-- 016: Task metadata JSONB
-- Stores design-request extras (format, audience, tone, references, attachments)
-- ============================================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
