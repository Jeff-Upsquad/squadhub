-- ============================================================
-- Squad Clips: sections inside folders
-- A folder chooses either a tabbed or vertically grouped layout.
-- Clips may belong to one section in their current folder.
-- ============================================================

ALTER TABLE clip_folders
  ADD COLUMN IF NOT EXISTS section_layout TEXT NOT NULL DEFAULT 'tabs'
  CHECK (section_layout IN ('tabs', 'vertical'));

CREATE TABLE IF NOT EXISTS clip_sections (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id  UUID NOT NULL REFERENCES clip_folders(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clip_sections_folder_position
  ON clip_sections(folder_id, position, created_at);
CREATE INDEX IF NOT EXISTS idx_clip_sections_user
  ON clip_sections(user_id);

ALTER TABLE clips
  ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES clip_sections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clips_section ON clips(section_id);

DROP TRIGGER IF EXISTS trg_clip_sections_updated_at ON clip_sections;
CREATE TRIGGER trg_clip_sections_updated_at
  BEFORE UPDATE ON clip_sections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE clip_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clip_sections_owner_select" ON clip_sections
  FOR SELECT USING (user_id = (select auth.uid()));
CREATE POLICY "clip_sections_owner_insert" ON clip_sections
  FOR INSERT WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "clip_sections_owner_update" ON clip_sections
  FOR UPDATE USING (user_id = (select auth.uid()));
CREATE POLICY "clip_sections_owner_delete" ON clip_sections
  FOR DELETE USING (user_id = (select auth.uid()));
