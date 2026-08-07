-- 173_merge_lead_deal_team_chats.sql
--
-- One-time backfill: carry each qualified lead's team chat onto the deal it
-- became, so a lead and its deal share ONE chat instead of two.
--
-- Team chats live in `channels`, soft-linked to a CRM entity via
-- (linked_resource_type, linked_resource_id) with a UNIQUE partial index
-- (idx_channels_linked_resource) over non-deleted rows. Before this change a
-- lead and the deal it spawned had separate channels; qualify-spawn now
-- re-links at conversion (server/src/services/team-chat-relink.ts). This fixes
-- the pre-existing pairs.
--
--   Case A — a lead channel AND its deal's channel both exist:
--            fold the lead channel into the deal channel (winner = deal),
--            preserving every message, then soft-delete the lead channel.
--   Case B — a lead channel whose deal has no channel yet:
--            simply re-link the lead channel to the deal.
--
-- Idempotent: re-running finds no un-deleted lead channels with a spawned deal.

DO $$
DECLARE
  rec RECORD;
BEGIN
  -- Case A: merge lead channel (loser) into the existing deal channel (winner).
  FOR rec IN
    SELECT lc.id AS loser, dc.id AS winner, d.name AS deal_name, d.status AS deal_status
    FROM channels lc
    JOIN crm_deals d ON d.source_lead_id = lc.linked_resource_id
    JOIN channels dc
      ON dc.linked_resource_type = 'crm_deal'
     AND dc.linked_resource_id = d.id
     AND dc.deleted_at IS NULL
    WHERE lc.linked_resource_type = 'crm_lead'
      AND lc.deleted_at IS NULL
  LOOP
    -- Messages carry reactions + thread links along (they key on message id).
    UPDATE messages SET channel_id = rec.winner WHERE channel_id = rec.loser;

    -- Union memberships: grant winner-membership to anyone only in the loser.
    INSERT INTO resource_memberships (resource_type, resource_id, user_id, access_level)
    SELECT 'channel', rec.winner, rm.user_id, COALESCE(rm.access_level, 'member')
    FROM resource_memberships rm
    WHERE rm.resource_type = 'channel'
      AND rm.resource_id = rec.loser
      AND NOT EXISTS (
        SELECT 1 FROM resource_memberships w
        WHERE w.resource_type = 'channel'
          AND w.resource_id = rec.winner
          AND w.user_id = rm.user_id
      );
    DELETE FROM resource_memberships WHERE resource_type = 'channel' AND resource_id = rec.loser;

    -- Drop the loser's per-user close state + read marks (winner's own stand).
    DELETE FROM crm_chat_user_state WHERE channel_id = rec.loser;
    DELETE FROM message_reads WHERE scope_type = 'channel' AND scope_id = rec.loser;

    -- Soft-delete the loser (partial unique index ignores deleted rows).
    UPDATE channels SET deleted_at = now() WHERE id = rec.loser AND deleted_at IS NULL;

    -- Keep the surviving deal channel's label fresh.
    UPDATE channels
       SET linked_label = COALESCE(NULLIF(btrim(rec.deal_name), ''), linked_label),
           linked_subtitle = CASE
             WHEN rec.deal_status IS NOT NULL THEN 'Deal · ' || rec.deal_status
             ELSE 'Deal'
           END
     WHERE id = rec.winner;
  END LOOP;

  -- Case B: re-link a lead channel onto its deal when the deal has no channel.
  FOR rec IN
    SELECT lc.id AS chan, d.id AS deal_id, d.name AS deal_name, d.status AS deal_status
    FROM channels lc
    JOIN crm_deals d ON d.source_lead_id = lc.linked_resource_id
    WHERE lc.linked_resource_type = 'crm_lead'
      AND lc.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM channels dc
        WHERE dc.linked_resource_type = 'crm_deal'
          AND dc.linked_resource_id = d.id
          AND dc.deleted_at IS NULL
      )
  LOOP
    UPDATE channels
       SET linked_resource_type = 'crm_deal',
           linked_resource_id = rec.deal_id,
           linked_label = COALESCE(NULLIF(btrim(rec.deal_name), ''), linked_label),
           linked_subtitle = CASE
             WHEN rec.deal_status IS NOT NULL THEN 'Deal · ' || rec.deal_status
             ELSE 'Deal'
           END
     WHERE id = rec.chan;
  END LOOP;
END $$;
