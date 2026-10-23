-- Per-user private "Personal" space that backs the "My Tasks" view and the
-- desktop quick-add hotkey. kind='personal' marks a space that is provisioned
-- per user, kept private to its creator, and HIDDEN from the normal Spaces
-- sidebar (GET /pm/spaces filters kind='personal' out). It is surfaced only via
-- the "My Tasks" module. kind='normal' is every existing/regular space.
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal', 'personal'));

-- Speeds up the get-or-create lookup ("does this user already have a personal space?").
CREATE INDEX IF NOT EXISTS idx_spaces_personal_owner ON spaces(created_by) WHERE kind = 'personal';
