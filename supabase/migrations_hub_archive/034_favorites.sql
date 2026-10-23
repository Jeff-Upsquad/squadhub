-- Favorites: per-user pinned spaces / folders / lists / channels shown in sidebar
CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('channel', 'space', 'folder', 'list')),
  item_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, workspace_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user_workspace ON favorites(user_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_favorites_item ON favorites(item_type, item_id);
