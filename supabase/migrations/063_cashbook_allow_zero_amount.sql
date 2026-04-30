-- Allow zero-amount cash book entries so the bulk receipt scan flow can
-- save photo-only drafts that the user fills in later via the regular
-- edit screen. Tightening from `> 0` to `>= 0` keeps the guarantee that
-- amounts are never negative (still a valid invariant) while permitting
-- placeholder entries with just an attached image.

ALTER TABLE cash_book_entries DROP CONSTRAINT IF EXISTS cash_book_entries_amount_check;
ALTER TABLE cash_book_entries ADD CONSTRAINT cash_book_entries_amount_check CHECK (amount >= 0);

ALTER TABLE check_entries DROP CONSTRAINT IF EXISTS check_entries_amount_check;
ALTER TABLE check_entries ADD CONSTRAINT check_entries_amount_check CHECK (amount >= 0);

ALTER TABLE cashbook_expense_entries DROP CONSTRAINT IF EXISTS cashbook_expense_entries_amount_check;
ALTER TABLE cashbook_expense_entries ADD CONSTRAINT cashbook_expense_entries_amount_check CHECK (amount >= 0);
