import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { supabaseAdmin } from '../../supabase-chat';

const router = Router();

const deliveredSchema = z.object({
  message_ids: z.array(z.string().uuid()).min(1).max(500),
});

const readSchema = z.object({
  conversation_type: z.enum(['group', 'dm']),
  conversation_id: z.string().uuid(),
  up_to_message_id: z.string().uuid(),
});

// POST /chat/receipts/delivered
// Batch-flip delivered_at for the current user across many messages.
// Emits a chat_receipt_update to the sender's chat_user room for each message.
router.post('/delivered', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = deliveredSchema.parse(req.body);
    const now = new Date().toISOString();

    // UPDATE receipts for this user on the listed messages where still null.
    const { data: updated, error } = await supabaseAdmin
      .from('chat_message_receipts')
      .update({ delivered_at: now })
      .in('message_id', body.message_ids)
      .eq('user_id', req.userId!)
      .is('delivered_at', null)
      .select('message_id, user_id, delivered_at, read_at');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Emit receipt updates so senders see double-grey ticks.
    const io = req.app.get('io');
    if (io && updated && updated.length > 0) {
      // Fetch sender ids once for all affected messages.
      const { data: msgs } = await supabaseAdmin
        .from('chat_messages')
        .select('id, sender_id')
        .in('id', updated.map((u: any) => u.message_id));
      const senderByMsg = new Map((msgs || []).map((m: any) => [m.id, m.sender_id]));
      for (const row of updated) {
        const senderId = senderByMsg.get(row.message_id);
        if (senderId) {
          io.to(`chat_user:${senderId}`).emit('chat_receipt_update', row);
        }
      }
    }

    res.json({ success: true, updated_count: updated?.length || 0 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Receipts delivered error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /chat/receipts/read
// Mark every message <= up_to_message_id in the conversation as read for current user.
// Also bumps chat_group_members.last_read_at when applicable.
router.post('/read', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = readSchema.parse(req.body);
    const now = new Date().toISOString();

    // Resolve the cutoff message's created_at.
    const { data: cutoff } = await supabaseAdmin
      .from('chat_messages')
      .select('created_at, group_id, dm_conversation_id')
      .eq('id', body.up_to_message_id)
      .single();
    if (!cutoff) {
      res.status(404).json({ success: false, error: 'Cutoff message not found' });
      return;
    }

    // Build the set of candidate message ids in this conversation <= cutoff.
    let q = supabaseAdmin
      .from('chat_messages')
      .select('id, sender_id')
      .lte('created_at', cutoff.created_at);
    if (body.conversation_type === 'group') {
      q = q.eq('group_id', body.conversation_id);
    } else {
      q = q.eq('dm_conversation_id', body.conversation_id);
    }
    const { data: candidates } = await q;
    if (!candidates || candidates.length === 0) {
      res.json({ success: true, updated_count: 0 });
      return;
    }

    const { data: updated, error } = await supabaseAdmin
      .from('chat_message_receipts')
      .update({
        delivered_at: now, // delivered implied by read
        read_at: now,
      })
      .in('message_id', candidates.map((m: any) => m.id))
      .eq('user_id', req.userId!)
      .is('read_at', null)
      .select('message_id, user_id, delivered_at, read_at');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    if (body.conversation_type === 'group') {
      await supabaseAdmin
        .from('chat_group_members')
        .update({ last_read_at: now })
        .eq('group_id', body.conversation_id)
        .eq('user_id', req.userId!);
    }

    const io = req.app.get('io');
    if (io && updated && updated.length > 0) {
      const senderByMsg = new Map(candidates.map((m: any) => [m.id, m.sender_id]));
      for (const row of updated) {
        const senderId = senderByMsg.get(row.message_id);
        if (senderId) {
          io.to(`chat_user:${senderId}`).emit('chat_receipt_update', row);
        }
      }
    }

    res.json({ success: true, updated_count: updated?.length || 0 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Receipts read error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
