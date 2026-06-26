-- Auto-assign: each task container (list, folder, space) can hold a set of
-- members who are automatically added to any task created under it. Stored as a
-- UUID[] mirroring tasks.assignee_ids (migration 033). Resolution at task
-- creation is nearest-wins up the tree (list -> folder -> space), then merged
-- onto whatever the creator picked manually.
ALTER TABLE lists   ADD COLUMN IF NOT EXISTS auto_assignee_ids UUID[] NOT NULL DEFAULT '{}'::UUID[];
ALTER TABLE folders ADD COLUMN IF NOT EXISTS auto_assignee_ids UUID[] NOT NULL DEFAULT '{}'::UUID[];
ALTER TABLE spaces  ADD COLUMN IF NOT EXISTS auto_assignee_ids UUID[] NOT NULL DEFAULT '{}'::UUID[];
