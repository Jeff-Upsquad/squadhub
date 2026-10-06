-- ============================================================
-- 20261007030000_status_system_dependency.sql
-- Marks "waiting_on_dependency" as a system default status.
-- System statuses cannot be renamed, edited or deleted.
-- ============================================================

ALTER TABLE status_group_statuses
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

-- Ensure system default statuses have is_system = true
UPDATE status_group_statuses
SET is_system = TRUE, name = 'WAITING ON – DEPENDENCY'
WHERE key = 'waiting_on_dependency' OR name ILIKE '%waiting on%depend%';

UPDATE status_group_statuses
SET is_system = TRUE, name = 'UNBLOCKED'
WHERE key = 'unblocked' OR name ILIKE 'unblocked';

UPDATE status_group_statuses
SET is_system = TRUE, name = 'REMINDER'
WHERE key = 'reminder' OR name ILIKE 'reminder';

UPDATE status_group_statuses
SET is_system = TRUE
WHERE key = 'closed' OR name ILIKE 'closed';

UPDATE status_group_statuses
SET is_system = TRUE
WHERE key = 'cancelled' OR name ILIKE 'cancelled';


