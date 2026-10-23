-- SquadHire Partner Program / Jobs application approved or rejected — written
-- by /integrations/squadhire/talent/notice so the partner app can FCM it.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type = ANY (ARRAY[
    'announcement',
    'task_assigned','task_updated','task_completed','task_commented','task_due_soon',
    'mention','message_mention','thread_reply','dm_received','reaction_added',
    'lms_assigned','lms_updated','lms_shared','lms_review_requested','lms_review_decided','lms_comment',
    'meeting_invited','meeting_suggestion','meeting_suggestion_resolved','meeting_confirmed','meeting_cancelled',
    'support_ticket_reply','support_ticket_assigned',
    'sop_flag','sop_strike',
    'group_meet_invite','group_meet_rescheduled','group_meet_cancelled','group_meet_join',
    'application_approved','application_rejected'
  ]::text[])
);
