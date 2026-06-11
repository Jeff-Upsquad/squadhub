// ============================================================
// Scheduled messages for workspace chat (channels + DMs).
// Text-only v1. Rows are swept by cron/scheduled-messages-cron.
// Mounted on /messages BEFORE routes/messages.ts so the literal
// /scheduled paths win over the /:id params there.
// ============================================================
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { checkResourceAccess, meetsAccessLevel } from '../middleware/permissions';
import { supabaseAdmin } from '../supabase';

const router = Router();

const MAX_AHEAD_MS = 90 * 24 * 60 * 60 * 1000; // 90 days, Slack-style ceiling

const scheduleSchema = z.object({
  channel_id: z.string().uuid().optional(),
  dm_conversation_id: z.string().uuid().optional(),
  parent_message_id: z.string().uuid().optional(),
  content: z.string().min(1).max(8000),
  scheduled_at: z.string().datetime({ offset: true }),
}).refine(
  (data) => data.channel_id || data.dm_conversation_id,
  { message: 'Either channel_id or dm_conversation_id is required' },
);

// POST /messages/scheduled — queue a message for later delivery
router.post('/scheduled', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = scheduleSchema.parse(req.body);

    const when = new Date(body.scheduled_at).getTime();
    if (!(when > Date.now() + 30_000)) {
      res.status(400).json({ success: false, error: 'scheduled_at must be at least a minute in the future' });
      return;
    }
    if (when > Date.now() + MAX_AHEAD_MS) {
      res.status(400).json({ success: false, error: 'scheduled_at can be at most 90 days out' });
      return;
    }

    // Same gate as POST /messages: commenter+ on the channel.
    if (body.channel_id) {
      const userLevel = await checkResourceAccess(req.userId!, 'channel', body.channel_id);
      if (!userLevel || !meetsAccessLevel(userLevel, 'commenter')) {
        res.status(403).json({ success: false, error: 'Commenter access required to send messages' });
        return;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('chat_scheduled_messages')
      .insert({
        user_id: req.userId,
        channel_id: body.channel_id || null,
        dm_conversation_id: body.dm_conversation_id || null,
        parent_message_id: body.parent_message_id || null,
        content: body.content,
        scheduled_at: body.scheduled_at,
      })
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Schedule message error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /messages/scheduled?channel_id=|dm_conversation_id= — own pending, soonest first
router.get('/scheduled', requireAuth, async (req: Request, res: Response) => {
  try {
    let query = supabaseAdmin
      .from('chat_scheduled_messages')
      .select('*')
      .eq('user_id', req.userId)
      .eq('status', 'pending')
      .order('scheduled_at', { ascending: true });

    const channelId = req.query.channel_id as string | undefined;
    const dmConversationId = req.query.dm_conversation_id as string | undefined;
    if (channelId) query = query.eq('channel_id', channelId);
    else if (dmConversationId) query = query.eq('dm_conversation_id', dmConversationId);

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('List scheduled messages error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /messages/scheduled/:id — cancel own pending scheduled message
router.delete('/scheduled/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('chat_scheduled_messages')
      .update({ status: 'canceled' })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ success: false, error: 'Scheduled message not found (or already sent)' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Cancel scheduled message error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
