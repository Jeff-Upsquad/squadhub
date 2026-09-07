-- Allow SOP flag/strike inbox notifications. Migration 191 documented these
-- types but never added them to notifications.type CHECK, so inserts were
-- silently rejected and the flagged user never saw a notification.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type = ANY (ARRAY[
    'announcement',
    'task_assigned','task_updated','task_completed','task_commented','task_due_soon',
    'mention','message_mention','dm_received','reaction_added',
    'lms_assigned','lms_updated','lms_shared','lms_review_requested','lms_review_decided','lms_comment',
    'meeting_invited','meeting_suggestion','meeting_suggestion_resolved','meeting_confirmed','meeting_cancelled',
    'support_ticket_reply','support_ticket_assigned',
    'sop_flag','sop_strike'
  ]::text[])
);
