import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../supabase';
import { requireAuth } from '../middleware/auth';
import type { NotificationsReadPayload } from '@squadhub/shared';
import { getUserWorkspaceIds } from '../middleware/workspace';

// Notifications aggregate across EVERY workspace the user belongs to (Slack
// Connect model: no switching to see what's waiting). Rows from a workspace the
// user has left are excluded. `?workspace_id=` narrows to one (verified by
// requireAuth).
async function visibleWorkspaceIds(req: Request): Promise<string[]> {
  if (typeof req.query.workspace_id === 'string' && req.workspaceId) return [req.workspaceId];
  return getUserWorkspaceIds(req.userId!);
}

const router = Router();
router.use(requireAuth);

// Broadcast read-state changes to every device on the user's socket room.
// Echoed to the originator too — clients dedupe against locally-flipped ids,
// so this is a fast-forward, never a source of truth.
function emitRead(io: unknown, userId: string, payload: NotificationsReadPayload) {
  try {
    (io as any)?.to(`chat_user:${userId}`).emit('notifications_read', payload);
  } catch (err) {
    console.error('Emit notifications_read error:', err);
  }
}

// GET /notifications?unread_only=false&limit=50
router.get('/', async (req: Request, res: Response) => {
  try {
    const unreadOnly = req.query.unread_only === 'true';
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);

    let query = supabaseAdmin
      .from('notifications')
      .select('*, actor:users!notifications_actor_id_fkey(id, display_name, email, avatar_url)')
      .eq('user_id', req.userId!)
      .in('workspace_id', await visibleWorkspaceIds(req))
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
      .in('workspace_id', await visibleWorkspaceIds(req))
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
      .in('workspace_id', await visibleWorkspaceIds(req))
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ success: false, error: 'Notification not found' });
      return;
    }

    emitRead(req.app.get('io'), req.userId!, { kind: 'ids', ids: [id] });

    res.json({ success: true, data });
  } catch (err) {
    console.error('Mark notification read error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /notifications/read-conversation
// Clears a conversation's unread notifications once the user opens it — viewing
// the messages there counts as reading them. Pass dm_conversation_id for a DM,
// channel_id for a channel, or task_id for a task whose detail panel is open;
// matches on the notification's metadata, so it covers dm_received,
// message_mention, reaction_added, etc. for that conversation (including thread
// replies, which carry the same conversation id) and every task_* notification
// for that task (assigned, updated, completed, commented — they all carry
// metadata.task_id).
router.post('/read-conversation', async (req: Request, res: Response) => {
  try {
    const dmId = (req.body?.dm_conversation_id as string) || null;
    const channelId = (req.body?.channel_id as string) || null;
    const taskId = (req.body?.task_id as string) || null;
    if (!dmId && !channelId && !taskId) {
      res.status(400).json({ success: false, error: 'dm_conversation_id, channel_id or task_id required' });
      return;
    }

    const metaKey = dmId ? 'dm_conversation_id' : channelId ? 'channel_id' : 'task_id';
    const metaVal = (dmId || channelId || taskId) as string;

    const { data, error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', req.userId!)
      .in('workspace_id', await visibleWorkspaceIds(req))
      .eq('is_read', false)
      .eq(`metadata->>${metaKey}`, metaVal)
      .select('id');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const ids = (data || []).map((n) => n.id as string);
    emitRead(req.app.get('io'), req.userId!, { kind: 'ids', ids });

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
      .in('workspace_id', await visibleWorkspaceIds(_req))
      .eq('is_read', false);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    emitRead(_req.app.get('io'), _req.userId!, { kind: 'all' });

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
      .eq('user_id', req.userId!)
      .in('workspace_id', await visibleWorkspaceIds(req));

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
