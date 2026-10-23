-- Enable replica identity so Supabase Realtime can stream INSERT payloads
-- from the notifications table (used by the desktop companion app bridge).
ALTER TABLE notifications REPLICA IDENTITY FULL;
