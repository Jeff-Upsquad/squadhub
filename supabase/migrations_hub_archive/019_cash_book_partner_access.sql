-- Cash Book Partner Access
-- Allows partners to view and manage Cash Book data for specific clients

CREATE TABLE cash_book_partner_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  enabled_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, client_id)
);

CREATE INDEX idx_cbpa_user_id ON cash_book_partner_access(user_id);
CREATE INDEX idx_cbpa_client_id ON cash_book_partner_access(client_id);
