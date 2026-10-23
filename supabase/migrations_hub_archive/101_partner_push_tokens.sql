-- Partner app (in.squadhub.partner) device tokens for FCM push.
--
-- Separate from chat_push_tokens (the standalone Squad Chat apps). The partner
-- app mirrors the web notifications feed (task updates + chat) by pushing every
-- row from the `notifications` table via the Socket.IO poll bridge in
-- server/src/sockets/index.ts.
CREATE TABLE IF NOT EXISTS partner_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android' CHECK (platform IN ('ios', 'android')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_partner_push_tokens_user ON partner_push_tokens(user_id);

-- Only the server (service role) touches this table; enable RLS with no policy
-- so there's no direct anon/authenticated access.
ALTER TABLE partner_push_tokens ENABLE ROW LEVEL SECURITY;
