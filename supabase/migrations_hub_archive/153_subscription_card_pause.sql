-- 153_subscription_card_pause.sql
-- Pause marker for live assignments. A paused card keeps state='assigned' and
-- keeps selected_recipient_* (the "previous talent" memory the resume flow
-- offers to re-assign); billing stops because pausing ends the active
-- assignment term. NULL = not paused. Resume clears it.

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
