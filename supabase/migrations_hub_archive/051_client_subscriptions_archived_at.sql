-- Migration: 051_client_subscriptions_archived_at
-- Description: Soft-archive support for client_subscriptions.
-- Replaces the previous "remove" hard-delete (which broke deliverable / time-tracking
-- / cash-book history) with an archived_at timestamp. The DELETE route now sets this
-- column instead of removing the row.

ALTER TABLE client_subscriptions
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cs_active
  ON client_subscriptions(client_id)
  WHERE archived_at IS NULL;
