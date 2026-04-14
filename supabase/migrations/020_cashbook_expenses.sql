-- Cashbook Expense Entries table
CREATE TABLE cashbook_expense_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  local_id TEXT,
  entry_type VARCHAR NOT NULL CHECK (entry_type IN ('expense_out', 'expense_in')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  entry_date DATE NOT NULL,
  nature_of_expense TEXT,
  description TEXT,
  category_id UUID REFERENCES cash_book_categories(id) ON DELETE SET NULL,
  payment_mode VARCHAR NOT NULL DEFAULT 'cash' CHECK (payment_mode IN ('cash', 'upi', 'bank_transfer', 'cheque', 'other')),
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

-- Indexes
CREATE INDEX idx_expense_entries_client_date ON cashbook_expense_entries (client_id, entry_date);
CREATE INDEX idx_expense_entries_user ON cashbook_expense_entries (user_id);
CREATE INDEX idx_expense_entries_local ON cashbook_expense_entries (local_id) WHERE local_id IS NOT NULL;
CREATE INDEX idx_expense_entries_posted ON cashbook_expense_entries (client_id, is_posted);
CREATE INDEX idx_expense_entries_sync ON cashbook_expense_entries (client_id, server_updated_at);
CREATE INDEX idx_expense_entries_not_deleted ON cashbook_expense_entries (client_id, entry_date) WHERE is_deleted = false;

-- Row Level Security
ALTER TABLE cashbook_expense_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view expense entries for their clients"
  ON cashbook_expense_entries FOR SELECT
  USING (client_id IN (
    SELECT client_id FROM cash_book_users
    WHERE user_id = auth.uid() AND is_active = true
  ));

CREATE POLICY "Users can insert expense entries for their clients"
  ON cashbook_expense_entries FOR INSERT
  WITH CHECK (client_id IN (
    SELECT client_id FROM cash_book_users
    WHERE user_id = auth.uid() AND is_active = true
  ));

CREATE POLICY "Users can update expense entries for their clients"
  ON cashbook_expense_entries FOR UPDATE
  USING (client_id IN (
    SELECT client_id FROM cash_book_users
    WHERE user_id = auth.uid() AND is_active = true
  ));

-- Update audit table to accept expense entries
ALTER TABLE cash_book_entry_audit DROP CONSTRAINT IF EXISTS cash_book_entry_audit_entry_table_check;
ALTER TABLE cash_book_entry_audit ADD CONSTRAINT cash_book_entry_audit_entry_table_check
  CHECK (entry_table IN ('cash_book_entries', 'check_entries', 'cashbook_expense_entries'));
