-- 140_task_list_links.sql
-- Multi-homing for tasks.
--
-- A task lives in exactly ONE primary list (tasks.list_id). This table lets a
-- task ALSO appear in additional lists without moving it. Each row means
-- "task_id also shows up in list_id". The primary list is never stored here —
-- removing every link leaves the task in its original (primary) list only.
--
-- See "Move to another list" (updates tasks.list_id) vs. "Add to list"
-- (inserts here). The list view query unions primary + linked tasks.

CREATE TABLE IF NOT EXISTS task_list_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A task can only be linked into a given list once.
  UNIQUE (task_id, list_id)
);

-- List view query filters by list_id ("which tasks are linked into this list").
CREATE INDEX IF NOT EXISTS idx_task_list_links_list ON task_list_links(list_id);
-- Task detail query filters by task_id ("which lists is this task linked into").
CREATE INDEX IF NOT EXISTS idx_task_list_links_task ON task_list_links(task_id);
