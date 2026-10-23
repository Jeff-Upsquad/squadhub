-- ============================================================
-- Per-language video variants on a Resources content block
--
-- SquadHire's talent training carried one video per language per lesson
-- (training_lesson_videos). That content is moving here, so Resources has to
-- be able to author the same thing or the feature would be lost in the move.
--
-- The variant hangs off the BLOCK rather than the lesson/page: a page can hold
-- several videos and each carries its own set of languages. A block's own
-- embed_url / file_url stays the default for viewers whose language has no
-- variant, so every existing video block keeps playing untouched and no
-- backfill is needed.
-- ============================================================

CREATE TABLE IF NOT EXISTS lms_content_block_videos (
  block_id       UUID NOT NULL REFERENCES lms_content_blocks(id) ON DELETE CASCADE,
  language       TEXT NOT NULL,
  -- Either an embed (Loom / Squad Clips / YouTube / Vimeo) or an R2 upload,
  -- matching the video_embed vs video_upload split on the block itself.
  embed_url      TEXT,
  embed_provider TEXT,
  file_url       TEXT,
  file_name      TEXT,
  file_size      BIGINT,
  mime_type      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (block_id, language),
  CONSTRAINT lms_content_block_videos_needs_source
    CHECK (embed_url IS NOT NULL OR file_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_lms_block_videos_block
  ON lms_content_block_videos(block_id);

DROP TRIGGER IF EXISTS trg_lms_block_videos_updated_at ON lms_content_block_videos;
CREATE TRIGGER trg_lms_block_videos_updated_at
  BEFORE UPDATE ON lms_content_block_videos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE lms_content_block_videos IS
  'Per-language alternates for a video block. The block''s own embed_url/file_url is the default when the viewer''s language has no row here.';

NOTIFY pgrst, 'reload schema';
