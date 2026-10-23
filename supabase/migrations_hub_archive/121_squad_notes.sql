-- ============================================================
-- 121: SquadNotes — Notion-style nested notes / docs
--
-- One row per page. `content` is an app-owned Tiptap JSON doc stored
-- opaquely (shape owned by the editor). Pages nest via `parent_id`;
-- `root_id` (trigger-maintained) denormalizes the top of each tree so
-- "what can I see" and share-inheritance are a single indexed lookup.
--
-- Sharing lives on the ROOT page (squad_note_shares, polymorphic over
-- user / role / department) and is inherited by descendants. Access is
-- validated server-side with the service role + getNoteAccess(); RLS is
-- enabled with no policies, matching the rest of the codebase.
--
-- Gated as the 'squad-notes' mini app (row inserted below); the Documents
-- rail icon + /notes routes are visible only to granted users / admins.
-- ============================================================

-- ------------------------------------------------------------
-- Pages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS squad_notes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id      UUID REFERENCES squad_notes(id) ON DELETE CASCADE,   -- NULL = top-level
  root_id        UUID,                                                -- trigger-maintained
  title          TEXT NOT NULL DEFAULT 'Untitled',
  icon           TEXT,                                                -- emoji
  cover_url      TEXT,
  text_size      TEXT NOT NULL DEFAULT 'normal'  CHECK (text_size IN ('small','normal','large')),
  full_width     BOOLEAN NOT NULL DEFAULT false,
  content        JSONB NOT NULL DEFAULT '{"type":"doc","content":[]}'::jsonb,  -- Tiptap doc
  position       INTEGER NOT NULL DEFAULT 0,
  owner_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visibility     TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','shared')),
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  last_edited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_squad_notes_workspace ON squad_notes(workspace_id)        WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_squad_notes_parent    ON squad_notes(parent_id, position) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_squad_notes_root      ON squad_notes(root_id)             WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_squad_notes_owner     ON squad_notes(owner_id)            WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_squad_notes_trash     ON squad_notes(workspace_id, owner_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;

ALTER TABLE squad_notes ENABLE ROW LEVEL SECURITY;

-- updated_at trigger (shared function from migration 024)
DROP TRIGGER IF EXISTS trg_squad_notes_updated_at ON squad_notes;
CREATE TRIGGER trg_squad_notes_updated_at
  BEFORE UPDATE ON squad_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- root_id maintenance: top-level -> self; child -> parent.root_id (recomputed on reparent).
CREATE OR REPLACE FUNCTION set_squad_note_root() RETURNS TRIGGER AS $fn$
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.root_id := NEW.id;
  ELSE
    SELECT root_id INTO NEW.root_id FROM squad_notes WHERE id = NEW.parent_id;
    IF NEW.root_id IS NULL THEN
      NEW.root_id := NEW.parent_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_squad_notes_set_root ON squad_notes;
CREATE TRIGGER trg_squad_notes_set_root
  BEFORE INSERT OR UPDATE OF parent_id ON squad_notes
  FOR EACH ROW EXECUTE FUNCTION set_squad_note_root();

-- ------------------------------------------------------------
-- Shares (polymorphic grantee). Always stored against the ROOT page.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS squad_note_shares (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id      UUID NOT NULL REFERENCES squad_notes(id) ON DELETE CASCADE,   -- the ROOT note
  grantee_type TEXT NOT NULL CHECK (grantee_type IN ('user','role','department')),
  grantee_id   UUID NOT NULL,             -- users.id | roles.id | departments.id
  access_level TEXT NOT NULL DEFAULT 'read' CHECK (access_level IN ('read','edit')),
  granted_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (note_id, grantee_type, grantee_id)
);

CREATE INDEX IF NOT EXISTS idx_squad_note_shares_note    ON squad_note_shares(note_id);
CREATE INDEX IF NOT EXISTS idx_squad_note_shares_grantee ON squad_note_shares(grantee_type, grantee_id);

ALTER TABLE squad_note_shares ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- Allow notes to be starred (favorites from migration 034).
-- ------------------------------------------------------------
ALTER TABLE favorites DROP CONSTRAINT IF EXISTS favorites_item_type_check;
ALTER TABLE favorites ADD  CONSTRAINT favorites_item_type_check
  CHECK (item_type IN ('channel','space','folder','list','note'));

-- ------------------------------------------------------------
-- Register the mini app (mirrors 118_checkins_mini_app.sql).
-- Visible to nobody until an admin grants access via Access Control.
-- ------------------------------------------------------------
INSERT INTO mini_apps (slug, name, description, icon, is_enabled)
VALUES (
  'squad-notes',
  'SquadNotes',
  'Notion-style notes & docs: nested pages, rich text, slash commands, embeds & sharing',
  'file-text',
  true
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- OPTIONAL / PHASE 2 — recoverable edit history (modeled on migration 120).
-- Uncomment to capture prior title/content on every edit for admin restore.
-- ============================================================
-- CREATE TABLE IF NOT EXISTS squad_note_edits (
--   id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
--   note_id          UUID NOT NULL REFERENCES squad_notes(id) ON DELETE CASCADE,
--   previous_title   TEXT,
--   previous_content JSONB NOT NULL,
--   editor_id        UUID REFERENCES users(id) ON DELETE SET NULL,
--   replaced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
-- );
-- CREATE INDEX IF NOT EXISTS idx_squad_note_edits_note ON squad_note_edits(note_id, replaced_at DESC);
-- ALTER TABLE squad_note_edits ENABLE ROW LEVEL SECURITY;
-- CREATE OR REPLACE FUNCTION capture_squad_note_edit() RETURNS TRIGGER AS $fn$
-- BEGIN
--   IF (NEW.content IS DISTINCT FROM OLD.content OR NEW.title IS DISTINCT FROM OLD.title) THEN
--     INSERT INTO squad_note_edits (note_id, previous_title, previous_content, editor_id)
--     VALUES (OLD.id, OLD.title, OLD.content, OLD.last_edited_by);
--   END IF;
--   RETURN NEW;
-- END;
-- $fn$ LANGUAGE plpgsql;
-- DROP TRIGGER IF EXISTS trg_capture_squad_note_edit ON squad_notes;
-- CREATE TRIGGER trg_capture_squad_note_edit BEFORE UPDATE ON squad_notes
--   FOR EACH ROW EXECUTE FUNCTION capture_squad_note_edit();
