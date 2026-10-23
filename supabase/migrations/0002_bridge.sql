-- ============================================================================
-- Squad Hub SaaS — Hub bridge (0002)
-- ============================================================================
-- Server-side state for the Squad Hub ⇄ SaaS bridge (docs/bridge-contract.md):
--
--   login_tokens            one-time login links (super-admin impersonation,
--                           "Sign in with Squad Hub" staff SSO). Only the
--                           SHA-256 of the token is stored; a link is valid for
--                           10 minutes and can be used once. The Supabase
--                           session it minted is remembered (session_id) so the
--                           web app can show a visible banner for the whole
--                           impersonated session.
--   bridge_support_tickets  which SaaS user/account raised a Hub support ticket
--                           (the ticket itself lives on the Hub), so an agent
--                           reply (POST /bridge/v1/support/notify) lands in the
--                           right account's inbox.
--   workspaces              suspension reason + engagement status of shared
--                           workspaces (card paused / closed on the Hub).
--
-- Grants: service_role only (the SaaS server is the only database client).
-- ============================================================================
SET search_path = public, extensions;

-- ------------------------------------------------------------ workspaces
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS suspended_reason text,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  -- shared workspaces only: mirrors the Hub card lifecycle
  ADD COLUMN IF NOT EXISTS engagement_status text NOT NULL DEFAULT 'active'
    CHECK (engagement_status IN ('active', 'paused', 'closed'));

-- A card is linked to at most one shared workspace per participant account.
CREATE INDEX IF NOT EXISTS idx_swl_card_role
  ON public.shared_workspace_links (hub_card_id, participant_role)
  WHERE hub_card_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_email_lower ON public.users (lower(email));

-- ------------------------------------------------------------ login_tokens
CREATE TABLE public.login_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- hex SHA-256 of the raw token; the raw token only ever lives in the URL
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('impersonate', 'staff_sso')),
  -- land the user on this workspace after sign-in (optional)
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  actor_hub_user_id uuid,
  actor_email text,
  reason text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  -- Supabase auth session minted when the link was used (JWT `session_id`)
  session_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (purpose <> 'impersonate' OR reason IS NOT NULL)
);
CREATE INDEX idx_login_tokens_user ON public.login_tokens (user_id, created_at DESC);
CREATE INDEX idx_login_tokens_session ON public.login_tokens (session_id) WHERE session_id IS NOT NULL;

-- ------------------------------------------------------------ support refs
CREATE TABLE public.bridge_support_tickets (
  ticket_id uuid NOT NULL PRIMARY KEY,           -- Hub support_tickets.id
  ticket_number integer,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  subject text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bridge_support_tickets_user ON public.bridge_support_tickets (user_id, workspace_id);

-- ------------------------------------------------------------ security
ALTER TABLE public.login_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bridge_support_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_tokens, public.bridge_support_tickets FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.login_tokens, public.bridge_support_tickets TO service_role;
