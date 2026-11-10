-- pendingDeliveries() polls for generated human/assistant messages by bot,
-- oldest first. The conversation-first indexes cannot serve this lookup,
-- causing a full message-table scan even when no deliveries are waiting.
-- Only queued messages belong in this index; sent/draft history stays out.
-- Keep bot polling and delivery behavior unchanged.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE INDEX squad_bot_messages_pending_delivery_idx
  ON public.squad_bot_conversation_messages (bot_id, created_at)
  WHERE delivery_status = 'generated'
    AND role IN ('human', 'assistant');
