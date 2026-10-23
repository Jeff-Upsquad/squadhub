-- ============================================================
-- Migration 166: Resources "send as task"
--
-- Lets an admin push a Resources item — a whole course/SOP/post, a single
-- lesson, or a section (heading) within a lesson — to a chosen set of users /
-- roles as a real, trackable task. Each send fans out into one materialized
-- recipient per resolved user; taskMirror then creates one personal-list task
-- per recipient (source_kind 'course' | 'sop' | 'post', source_id = recipient
-- id). The recipient's mirror task is the completion source of truth, so the
-- admin tracker just reads task status.
--
-- This is a SEPARATE, finer-grained mechanism from the legacy whole-item
-- lms_assignments → mirrorCourseItem path (127/taskMirror), which stays intact.
-- ============================================================

-- 1. One row per admin "send".
CREATE TABLE IF NOT EXISTS lms_task_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES lms_items(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('item', 'lesson', 'section')),
  lesson_id UUID REFERENCES lms_lessons(id) ON DELETE CASCADE,   -- lesson/section scope
  section_anchor TEXT,   -- heading slug (sec-{i}-{slug}) — section scope
  section_label  TEXT,   -- heading text (display + best-effort relink)
  section_index  INTEGER,-- heading ordinal within the lesson (relink stability)
  title TEXT NOT NULL,            -- task title snapshot shown to recipients
  due_date TIMESTAMPTZ,
  auto_resend BOOLEAN NOT NULL DEFAULT FALSE,  -- re-fire this send on content update
  -- The users/roles the admin picked, so resend can re-expand roles (catch new
  -- members) and re-grant access: [{ "type": "user"|"role", "id": "<uuid>" }].
  picked_principals JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_kind TEXT NOT NULL,     -- 'course' | 'sop' | 'post' (cached from item at send)
  version INTEGER NOT NULL DEFAULT 1,          -- bumped on each resend (audit / reopen)
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lms_task_sends_item ON lms_task_sends(item_id);
CREATE INDEX IF NOT EXISTS idx_lms_task_sends_auto
  ON lms_task_sends(item_id) WHERE auto_resend = TRUE;

DROP TRIGGER IF EXISTS trg_lms_task_sends_updated_at ON lms_task_sends;
CREATE TRIGGER trg_lms_task_sends_updated_at
  BEFORE UPDATE ON lms_task_sends FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. Materialized recipients (one per resolved user). The mirror task keyed on
--    (source_kind, this id, user_id) carries completion.
CREATE TABLE IF NOT EXISTS lms_task_send_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id UUID NOT NULL REFERENCES lms_task_sends(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,  -- the send version this recipient was (re)sent
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (send_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lms_task_send_recipients_send ON lms_task_send_recipients(send_id);
CREATE INDEX IF NOT EXISTS idx_lms_task_send_recipients_user ON lms_task_send_recipients(user_id);

-- 3. System task types for the two new Home cards (SOP / Post). 'course' already
--    exists (migration 127) and is reused for learning-track course items.
INSERT INTO task_types (key, name, description, icon, color, is_system, is_default, is_enabled, position)
VALUES
  ('sop',  'SOP',  'A system / process step assigned to you', 'clipboard-list', '#10b981', TRUE, FALSE, TRUE, 6),
  ('post', 'Post', 'A resource update assigned to you',       'file-text',      '#8b5cf6', TRUE, FALSE, TRUE, 7)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
