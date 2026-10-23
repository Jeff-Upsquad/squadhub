-- The Socket.IO notification bridge polls for new rows with
--   WHERE created_at > <watermark> ORDER BY created_at LIMIT 50
-- every 2s. The existing idx_notifications_user_unread leads with user_id, so
-- that query can't use it and falls back to a seq scan. A plain created_at
-- index turns the poll into a cheap index range scan as the table grows.
CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON public.notifications (created_at);
