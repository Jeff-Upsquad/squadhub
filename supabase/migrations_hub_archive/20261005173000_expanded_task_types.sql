-- ============================================================
-- Expanded Task Types & Categories
-- Adds group_name column to task_types, updates definitions
-- and seeds the complete categorized task types catalogue.
-- ============================================================

ALTER TABLE task_types ADD COLUMN IF NOT EXISTS group_name TEXT;

-- Update existing task types with group_name and updated definitions
UPDATE task_types SET
  name = 'Tasks',
  description = 'Requires more than 10 minutes to complete.',
  group_name = 'Task Types',
  position = 10
WHERE key = 'task';

UPDATE task_types SET
  name = 'Work Block',
  description = 'Similar tasks grouped together to be completed in a time block.',
  group_name = 'Task Types',
  position = 12
WHERE key = 'work_block';

UPDATE task_types SET
  name = 'Routines',
  description = 'Recurring tasks done at regular intervals (daily, weekly, etc.).',
  group_name = 'Task Types',
  position = 15
WHERE key = 'routine';

UPDATE task_types SET
  name = 'Meetings',
  description = 'Scheduled meetings and collaborative sessions.',
  group_name = 'Meetings & Collaboration',
  position = 30
WHERE key = 'meeting';

UPDATE task_types SET
  name = 'Courses',
  description = 'Courses that need to be completed',
  group_name = 'Learning & Exploration',
  position = 42
WHERE key = 'course';

UPDATE task_types SET
  name = 'SOP',
  description = 'A system / process step assigned to you',
  group_name = 'Learning & Exploration',
  position = 43
WHERE key = 'sop';

UPDATE task_types SET
  name = 'Knowledge Doc',
  description = 'A knowledge document page to review',
  group_name = 'Learning & Exploration',
  position = 44
WHERE key = 'knowledge';

UPDATE task_types SET
  name = 'Design Task',
  description = 'Visual design deliverables',
  group_name = 'Media Creation',
  position = 61
WHERE key = 'design_task';

UPDATE task_types SET
  name = 'Video Edit Task',
  description = 'Video editing deliverables',
  group_name = 'Media Creation',
  position = 62
WHERE key = 'video_edit_task';

UPDATE task_types SET
  name = 'Post',
  description = 'A resource update assigned to you',
  group_name = 'Media Creation',
  position = 63
WHERE key = 'post';

-- Insert new task types
INSERT INTO task_types (key, name, description, group_name, icon, color, position, is_default, is_system, is_enabled)
VALUES
  -- Group 1: Task Types
  ('todo', 'ToDo', 'Quick tasks that take only a couple of minutes to finish.', 'Task Types', 'check-circle-2', '#3b82f6', 11, FALSE, TRUE, TRUE),
  ('focus_task', 'Focus Tasks', 'Tasks requiring uninterrupted focus and deep work to complete.', 'Task Types', 'target', '#6366f1', 13, FALSE, TRUE, TRUE),
  ('multi_day_task', 'Multi-Day Tasks', 'Larger tasks broken down into daily efforts, spanning several days.', 'Task Types', 'calendar-range', '#ec4899', 14, FALSE, TRUE, TRUE),
  ('plan', 'Plan', 'Tasks involving preparation, strategy, or setup before execution.', 'Task Types', 'compass', '#14b8a6', 16, FALSE, TRUE, TRUE),

  -- Group 2: Location-Based
  ('commute', 'Commute', 'Short-distance travel for a purpose.', 'Location-Based', 'car', '#f97316', 20, FALSE, TRUE, TRUE),
  ('travel', 'Travel', 'Long-distance travel for work or personal reasons.', 'Location-Based', 'plane', '#0284c7', 21, FALSE, TRUE, TRUE),
  ('out_of_office', 'Out of Office Tasks', 'Activities requiring you to go outside your usual workspace.', 'Location-Based', 'briefcase', '#d97706', 22, FALSE, TRUE, TRUE),

  -- Group 3: Meetings & Collaboration
  ('call', 'Call', 'Phone or audio-only communication.', 'Meetings & Collaboration', 'phone', '#10b981', 31, FALSE, TRUE, TRUE),
  ('e_meet', 'E-Meet', 'Online meeting with video or screen sharing.', 'Meetings & Collaboration', 'video', '#2563eb', 32, FALSE, TRUE, TRUE),
  ('in_person_meeting', 'In-Person Meeting', 'Face-to-face meetings.', 'Meetings & Collaboration', 'users', '#7c3aed', 33, FALSE, TRUE, TRUE),
  ('events', 'Events', 'Attending or organising events.', 'Meetings & Collaboration', 'calendar', '#f43f5e', 34, FALSE, TRUE, TRUE),
  ('brainstorm_session', 'Brainstorm Sessions', 'Collaborative idea-generation meetings.', 'Meetings & Collaboration', 'lightbulb', '#eab308', 35, FALSE, TRUE, TRUE),

  -- Group 4: Learning & Exploration
  ('learning', 'Learning', 'Activities focused on acquiring knowledge by reading, watching, or listening.', 'Learning & Exploration', 'book-open', '#06b6d4', 40, FALSE, TRUE, TRUE),
  ('research', 'Research', 'Tasks involving investigation, testing, and implementation.', 'Learning & Exploration', 'search', '#8b5cf6', 41, FALSE, TRUE, TRUE),

  -- Group 5: Follow-ups & Monitoring
  ('follow_ups', 'Follow-Ups', 'Checking back with someone or following up on pending actions.', 'Follow-ups & Monitoring', 'clock', '#f59e0b', 50, FALSE, TRUE, TRUE),

  -- Group 6: Media Creation
  ('recording', 'Recording', 'Creating audio or video recordings for various purposes.', 'Media Creation', 'mic', '#ef4444', 60, FALSE, TRUE, TRUE),

  -- Group 7: Action-Oriented Activities
  ('activities', 'Activities', 'Engaging, interactive tasks like physical activities or hobbies.', 'Action-Oriented Activities', 'zap', '#10b981', 70, FALSE, TRUE, TRUE),

  -- Group 8: Goals & Milestones
  ('milestone', 'Milestone', 'Task Type is milestone', 'Goals & Milestones', 'flag', '#6366f1', 80, FALSE, TRUE, TRUE),
  ('goal', 'Goal', 'Task Type is Goal', 'Goals & Milestones', 'trophy', '#f59e0b', 81, FALSE, TRUE, TRUE),

  -- Group 9: Personal
  ('chores', 'Chores', 'For Household work related tasks, like cleaning, laundry etc', 'Personal', 'home', '#84cc16', 90, FALSE, TRUE, TRUE),

  -- Group 10: Planning & Review
  ('quick_wins', 'Quick Wins', 'Small but impactful tasks that can be done quickly to move things forward.', 'Planning & Review', 'sparkles', '#eab308', 100, FALSE, TRUE, TRUE),
  ('review', 'Review', 'Revisiting past work, reports, or plans to evaluate or update them.', 'Planning & Review', 'clipboard-check', '#3b82f6', 101, FALSE, TRUE, TRUE),
  ('on_hold', 'On Hold', 'Tasks that are on hold', 'Planning & Review', 'pause-circle', '#9ca3af', 102, FALSE, TRUE, TRUE),
  ('parked_task', 'Parked Tasks', 'Tasks have been moved aside for working on someday later', 'Planning & Review', 'archive', '#64748b', 103, FALSE, TRUE, TRUE)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  group_name = EXCLUDED.group_name,
  icon = EXCLUDED.icon,
  color = EXCLUDED.color,
  position = EXCLUDED.position,
  is_system = EXCLUDED.is_system,
  is_enabled = EXCLUDED.is_enabled;

NOTIFY pgrst, 'reload schema';
