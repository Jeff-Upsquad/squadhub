-- Allow generic 'announcement' notifications — system-wide inbox messages sent
-- to many users at once (e.g., "Partner Payments is live"). Without this, the
-- notifications.type CHECK constraint rejects any non-feature-specific type.
-- Apply in the Supabase SQL Editor before sending announcements.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type = ANY (ARRAY[
    'announcement',
    'task_assigned','task_updated','task_completed','task_commented','task_due_soon',
    'mention','message_mention','dm_received','reaction_added',
    'lms_assigned','lms_updated','lms_shared','lms_review_requested','lms_review_decided','lms_comment',
    'meeting_invited','meeting_suggestion','meeting_suggestion_resolved','meeting_confirmed','meeting_cancelled',
    'support_ticket_reply','support_ticket_assigned'
  ]::text[])
);
