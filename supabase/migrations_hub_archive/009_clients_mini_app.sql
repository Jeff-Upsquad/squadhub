-- ============================================================
-- Clients Mini-App: Subscriptions, Client Onboarding, Client Management
-- ============================================================

-- Subscriptions (services the company offers)
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  squad TEXT NOT NULL CHECK (squad IN ('Content Squad', 'Accounts & Finance Squad', 'Marketing Squad', 'Tech Squad', 'Legal Squad', 'Hiring & HR Squad')),
  level TEXT NOT NULL CHECK (level IN ('Junior', 'Pro', 'Elite')),
  plan TEXT NOT NULL CHECK (plan IN ('Starter', 'Basic', 'Plus', 'Pro', 'Personal')),
  price INTEGER NOT NULL CHECK (price >= 0),
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Client onboarding submissions (from the public form)
CREATE TABLE IF NOT EXISTS client_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL,
  contact_person TEXT NOT NULL,
  designation TEXT,
  contact_number TEXT NOT NULL,
  email TEXT NOT NULL,
  business_address TEXT NOT NULL,
  gst_registered BOOLEAN NOT NULL DEFAULT false,
  gst_number TEXT,
  accounts_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Clients (approved from submissions)
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID REFERENCES client_submissions(id),
  business_name TEXT NOT NULL,
  contact_person TEXT NOT NULL,
  designation TEXT,
  contact_number TEXT NOT NULL,
  email TEXT NOT NULL,
  business_address TEXT NOT NULL,
  gst_registered BOOLEAN NOT NULL DEFAULT false,
  gst_number TEXT,
  accounts_email TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Client subscriptions (many-to-many with individual status)
CREATE TABLE IF NOT EXISTS client_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES subscriptions(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_subscriptions_client ON client_subscriptions(client_id);
CREATE INDEX idx_client_submissions_status ON client_submissions(status);
CREATE INDEX idx_clients_status ON clients(status);
