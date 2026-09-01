-- Replay already-delivered activation callbacks once after assignment-time
-- talent provisioning is deployed. Before this change, activation only moved
-- the mirrored SquadHire card to "Assigned"; it did not create the SquadHub
-- partner account. Resetting the existing retry marker lets the normal,
-- idempotent activation sweeper backfill those talents without a one-off job.

UPDATE subscription_cards
SET
  squadhire_activation_notified_at = NULL,
  squadhire_activation_notify_attempts = 0,
  squadhire_activation_notify_error = 'replay_for_talent_provisioning'
WHERE state = 'assigned'
  AND selected_recipient_type = 'talent'
  AND selected_recipient_id IS NOT NULL
  AND cancelled_at IS NULL
  AND deleted_at IS NULL
  AND squadhire_activation_notified_at IS NOT NULL;
