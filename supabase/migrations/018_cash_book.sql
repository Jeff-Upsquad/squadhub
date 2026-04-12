-- ============================================================
-- Cash Book: Cash In/Out, Check Collection/Deposit, Audit Trail
-- ============================================================

-- Which clients have the cash book module enabled
CREATE TABLE IF NOT EXISTS cash_book_client_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  enabled_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id)
);
CREATE INDEX idx_cb_client_access_client ON cash_book_client_access(client_id);

-- Client staff with cash book roles
CREATE TABLE IF NOT EXISTS cash_book_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('client_admin', 'staff')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  invited_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, client_id)
);
CREATE INDEX idx_cb_users_client ON cash_book_users(client_id);
CREATE INDEX idx_cb_users_user ON cash_book_users(user_id);

-- Per-client account heads / categories
CREATE TABLE IF NOT EXISTS cash_book_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cash_in', 'cash_out', 'both')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, name)
);
CREATE INDEX idx_cb_categories_client ON cash_book_categories(client_id);

-- Core cash in/out transaction records
CREATE TABLE IF NOT EXISTS cash_book_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  local_id TEXT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('cash_in', 'cash_out')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  entry_date DATE NOT NULL,
  description TEXT,
  category_id UUID REFERENCES cash_book_categories(id) ON DELETE SET NULL,
  party_name TEXT,
  payment_mode TEXT NOT NULL DEFAULT 'cash' CHECK (payment_mode IN ('cash', 'upi', 'bank_transfer', 'cheque', 'other')),
  photo_url TEXT,
  photo_key TEXT,
  is_posted BOOLEAN NOT NULL DEFAULT false,
  posted_by UUID REFERENCES users(id),
  posted_at TIMESTAMPTZ,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cb_entries_client_date ON cash_book_entries(client_id, entry_date);
CREATE INDEX idx_cb_entries_user ON cash_book_entries(user_id);
CREATE INDEX idx_cb_entries_local ON cash_book_entries(local_id) WHERE local_id IS NOT NULL;
CREATE INDEX idx_cb_entries_posted ON cash_book_entries(client_id, is_posted);
CREATE INDEX idx_cb_entries_sync ON cash_book_entries(client_id, server_updated_at);
CREATE INDEX idx_cb_entries_not_deleted ON cash_book_entries(client_id, entry_date) WHERE is_deleted = false;

-- Check collection/deposit with status tracking
CREATE TABLE IF NOT EXISTS check_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  local_id TEXT,
  check_type TEXT NOT NULL CHECK (check_type IN ('collection', 'deposit')),
  check_number TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  check_date DATE NOT NULL,
  party_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'deposited', 'cleared', 'bounced')),
  deposit_date DATE,
  clearance_date DATE,
  bounce_reason TEXT,
  photo_url TEXT,
  photo_key TEXT,
  description TEXT,
  is_posted BOOLEAN NOT NULL DEFAULT false,
  posted_by UUID REFERENCES users(id),
  posted_at TIMESTAMPTZ,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_check_entries_client_date ON check_entries(client_id, check_date);
CREATE INDEX idx_check_entries_user ON check_entries(user_id);
CREATE INDEX idx_check_entries_local ON check_entries(local_id) WHERE local_id IS NOT NULL;
CREATE INDEX idx_check_entries_status ON check_entries(client_id, status);
CREATE INDEX idx_check_entries_sync ON check_entries(client_id, server_updated_at);

-- Audit trail for financial data
CREATE TABLE IF NOT EXISTS cash_book_entry_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL,
  entry_table TEXT NOT NULL CHECK (entry_table IN ('cash_book_entries', 'check_entries')),
  changed_by UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'post', 'unpost')),
  changes JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cb_audit_entry ON cash_book_entry_audit(entry_id);
CREATE INDEX idx_cb_audit_time ON cash_book_entry_audit(created_at);

-- Cached daily opening/closing balances
CREATE TABLE IF NOT EXISTS cash_book_daily_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  balance_date DATE NOT NULL,
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_cash_in NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_cash_out NUMERIC(14,2) NOT NULL DEFAULT 0,
  closing_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  last_computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, balance_date)
);
CREATE INDEX idx_cb_balances_client_date ON cash_book_daily_balances(client_id, balance_date);

-- Register as a mini app
INSERT INTO mini_apps (slug, name, description, icon, is_enabled)
VALUES ('cash-book', 'Cash Book', 'Cash transaction recording and check management for clients', 'banknotes', true)
ON CONFLICT DO NOTHING;

-- Enable RLS
ALTER TABLE cash_book_client_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_book_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_book_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_book_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_book_entry_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_book_daily_balances ENABLE ROW LEVEL SECURITY;

-- RLS policies for cash_book_entries
CREATE POLICY "cb_entries_select" ON cash_book_entries FOR SELECT
  USING (client_id IN (SELECT client_id FROM cash_book_users WHERE user_id = auth.uid() AND is_active = true));

CREATE POLICY "cb_entries_insert" ON cash_book_entries FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    client_id IN (SELECT client_id FROM cash_book_users WHERE user_id = auth.uid() AND is_active = true)
  );

CREATE POLICY "cb_entries_update" ON cash_book_entries FOR UPDATE
  USING (
    user_id = auth.uid() AND
    client_id IN (SELECT client_id FROM cash_book_users WHERE user_id = auth.uid() AND is_active = true)
  );

-- RLS policies for check_entries
CREATE POLICY "check_entries_select" ON check_entries FOR SELECT
  USING (client_id IN (SELECT client_id FROM cash_book_users WHERE user_id = auth.uid() AND is_active = true));

CREATE POLICY "check_entries_insert" ON check_entries FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    client_id IN (SELECT client_id FROM cash_book_users WHERE user_id = auth.uid() AND is_active = true)
  );

CREATE POLICY "check_entries_update" ON check_entries FOR UPDATE
  USING (
    user_id = auth.uid() AND
    client_id IN (SELECT client_id FROM cash_book_users WHERE user_id = auth.uid() AND is_active = true)
  );

-- RLS policies for categories (read by all client users, managed by client_admin)
CREATE POLICY "cb_categories_select" ON cash_book_categories FOR SELECT
  USING (client_id IN (SELECT client_id FROM cash_book_users WHERE user_id = auth.uid() AND is_active = true));

-- RLS policies for daily balances
CREATE POLICY "cb_balances_select" ON cash_book_daily_balances FOR SELECT
  USING (client_id IN (SELECT client_id FROM cash_book_users WHERE user_id = auth.uid() AND is_active = true));
