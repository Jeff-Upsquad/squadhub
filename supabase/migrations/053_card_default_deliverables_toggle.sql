-- ============================================================
-- 053_card_default_deliverables_toggle.sql
--
-- Per-card toggle for the plan's default deliverables. When a sales user
-- decides this client doesn't get a particular default (typically the hourly
-- commitment), we record the deliverable's id here. The partner UI filters
-- against this list, and surfaces "No hourly commitment" when no hours-kind
-- default remains.
--
-- Deliberately a UUID[] rather than a join table — the list is small (one
-- row per default deliverable on the plan), bounded by plan, and we never
-- query "which cards disabled deliverable X". Postgres array contains-checks
-- are sufficient.
-- ============================================================

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS disabled_default_deliverable_ids UUID[] NOT NULL DEFAULT '{}'::uuid[];
