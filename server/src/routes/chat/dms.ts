import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { loadChatContext, requireTeamVariant } from '../../middleware/chat';
import { supabaseAdmin } from '../../supabase-chat';

const router = Router();

// DMs are team-only. All endpoints 403 for client/client_staff.
router.use(requireAuth, loadChatContext, requireTeamVariant);

// Canonicalize a pair so (a,b) and (b,a) map to the same row.
function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

// GET /chat/dms — list conversations, sorted by last_message_at DESC
router.get('/', async (req: Request, res: Response) => {
  const { data: convs, error } = await supabaseAdmin
    .from('chat_dm_conversations')
    .select('id, user1_id, user2_id, last_message_at, created_at, ' +
      'user1:users!user1_id(id, display_name, avatar_url, user_type, is_admin), ' +
      'user2:users!user2_id(id, display_name, avatar_url, user_type, is_admin)')
    .or(`user1_id.eq.${req.userId},user2_id.eq.${req.userId}`)
    .order('last_message_at', { ascending: false, nullsFirst: false });

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  // Hydrate each with unread count + last message + other_user.
  const hydrated = [];
  for (const c of convs || []) {
    const other = c.user1_id === req.userId ? (c as any).user2 : (c as any).user1;

    const { data: lastMsg } = await supabaseAdmin
      .from('chat_messages')
      .select('id, sender_id, content, type, file_url, created_at, deleted_at')
      .eq('dm_conversation_id', c.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: msgIds } = await supabaseAdmin
      .from('chat_messages')
      .select('id')
      .eq('dm_conversation_id', c.id)
      .is('deleted_at', null);

    const ids = (msgIds || []).map((m: any) => m.id);
    let unreadCount = 0;
    if (ids.length > 0) {
      const { count } = await supabaseAdmin
        .from('chat_message_receipts')
        .select('message_id', { head: true, count: 'exact' })
        .in('message_id', ids)
        .eq('user_id', req.userId!)
        .is('read_at', null);
      unreadCount = count || 0;
    }

    hydrated.push({
      id: c.id,
      user1_id: c.user1_id,
      user2_id: c.user2_id,
      last_message_at: c.last_message_at,
      created_at: c.created_at,
      other_user: other,
      last_message: lastMsg || null,
      unread_count: unreadCount,
    });
  }

  res.json({ success: true, data: hydrated });
});

const createDmSchema = z.object({
  other_user_id: z.string().uuid(),
});

// POST /chat/dms — open a DM; partner<->internal/admin enforced by trigger.
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createDmSchema.parse(req.body);
    if (body.other_user_id === req.userId) {
      res.status(400).json({ success: false, error: 'Cannot DM yourself' });
      return;
    }

    const [u1, u2] = orderPair(req.userId!, body.other_user_id);

    // Try finding an existing row first.
    const { data: existing } = await supabaseAdmin
      .from('chat_dm_conversations')
      .select('*')
      .eq('user1_id', u1)
      .eq('user2_id', u2)
      .maybeSingle();

    if (existing) {
      res.json({ success: true, data: existing });
      return;
    }

    const { data: created, error } = await supabaseAdmin
      .from('chat_dm_conversations')
      .insert({ user1_id: u1, user2_id: u2 })
      .select()
      .single();

    if (error) {
      const msg = (error.message || '').includes('partner')
        ? 'DMs are only allowed between partners and internal/admin users.'
        : error.message;
      res.status(400).json({ success: false, error: msg });
      return;
    }

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create DM error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /chat/dms/contacts — candidates for new DMs (opposite side of the divide)
router.get('/contacts', async (req: Request, res: Response) => {
  // Determine user's own side.
  const { data: me } = await supabaseAdmin
    .from('users')
    .select('user_type, is_admin')
    .eq('id', req.userId!)
    .single();
  if (!me) {
    res.status(404).json({ success: false, error: 'User not found' });
    return;
  }

  let query = supabaseAdmin
    .from('users')
    .select('id, display_name, avatar_url, user_type, is_admin')
    .eq('status', 'active')
    .neq('id', req.userId!);

  if (me.user_type === 'partner') {
    // partner -> contacts are internal users + any admin
    query = query.or('user_type.eq.internal,is_admin.eq.true');
  } else {
    // internal / admin -> contacts are partners
    query = query.eq('user_type', 'partner');
  }

  const { data, error } = await query.order('display_name');
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.json({ success: true, data });
});

export default router;
