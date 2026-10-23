-- ============================================================
-- 096: Squad Clips — Loom-style screen recorder mini app
-- Tables are owned by the Squad Clips app (separate repo) which
-- talks to this database directly with the service role key.
-- RLS owner policies are defense-in-depth only: the service role
-- bypasses them; they matter if an anon-key client ever appears.
-- ============================================================

-- Personal folders for organizing clips
CREATE TABLE IF NOT EXISTS clip_folders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clip_folders_user ON clip_folders(user_id);

-- Clips (recorded in-app or uploaded externally)
CREATE TABLE IF NOT EXISTS clips (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id        UUID REFERENCES clip_folders(id) ON DELETE SET NULL,
  title            TEXT NOT NULL DEFAULT 'Untitled clip',
  source           TEXT NOT NULL DEFAULT 'recorded' CHECK (source IN ('recorded', 'uploaded')),
  status           TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('uploading', 'processing', 'ready', 'failed')),
  r2_key           TEXT NOT NULL,
  original_r2_key  TEXT,            -- pre-edit master, kept for re-edits/revert
  thumbnail_r2_key TEXT,
  mime_type        TEXT NOT NULL DEFAULT 'video/webm',
  size_bytes       BIGINT,
  duration_seconds REAL,
  width            INT,
  height           INT,
  edit_state       JSONB,           -- non-destructive EditList draft; shape owned by the clips app
  share_token      TEXT,            -- uniqueness via partial index below
  share_enabled    BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clips_user_created ON clips(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clips_folder ON clips(folder_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_clips_share_token
  ON clips(share_token) WHERE share_token IS NOT NULL;

-- updated_at triggers (function from migration 024)
DROP TRIGGER IF EXISTS trg_clip_folders_updated_at ON clip_folders;
CREATE TRIGGER trg_clip_folders_updated_at
  BEFORE UPDATE ON clip_folders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_clips_updated_at ON clips;
CREATE TRIGGER trg_clips_updated_at
  BEFORE UPDATE ON clips
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: owner-only (service role bypasses; the public share page is served by
-- the clips app server-side with the service role, so no anon policy exists)
ALTER TABLE clip_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clip_folders_owner_select" ON clip_folders FOR SELECT USING (user_id = (select auth.uid()));
CREATE POLICY "clip_folders_owner_insert" ON clip_folders FOR INSERT WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "clip_folders_owner_update" ON clip_folders FOR UPDATE USING (user_id = (select auth.uid()));
CREATE POLICY "clip_folders_owner_delete" ON clip_folders FOR DELETE USING (user_id = (select auth.uid()));

CREATE POLICY "clips_owner_select" ON clips FOR SELECT USING (user_id = (select auth.uid()));
CREATE POLICY "clips_owner_insert" ON clips FOR INSERT WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "clips_owner_update" ON clips FOR UPDATE USING (user_id = (select auth.uid()));
CREATE POLICY "clips_owner_delete" ON clips FOR DELETE USING (user_id = (select auth.uid()));

-- Register as a mini app (visible to nobody until an admin grants access)
INSERT INTO mini_apps (slug, name, description, icon, is_enabled)
VALUES ('squad-clips', 'Squad Clips', 'Record, edit and share screen recordings', 'video-camera', true)
ON CONFLICT DO NOTHING;
