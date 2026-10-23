-- Link a channel to a container (space / folder / list) so the container's
-- header can open the channel in a side panel, and the channel can link back
-- to its container. One active channel per container (enforced below).

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS linked_resource_type TEXT
    CHECK (linked_resource_type IN ('space', 'folder', 'list')),
  ADD COLUMN IF NOT EXISTS linked_resource_id UUID;

-- At most one active (non-deleted) channel per linked container.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_linked_resource
  ON channels (linked_resource_type, linked_resource_id)
  WHERE linked_resource_id IS NOT NULL AND deleted_at IS NULL;
