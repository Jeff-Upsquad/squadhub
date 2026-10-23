-- Group Meet invites from SquadHire land in the partner-app inbox + FCM.
-- The CHECK must allow the three event types or insert fails silently.
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
    'group_meet_invite','group_meet_rescheduled','group_meet_cancelled'
  ]::text[])
);
