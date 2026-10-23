-- Invitation system for pre-approved user signups
CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent duplicate pending invitations for the same email
CREATE UNIQUE INDEX idx_invitations_email_pending ON invitations (email) WHERE status = 'pending';

-- Index for lookup during signup
CREATE INDEX idx_invitations_email ON invitations (email);
CREATE INDEX idx_invitations_status ON invitations (status);
