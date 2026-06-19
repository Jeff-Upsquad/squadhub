import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../supabase';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// GET /notifications?unread_only=false&limit=50
router.get('/', async (req: Request, res: Response) => {
  try {
    const unreadOnly = req.query.unread_only === 'true';
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);

    let query = supabaseAdmin
      .from('notifications')
      .select('*, actor:users!notifications_actor_id_fkey(id, display_name, email, avatar_url)')
      .eq('user_id', req.userId!)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (unreadOnly) query = query.eq('is_read', false);

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('List notifications error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /notifications/unread-count
router.get('/unread-count', async (req: Request, res: Response) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId!)
      .eq('is_read', false);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data: { count: count || 0 } });
  } catch (err) {
    console.error('Unread count error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /notifications/:id/read
router.patch('/:id/read', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('user_id', req.userId!)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ success: false, error: 'Notification not found' });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Mark notification read error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /notifications/read-conversation
// Clears a conversation's unread notifications once the user opens it — viewing
// the messages there counts as reading them. Pass dm_conversation_id for a DM or
// channel_id for a channel; matches on the notification's metadata, so it covers
// dm_received, message_mention, reaction_added, etc. for that conversation
// (including thread replies, which carry the same conversation id).
router.post('/read-conversation', async (req: Request, res: Response) => {
  try {
    const dmId = (req.body?.dm_conversation_id as string) || null;
    const channelId = (req.body?.channel_id as string) || null;
    if (!dmId && !channelId) {
      res.status(400).json({ success: false, error: 'dm_conversation_id or channel_id required' });
      return;
    }

    const metaKey = dmId ? 'dm_conversation_id' : 'channel_id';
    const metaVal = (dmId || channelId) as string;

    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', req.userId!)
      .eq('is_read', false)
      .eq(`metadata->>${metaKey}`, metaVal);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Mark conversation read error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /notifications/mark-all-read
router.post('/mark-all-read', async (_req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', _req.userId!)
      .eq('is_read', false);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Mark all read error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /notifications/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { error } = await supabaseAdmin
      .from('notifications')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId!);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete notification error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
