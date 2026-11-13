-- ============================================================
-- Squad Hub ⇄ Squad Hub SaaS bridge (app.squadhub.in) — Hub side.
--
-- The SaaS is a separate repo + separate Supabase project. Each system owns
-- its own data; the tables below only hold identity mappings and the one piece
-- of SaaS-originated data the Hub must aggregate (daily time totals). All are
-- server-only (service_role); browsers never touch them.
--
--   support_external_requesters  SaaS users who raise support tickets over the
--                                bridge. NOT Hub user accounts — a lightweight
--                                requester record keyed by the SaaS user id.
--   support_tickets.external_requester_id
--                                marks a ticket as bridge-created so agent
--                                replies notify the SaaS (POST /support/notify).
--   saas_time_totals             idempotent per (date, card, partner) minutes
--                                pushed by the SaaS; folded into card hours
--                                completion next to tracked + elapsed time.
--   saas_account_links           Hub client / partner → SaaS account id, as
--                                returned by SaaS POST /bridge/v1/accounts.
--   saas_card_workspaces         Hub card → SaaS shared workspace id, as
--                                returned by SaaS POST /shared-workspaces/ensure
--                                (used for pause/resume/close/members-remove).
--
-- Also seeds ONE system user that stands in as the sender/creator of
-- bridge-created support tickets and messages (messages.sender_id and
-- support_tickets.created_by are NOT NULL FKs to users). It is suspended, has
-- no auth identity and no workspace membership, so it can never sign in; the
-- real requester is carried in support_external_requesters + message metadata.
-- ============================================================

-- ---- System requester proxy user ------------------------------------------
INSERT INTO public.users (id, email, display_name, user_type, status, is_admin)
VALUES (
  '5aa5b1d9-0000-4000-8000-000000000001'::uuid,  -- SAAS_REQUESTER_USER_ID in server/src/utils/saasSupport.ts
  'saas-requester@system.squadhub.in',
  'Squad Hub app user',
  'client',
  'suspended',
  false
)
ON CONFLICT DO NOTHING;

-- ---- External support requesters ------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_external_requesters (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  saas_user_id     text NOT NULL UNIQUE,
  saas_account_id  text,
  email            text,
  name             text,
  -- Set when the SaaS user maps to a real Hub user (migrated users / staff).
  hub_user_id      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_ext_req_account ON public.support_external_requesters(saas_account_id);

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS external_requester_id uuid
    REFERENCES public.support_external_requesters(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_support_tickets_ext_requester ON public.support_tickets(external_requester_id);

-- ---- SaaS daily time totals ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saas_time_totals (
  date                 date NOT NULL,           -- IST work date
  hub_card_id          uuid NOT NULL REFERENCES public.subscription_cards(id) ON DELETE CASCADE,
  hub_partner_user_id  uuid NOT NULL,
  minutes              integer NOT NULL CHECK (minutes >= 0),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, hub_card_id, hub_partner_user_id)
);
CREATE INDEX IF NOT EXISTS idx_saas_time_totals_card_date ON public.saas_time_totals(hub_card_id, date);
CREATE INDEX IF NOT EXISTS idx_saas_time_totals_partner_date ON public.saas_time_totals(hub_partner_user_id, date);

-- ---- SaaS account links -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saas_account_links (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                 text NOT NULL CHECK (kind IN ('business', 'talent')),
  hub_client_id        uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  hub_partner_user_id  uuid REFERENCES public.users(id) ON DELETE CASCADE,
  squadhire_talent_id  text,
  saas_account_id      text NOT NULL,
  owner_user_id        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'business' AND hub_client_id IS NOT NULL)
    OR (kind = 'talent' AND (hub_partner_user_id IS NOT NULL OR squadhire_talent_id IS NOT NULL))
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_saas_account_links_client
  ON public.saas_account_links(hub_client_id) WHERE kind = 'business';
CREATE UNIQUE INDEX IF NOT EXISTS uq_saas_account_links_partner
  ON public.saas_account_links(hub_partner_user_id) WHERE kind = 'talent' AND hub_partner_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_saas_account_links_talent
  ON public.saas_account_links(squadhire_talent_id) WHERE kind = 'talent' AND hub_partner_user_id IS NULL;

-- ---- SaaS shared workspace per card ----------------------------------------
CREATE TABLE IF NOT EXISTS public.saas_card_workspaces (
  hub_card_id               uuid PRIMARY KEY REFERENCES public.subscription_cards(id) ON DELETE CASCADE,
  shared_workspace_id       text NOT NULL,
  business_saas_account_id  text,
  status                    text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saas_card_workspaces_ws ON public.saas_card_workspaces(shared_workspace_id);

-- ---- Server-only access ------------------------------------------------------
ALTER TABLE public.support_external_requesters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_time_totals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_account_links          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_card_workspaces        ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.support_external_requesters FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.saas_time_totals            FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.saas_account_links          FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.saas_card_workspaces        FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.support_external_requesters TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.saas_time_totals            TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.saas_account_links          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.saas_card_workspaces        TO service_role;
