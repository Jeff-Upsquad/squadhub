-- Add user approval status column
-- New signups will be 'pending' until an admin approves them
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';

-- Ensure only valid statuses
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('pending', 'approved', 'rejected'));

-- All existing users are already active, mark them approved
UPDATE users SET status = 'approved';
