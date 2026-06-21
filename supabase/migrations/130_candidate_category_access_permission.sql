-- Candidate category access: add a permission tier (view / edit / full).
--
-- Previously a grant row was binary visibility ("can see this category"). We now
-- record what the grantee may DO within a category:
--   view → read-only
--   edit → read + change status, add/edit notes, mark interviews reviewed
--   full → everything, incl. delete / restore candidate and delete note
--
-- Existing rows default to 'full' so anyone already scoped keeps the read+write
-- ability they implicitly had before. The candidates proxy enforces the tier;
-- with no grant rows a (non-admin) user now has NO access (deny-by-default).
ALTER TABLE candidate_category_access
  ADD COLUMN IF NOT EXISTS permission TEXT NOT NULL DEFAULT 'full'
    CHECK (permission IN ('view', 'edit', 'full'));
