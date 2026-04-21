-- ============================================================
-- Learning Management System — core schema
--
-- Two shapes of content share one table (lms_items.kind):
--   'post'   — self-contained update (1 auto-created lesson)
--   'course' — multi-lesson journey
-- Every item has >= 1 lesson; every lesson has 0..n blocks.
-- Audience tables capture admin intent (user_types + specific users).
-- lms_assignments are materialized rows created at publish time
-- (one per target user per item). Progress lives in
-- lms_lesson_progress and lms_quiz_attempts.
-- ============================================================

-- updated_at helper (idempotent)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- Categories (global, admin-managed)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lms_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6b7280',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Items (posts and courses)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lms_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('post', 'course')),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  summary TEXT,
  cover_image_url TEXT,
  category_id UUID REFERENCES lms_categories(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lms_items_status_published
  ON lms_items(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_lms_items_kind ON lms_items(kind);
CREATE INDEX IF NOT EXISTS idx_lms_items_category ON lms_items(category_id);

-- ------------------------------------------------------------
-- Lessons (always >= 1 per item; posts have exactly 1)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lms_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES lms_items(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Lesson',
  summary TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lms_lessons_item ON lms_lessons(item_id, position);

-- ------------------------------------------------------------
-- Content blocks (text / image / video / audio / pdf / quiz)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lms_content_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES lms_lessons(id) ON DELETE CASCADE,
  type TEXT NOT NULL
    CHECK (type IN ('text', 'image', 'video_upload', 'video_embed', 'audio', 'pdf', 'quiz')),
  position INTEGER NOT NULL DEFAULT 0,
  text_content JSONB,              -- Tiptap document JSON (for type='text')
  file_url TEXT,                   -- R2 public URL for uploaded media
  file_name TEXT,
  file_size BIGINT,
  mime_type TEXT,
  embed_url TEXT,                  -- YouTube / Vimeo / Loom URL
  embed_provider TEXT,             -- 'youtube' | 'vimeo' | 'loom' | 'other'
  caption TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lms_blocks_lesson ON lms_content_blocks(lesson_id, position);

-- ------------------------------------------------------------
-- Quiz questions (attached to a block where type='quiz')
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lms_quiz_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id UUID NOT NULL REFERENCES lms_content_blocks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  prompt TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{id:'a', text:'...'}, ...]
  correct_option_id TEXT NOT NULL,
  explanation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lms_quiz_questions_block ON lms_quiz_questions(block_id, position);

-- ------------------------------------------------------------
-- Audience (admin's intent — who should see this item)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lms_item_audience_types (
  item_id UUID NOT NULL REFERENCES lms_items(id) ON DELETE CASCADE,
  user_type TEXT NOT NULL
    CHECK (user_type IN ('internal', 'client', 'client_staff', 'partner')),
  PRIMARY KEY (item_id, user_type)
);

CREATE TABLE IF NOT EXISTS lms_item_audience_users (
  item_id UUID NOT NULL REFERENCES lms_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lms_audience_users_user
  ON lms_item_audience_users(user_id);

-- ------------------------------------------------------------
-- Assignments (materialized: one row per user × item)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lms_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES lms_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'completed')),
  progress_percent INTEGER NOT NULL DEFAULT 0
    CHECK (progress_percent BETWEEN 0 AND 100),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (item_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lms_assignments_user_status
  ON lms_assignments(user_id, status, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_lms_assignments_item
  ON lms_assignments(item_id);

-- ------------------------------------------------------------
-- Per-lesson completion (drives progress_percent)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lms_lesson_progress (
  assignment_id UUID NOT NULL REFERENCES lms_assignments(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES lms_lessons(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (assignment_id, lesson_id)
);

-- ------------------------------------------------------------
-- Quiz attempts (last attempt wins for scoring)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lms_quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES lms_assignments(id) ON DELETE CASCADE,
  block_id UUID NOT NULL REFERENCES lms_content_blocks(id) ON DELETE CASCADE,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { [question_id]: option_id }
  score_percent INTEGER NOT NULL DEFAULT 0,
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lms_quiz_attempts_assignment
  ON lms_quiz_attempts(assignment_id, block_id, submitted_at DESC);

-- ------------------------------------------------------------
-- Triggers: updated_at
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_lms_categories_updated_at ON lms_categories;
CREATE TRIGGER trg_lms_categories_updated_at
  BEFORE UPDATE ON lms_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_lms_items_updated_at ON lms_items;
CREATE TRIGGER trg_lms_items_updated_at
  BEFORE UPDATE ON lms_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_lms_lessons_updated_at ON lms_lessons;
CREATE TRIGGER trg_lms_lessons_updated_at
  BEFORE UPDATE ON lms_lessons FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_lms_blocks_updated_at ON lms_content_blocks;
CREATE TRIGGER trg_lms_blocks_updated_at
  BEFORE UPDATE ON lms_content_blocks FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_lms_quiz_questions_updated_at ON lms_quiz_questions;
CREATE TRIGGER trg_lms_quiz_questions_updated_at
  BEFORE UPDATE ON lms_quiz_questions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- Auto-create a default lesson when a post item is inserted
-- (courses create lessons explicitly via the API)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION lms_auto_create_post_lesson()
RETURNS TRIGGER AS $fn$
BEGIN
  IF NEW.kind = 'post' THEN
    INSERT INTO lms_lessons (item_id, title, position)
    VALUES (NEW.id, NEW.title, 0);
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lms_items_auto_post_lesson ON lms_items;
CREATE TRIGGER trg_lms_items_auto_post_lesson
  AFTER INSERT ON lms_items
  FOR EACH ROW EXECUTE FUNCTION lms_auto_create_post_lesson();

NOTIFY pgrst, 'reload schema';
