-- ============================================================
-- Squad Chat: push provider column
-- Adds `provider` to chat_push_tokens so the server can route
-- notifications via Expo (existing RN/Expo apps) OR FCM directly
-- (upcoming native Android apps). Without this, the Expo dispatch
-- path deletes any non-Expo token on first send (expo.ts:34-36).
-- ============================================================

BEGIN;

ALTER TABLE chat_push_tokens
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'expo'
  CHECK (provider IN ('expo', 'fcm'));

CREATE INDEX IF NOT EXISTS idx_chat_push_tokens_user_variant_provider
  ON chat_push_tokens(user_id, app_variant, provider);

COMMIT;
