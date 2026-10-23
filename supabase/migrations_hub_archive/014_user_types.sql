-- ============================================================
-- User Types: Internal, Client, Partner
-- Separates the user base into three distinct types
-- ============================================================

-- 1. Add user_type to users table (all existing users become 'internal')
ALTER TABLE users
  ADD COLUMN user_type TEXT NOT NULL DEFAULT 'internal'
  CHECK (user_type IN ('internal', 'client', 'partner'));

CREATE INDEX idx_users_user_type ON users(user_type);

-- 2. Add user_type and client_id to invitations table
ALTER TABLE invitations
  ADD COLUMN user_type TEXT NOT NULL DEFAULT 'internal'
  CHECK (user_type IN ('internal', 'client', 'partner'));

ALTER TABLE invitations
  ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX idx_invitations_user_type ON invitations(user_type);

-- 3. Partner-client assignment table (many-to-many)
CREATE TABLE IF NOT EXISTS partner_client_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  role TEXT,  -- e.g. 'designer', 'editor', 'accountant'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, client_id)
);

CREATE INDEX idx_partner_assignments_user ON partner_client_assignments(user_id);
CREATE INDEX idx_partner_assignments_client ON partner_client_assignments(client_id);
