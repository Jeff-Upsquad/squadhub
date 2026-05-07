-- Add notifications table to the supabase_realtime publication so that
-- Supabase Realtime can stream INSERT events to the desktop companion app.
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
