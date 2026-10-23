-- ============================================================
-- Squad Bots — one control room for every AI bot
--
-- SquadHub admin manages every Squad Bot: its on/off status, its AI provider
-- and model, and its Knowledge Center. The bots themselves run in their home
-- apps (SquadHire, Squad CRM, …) and read their settings from SquadHub.
--
-- Each bot has an internal name (what the team calls it, e.g. "Squad Hiring
-- Bot") and a public name (what customers/talents see — "Squad Bot" for all
-- of them today).
--
-- AI providers are shared: one is the default for every bot, and any bot can
-- pick another provider and model. API keys never live in the database — a
-- provider row only names the environment variable that holds its key.
-- ============================================================

CREATE TABLE ai_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- 'anthropic' = Claude API; 'openai_compatible' = any /chat/completions API
  -- (OpenAI, OpenRouter, Groq, Together, a self-hosted Ollama/vLLM, …).
  kind TEXT NOT NULL CHECK (kind IN ('anthropic', 'openai_compatible')),
  base_url TEXT,
  api_key_env TEXT,
  default_model TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one default provider.
CREATE UNIQUE INDEX ai_providers_one_default ON ai_providers (is_default) WHERE is_default;

CREATE TABLE squad_bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  internal_name TEXT NOT NULL,
  public_name TEXT NOT NULL DEFAULT 'Squad Bot',
  description TEXT NOT NULL DEFAULT '',
  -- Where the bot lives. 'squadhire' bots get their knowledge pushed to
  -- SquadHire (the existing Knowledge Center sync); others pull it.
  home_app TEXT NOT NULL DEFAULT 'other' CHECK (home_app IN ('squadhire', 'squad_crm', 'other')),
  -- off: does nothing · practice: works but sends nothing (logs only)
  -- approval: drafts replies for a person to approve · live: works on its own
  status TEXT NOT NULL DEFAULT 'off' CHECK (status IN ('off', 'practice', 'approval', 'live')),
  -- NULL provider = use the default provider; NULL model = the provider's default model.
  provider_id UUID REFERENCES ai_providers(id) ON DELETE SET NULL,
  model TEXT,
  instructions TEXT NOT NULL DEFAULT '',
  max_tokens INTEGER NOT NULL DEFAULT 16000 CHECK (max_tokens BETWEEN 1 AND 64000),
  -- Per-bot key the home app uses to talk to SquadHub. Only a hash is kept;
  -- the key itself is shown once when generated.
  api_key_hash TEXT,
  api_key_prefix TEXT,
  api_key_created_at TIMESTAMPTZ,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX squad_bots_api_key_hash ON squad_bots (api_key_hash) WHERE api_key_hash IS NOT NULL;

-- Single-row switchboard: the emergency stop that pauses every bot at once.
CREATE TABLE squad_bot_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  all_paused BOOLEAN NOT NULL DEFAULT false,
  paused_at TIMESTAMPTZ,
  paused_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per AI call made through SquadHub, for usage and troubleshooting.
CREATE TABLE squad_bot_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES squad_bots(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'admin_test')),
  bot_status TEXT NOT NULL,
  provider_slug TEXT,
  model TEXT,
  ok BOOLEAN NOT NULL,
  error TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX squad_bot_runs_bot_time ON squad_bot_runs (bot_id, created_at DESC);

CREATE TRIGGER ai_providers_updated_at BEFORE UPDATE ON ai_providers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER squad_bots_updated_at BEFORE UPDATE ON squad_bots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER squad_bot_settings_updated_at BEFORE UPDATE ON squad_bot_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Knowledge belongs to a bot. Existing knowledge is the Squad Hiring Bot's.
ALTER TABLE lms_items
  ADD COLUMN IF NOT EXISTS bot_id UUID REFERENCES squad_bots(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS lms_items_bot_id ON lms_items (bot_id) WHERE bot_id IS NOT NULL;
COMMENT ON COLUMN lms_items.bot_id IS 'Knowledge track only: the Squad Bot this knowledge is for.';

-- ------------------------------------------------------------
-- Seed: Claude as the default provider, an open-source example (off until
-- configured), and the first two bots.
-- ------------------------------------------------------------
INSERT INTO ai_providers (slug, name, kind, base_url, api_key_env, default_model, is_enabled, is_default) VALUES
  ('claude', 'Claude (Anthropic)', 'anthropic', NULL, 'ANTHROPIC_API_KEY', 'claude-opus-5', true, true),
  ('openrouter', 'OpenRouter (open-source models)', 'openai_compatible', 'https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY', NULL, false, false);

INSERT INTO squad_bot_settings (id) VALUES (true);

INSERT INTO squad_bots (slug, internal_name, public_name, description, home_app, status, sort_order) VALUES
  ('squad-hiring-bot', 'Squad Hiring Bot', 'Squad Bot',
   'Talks with candidates and talents in SquadHire.', 'squadhire', 'live', 1),
  ('squad-customer-bot', 'Squad Customer Bot', 'Squad Bot',
   'Manages customer leads in Squad CRM.', 'squad_crm', 'off', 2);

UPDATE lms_items
SET bot_id = (SELECT id FROM squad_bots WHERE slug = 'squad-hiring-bot')
WHERE track = 'knowledge' AND bot_id IS NULL;

-- Server-only tables: no Data API access for user roles; RLS as a backstop.
ALTER TABLE ai_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE squad_bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE squad_bot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE squad_bot_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.ai_providers, public.squad_bots, public.squad_bot_settings, public.squad_bot_runs
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.ai_providers, public.squad_bots, public.squad_bot_settings, public.squad_bot_runs
TO service_role;

NOTIFY pgrst, 'reload schema';
