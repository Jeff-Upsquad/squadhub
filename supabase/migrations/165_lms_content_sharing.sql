-- ============================================================
-- Migration 165: Resources content sharing & access levels
--
-- Lets each LMS item (post / course / SOP) be shared with any user or role
-- at one of four access levels, adds a staff-only comment thread per page,
-- and adds the columns that drive the contributor "submit for review" flow.
--
-- Access-level naming mirrors 005_resource_access_control.sql
-- (resource_memberships.access_level) — 'viewer'/'commenter' reused, with
-- 'contributor'/'admin' replacing 'member'/'manager' to match product terms.
-- ============================================================

-- 1. Per-item sharing ACL. principal_id is polymorphic (users.id OR roles.id)
--    keyed by principal_type — same pattern as resource_memberships.resource_id,
--    so no single FK. Item owner + global admins get 'admin' implicitly (no row).
CREATE TABLE lms_item_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES lms_items(id) ON DELETE CASCADE,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'role')),
  principal_id UUID NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'viewer'
    CHECK (access_level IN ('viewer', 'commenter', 'contributor', 'admin')),
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, principal_type, principal_id)
);

CREATE INDEX idx_lms_shares_item ON lms_item_shares(item_id);
CREATE INDEX idx_lms_shares_principal ON lms_item_shares(principal_type, principal_id);

-- 2. Staff-only comment threads. Anchored to a lesson (the "page"; a post/SOP
--    has exactly one lesson). parent_id threads replies. Visible to commenter+
--    access holders only — enforced in the API, not RLS.
CREATE TABLE lms_item_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES lms_items(id) ON DELETE CASCADE,
  lesson_id UUID REFERENCES lms_lessons(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES lms_item_comments(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lms_comments_item ON lms_item_comments(item_id);
CREATE INDEX idx_lms_comments_lesson ON lms_item_comments(lesson_id);
CREATE INDEX idx_lms_comments_parent ON lms_item_comments(parent_id);

-- 3. Contributor "submit for review" flow on lms_items.
--    A contributor edits a DRAFT CLONE of a live item (origin_item_id set),
--    submits it, and an admin approves (applies clone -> live) or rejects.
ALTER TABLE lms_items ADD COLUMN IF NOT EXISTS origin_item_id UUID
  REFERENCES lms_items(id) ON DELETE CASCADE;
ALTER TABLE lms_items ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'none'
  CHECK (review_state IN ('none', 'draft', 'submitted', 'changes_requested'));
ALTER TABLE lms_items ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE lms_items ADD COLUMN IF NOT EXISTS submitted_by UUID
  REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE lms_items ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_lms_items_origin ON lms_items(origin_item_id);
CREATE INDEX IF NOT EXISTS idx_lms_items_review_state ON lms_items(review_state)
  WHERE review_state = 'submitted';

-- 4. Notification types for sharing / review / comments. Preserve every
--    existing value (from 139) and add the four new ones. Inserted from the
--    API (services), not via triggers.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'task_assigned', 'task_updated', 'task_completed', 'task_commented',
    'task_due_soon', 'mention', 'message_mention', 'dm_received',
    'reaction_added', 'lms_assigned', 'lms_updated',
    'meeting_invited', 'meeting_suggestion', 'meeting_suggestion_resolved',
    'meeting_confirmed', 'meeting_cancelled',
    'lms_shared', 'lms_review_requested', 'lms_review_decided', 'lms_comment'
  ));
