-- Browser Web Push subscriptions for the installable PWA (squadhub.in).
--
-- Sibling to partner_push_tokens (native partner app / FCM) and chat_push_tokens
-- (Squad Chat / Expo+FCM). These drive W3C Web Push to the user's browsers,
-- mirrored from the `notifications` table via the Socket.IO poll bridge in
-- server/src/sockets/index.ts (sent only when the user has no live socket, so an
-- open tab's in-app notification doesn't double up). See server/src/push/webPush.ts.
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_user ON web_push_subscriptions(user_id);

-- Only the server (service role) touches this table; enable RLS with no policy
-- so there's no direct anon/authenticated access.
ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;
