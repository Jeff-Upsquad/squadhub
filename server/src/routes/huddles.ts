import { Router, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { checkResourceAccess, meetsAccessLevel, isWorkspaceAdmin } from '../middleware/permissions';
import { supabaseAdmin } from '../supabase';
import type { HuddleDetail, HuddleJoinCredentials, HuddleParticipant } from '@squadhub/shared';
import { config } from '../config';
import { closeRoom, isLivekitConfigured, listRoomIdentities, mintJoinToken } from '../services/livekit';

// Huddles — Slack-style calls attached to a channel / DM, on LiveKit. The
// server owns the lifecycle (one active huddle per conversation, who is in
// it, when it ends) and mints short-lived LiveKit join tokens; the media
// itself never touches this box.
//
// Presence is client-reported (join / leave endpoints) and reconciled against
// LiveKit's participant list by the sweeper in cron/huddle-cron.ts, which
// also ends huddles that have sat empty.

const router = Router();

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function newCode(): string {
  // 10 chars, URL-safe, unambiguous (no 0/O/1/l).
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function guestIdentity(): string {
  return `guest:${randomBytes(6).toString('hex')}`;
}

async function isDmParticipant(userId: string, dmId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('dm_participants')
    .select('user_id')
    .eq('conversation_id', dmId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

// Members may start/join a huddle where they could post a message.
async function canUseConversation(userId: string, channelId: string | null, dmId: string | null): Promise<boolean> {
  if (channelId) {
    const level = await checkResourceAccess(userId, 'channel', channelId);
    return !!level && meetsAccessLevel(level, 'commenter');
  }
  if (dmId) return isDmParticipant(userId, dmId);
  return false;
}

export async function buildHuddleDetail(huddleId: string): Promise<HuddleDetail | null> {
  const [{ data: huddle }, { data: parts }, { data: card }] = await Promise.all([
    supabaseAdmin.from('huddles').select('*').eq('id', huddleId).maybeSingle(),
    supabaseAdmin
      .from('huddle_participants')
      .select('*')
      .eq('huddle_id', huddleId)
      .is('left_at', null)
      .order('joined_at', { ascending: true }),
    supabaseAdmin
      .from('messages')
      .select('id')
      .eq('huddle_id', huddleId)
      .is('parent_message_id', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!huddle) return null;
  const { data: starter } = await supabaseAdmin
    .from('users')
    .select('id, display_name, avatar_url')
    .eq('id', (huddle as any).started_by)
    .maybeSingle();
  const participants = (parts || []) as HuddleParticipant[];
  return {
    huddle: huddle as any,
    starter: (starter as any) || null,
    participants,
    participant_count: participants.length,
    card_message_id: (card as any)?.id ?? null,
  };
}

export function emitHuddle(io: any, detail: HuddleDetail): void {
  if (!io) return;
  const room = detail.huddle.channel_id || detail.huddle.dm_conversation_id;
  if (room) io.to(room).emit('huddle_updated', detail);
}

// Ends a huddle: stamps ended_at, marks everyone left, tears down the LiveKit
// room. Idempotent. Shared with the sweeper.
export async function endHuddle(io: any, huddleId: string): Promise<HuddleDetail | null> {
  const now = new Date().toISOString();
  const { data: updated } = await supabaseAdmin
    .from('huddles')
    .update({ ended_at: now, updated_at: now })
    .eq('id', huddleId)
    .is('ended_at', null)
    .select('room_name')
    .maybeSingle();
  await supabaseAdmin
    .from('huddle_participants')
    .update({ left_at: now })
    .eq('huddle_id', huddleId)
    .is('left_at', null);
  if (updated && isLivekitConfigured()) await closeRoom((updated as any).room_name);
  const detail = await buildHuddleDetail(huddleId);
  if (detail) emitHuddle(io, detail);
  return detail;
}

async function upsertParticipant(
  huddleId: string,
  identity: string,
  userId: string | null,
  displayName: string,
  avatarUrl: string | null,
): Promise<void> {
  await supabaseAdmin.from('huddle_participants').upsert(
    {
      huddle_id: huddleId,
      identity,
      user_id: userId,
      display_name: displayName,
      avatar_url: avatarUrl,
      joined_at: new Date().toISOString(),
      left_at: null,
    },
    { onConflict: 'huddle_id,identity' },
  );
}

async function credentialsFor(
  huddleId: string,
  identity: string,
  name: string,
  metadata: Record<string, unknown>,
): Promise<HuddleJoinCredentials | null> {
  const detail = await buildHuddleDetail(huddleId);
  if (!detail) return null;
  const token = await mintJoinToken({ roomName: detail.huddle.room_name, identity, name, metadata });
  return { token, url: config.livekitUrl, identity, huddle: detail };
}

async function loadUser(userId: string): Promise<{ display_name: string; avatar_url: string | null }> {
  const { data } = await supabaseAdmin.from('users').select('display_name, avatar_url').eq('id', userId).maybeSingle();
  return { display_name: (data as any)?.display_name || 'Member', avatar_url: (data as any)?.avatar_url ?? null };
}

// Post the "X started a SquadUp" card into the conversation (same pattern as
// meeting poll cards — a plain message carrying a reverse reference).
async function postCard(req: Request, huddleId: string, senderId: string, channelId: string | null, dmId: string | null): Promise<void> {
  const { data: message } = await supabaseAdmin
    .from('messages')
    .insert({
      channel_id: channelId,
      dm_conversation_id: dmId,
      sender_id: senderId,
      content: '🎧 Started a SquadUp',
      type: 'text',
      huddle_id: huddleId,
      mentions: [],
    })
    .select('*, sender:users!sender_id(id, display_name, avatar_url)')
    .single();
  const io = req.app.get('io');
  const room = channelId || dmId;
  if (io && message && room) io.to(room).emit('new_message', message);
}

function requireConfigured(res: Response): boolean {
  if (isLivekitConfigured()) return true;
  res.status(503).json({ success: false, error: 'SquadUp is not configured on this server' });
  return false;
}

// ------------------------------------------------------------
// Public (no auth): share-link landing + guest join
// ------------------------------------------------------------

router.get('/public/:code', async (req: Request, res: Response) => {
  const { data: huddle } = await supabaseAdmin
    .from('huddles')
    .select('id')
    .eq('code', req.params.code as string)
    .maybeSingle();
  if (!huddle) {
    res.status(404).json({ success: false, error: 'SquadUp not found' });
    return;
  }
  const detail = await buildHuddleDetail((huddle as any).id);
  // Guests only see what the landing page needs — no ids beyond the code.
  res.json({
    success: true,
    data: detail && {
      // The id lets a signed-in visitor take the member path (/huddles/:id/join),
      // which still enforces conversation membership.
      id: detail.huddle.id,
      code: detail.huddle.code,
      topic: detail.huddle.topic,
      started_at: detail.huddle.started_at,
      ended_at: detail.huddle.ended_at,
      allow_guests: detail.huddle.allow_guests,
      starter_name: detail.starter?.display_name ?? null,
      participant_count: detail.participant_count,
      participants: detail.participants.map((p) => ({ display_name: p.display_name, avatar_url: p.avatar_url })),
    },
  });
});

router.post('/public/:code/join', async (req: Request, res: Response) => {
  try {
    if (!requireConfigured(res)) return;
    const body = z.object({ name: z.string().trim().min(1).max(40) }).parse(req.body);
    const { data: huddle } = await supabaseAdmin
      .from('huddles')
      .select('id, ended_at, allow_guests')
      .eq('code', req.params.code as string)
      .maybeSingle();
    if (!huddle) {
      res.status(404).json({ success: false, error: 'SquadUp not found' });
      return;
    }
    if ((huddle as any).ended_at) {
      res.status(410).json({ success: false, error: 'This SquadUp has ended' });
      return;
    }
    if (!(huddle as any).allow_guests) {
      res.status(403).json({ success: false, error: 'Guests are not allowed in this SquadUp' });
      return;
    }
    const huddleId = (huddle as any).id as string;
    const identity = guestIdentity();
    await upsertParticipant(huddleId, identity, null, body.name, null);
    const creds = await credentialsFor(huddleId, identity, body.name, { guest: true });
    const io = req.app.get('io');
    if (creds) emitHuddle(io, creds.huddle);
    res.json({ success: true, data: creds });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ success: false, error: err.errors });
      return;
    }
    console.error('Guest huddle join error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Guests leave by identity (the guest page has no auth token). Last one out
// ends the huddle, same as members.
router.post('/public/:code/leave', async (req: Request, res: Response) => {
  const body = z.object({ identity: z.string().startsWith('guest:') }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ success: false, error: 'identity required' });
    return;
  }
  const { data: huddle } = await supabaseAdmin.from('huddles').select('id').eq('code', req.params.code as string).maybeSingle();
  if (!huddle) {
    res.status(404).json({ success: false, error: 'SquadUp not found' });
    return;
  }
  const huddleId = (huddle as any).id as string;
  await supabaseAdmin
    .from('huddle_participants')
    .update({ left_at: new Date().toISOString() })
    .eq('huddle_id', huddleId)
    .eq('identity', body.data.identity)
    .is('left_at', null);
  let detail = await buildHuddleDetail(huddleId);
  if (detail && !detail.huddle.ended_at && detail.participant_count === 0) detail = await endHuddle(req.app.get('io'), huddleId);
  else if (detail) emitHuddle(req.app.get('io'), detail);
  res.json({ success: true });
});

// ------------------------------------------------------------
// Authenticated
// ------------------------------------------------------------
router.use(requireAuth);

router.get('/config', (_req: Request, res: Response) => {
  res.json({ success: true, data: { enabled: isLivekitConfigured() } });
});

// GET /huddles/active?channel_id= | dm_conversation_id=  → the live huddle
// for that conversation (or null). Drives the header pill.
router.get('/active', async (req: Request, res: Response) => {
  const channelId = (req.query.channel_id as string) || null;
  const dmId = (req.query.dm_conversation_id as string) || null;
  if (!channelId && !dmId) {
    res.status(400).json({ success: false, error: 'channel_id or dm_conversation_id required' });
    return;
  }
  if (!(await canUseConversation(req.userId!, channelId, dmId))) {
    res.status(403).json({ success: false, error: 'No access to this conversation' });
    return;
  }
  let q = supabaseAdmin.from('huddles').select('id').is('ended_at', null);
  q = channelId ? q.eq('channel_id', channelId) : q.eq('dm_conversation_id', dmId as string);
  const { data } = await q.maybeSingle();
  const detail = data ? await buildHuddleDetail((data as any).id) : null;
  res.json({ success: true, data: detail });
});

// POST /huddles — start (or hop into the already-live) huddle for a
// conversation. Returns join credentials so the starter is in immediately.
router.post('/', async (req: Request, res: Response) => {
  try {
    if (!requireConfigured(res)) return;
    const body = z
      .object({
        channel_id: z.string().uuid().optional(),
        dm_conversation_id: z.string().uuid().optional(),
        topic: z.string().trim().max(120).optional(),
      })
      .refine((b) => !!b.channel_id !== !!b.dm_conversation_id, { message: 'Exactly one of channel_id / dm_conversation_id' })
      .parse(req.body);
    const userId = req.userId!;
    const channelId = body.channel_id ?? null;
    const dmId = body.dm_conversation_id ?? null;
    if (!(await canUseConversation(userId, channelId, dmId))) {
      res.status(403).json({ success: false, error: 'No access to this conversation' });
      return;
    }

    // Already live? Join that one instead of racing the unique index.
    let existing = supabaseAdmin.from('huddles').select('id').is('ended_at', null);
    existing = channelId ? existing.eq('channel_id', channelId) : existing.eq('dm_conversation_id', dmId as string);
    const { data: live } = await existing.maybeSingle();

    let huddleId: string;
    if (live) {
      huddleId = (live as any).id;
    } else {
      const { data: created, error } = await supabaseAdmin
        .from('huddles')
        .insert({
          code: newCode(),
          room_name: `huddle-${randomBytes(8).toString('hex')}`,
          channel_id: channelId,
          dm_conversation_id: dmId,
          topic: body.topic || null,
          started_by: userId,
        })
        .select('id')
        .single();
      if (error || !created) {
        // Unique-index race: someone started it a moment ago — fall through to join.
        const { data: again } = await (channelId
          ? supabaseAdmin.from('huddles').select('id').is('ended_at', null).eq('channel_id', channelId)
          : supabaseAdmin.from('huddles').select('id').is('ended_at', null).eq('dm_conversation_id', dmId as string)
        ).maybeSingle();
        if (!again) {
          res.status(500).json({ success: false, error: error?.message || 'Could not start SquadUp' });
          return;
        }
        huddleId = (again as any).id;
      } else {
        huddleId = (created as any).id;
        await postCard(req, huddleId, userId, channelId, dmId);
      }
    }

    const me = await loadUser(userId);
    const identity = `user:${userId}`;
    await upsertParticipant(huddleId, identity, userId, me.display_name, me.avatar_url);
    const creds = await credentialsFor(huddleId, identity, me.display_name, { user_id: userId, avatar_url: me.avatar_url });
    if (creds) emitHuddle(req.app.get('io'), creds.huddle);
    res.status(201).json({ success: true, data: creds });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ success: false, error: err.errors });
      return;
    }
    console.error('Start huddle error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Loads the huddle and checks the caller may see it (conversation member).
async function loadAccessible(req: Request, res: Response): Promise<{ id: string; channel_id: string | null; dm_conversation_id: string | null; ended_at: string | null; started_by: string; room_name: string } | null> {
  const { data: huddle } = await supabaseAdmin
    .from('huddles')
    .select('id, channel_id, dm_conversation_id, ended_at, started_by, room_name')
    .eq('id', req.params.id as string)
    .maybeSingle();
  if (!huddle) {
    res.status(404).json({ success: false, error: 'SquadUp not found' });
    return null;
  }
  const h = huddle as any;
  if (!(await canUseConversation(req.userId!, h.channel_id, h.dm_conversation_id))) {
    res.status(403).json({ success: false, error: 'No access to this SquadUp' });
    return null;
  }
  return h;
}

router.get('/:id', async (req: Request, res: Response) => {
  const h = await loadAccessible(req, res);
  if (!h) return;
  res.json({ success: true, data: await buildHuddleDetail(h.id) });
});

router.post('/:id/join', async (req: Request, res: Response) => {
  if (!requireConfigured(res)) return;
  const h = await loadAccessible(req, res);
  if (!h) return;
  if (h.ended_at) {
    res.status(410).json({ success: false, error: 'This SquadUp has ended' });
    return;
  }
  const userId = req.userId!;
  const me = await loadUser(userId);
  const identity = `user:${userId}`;
  await upsertParticipant(h.id, identity, userId, me.display_name, me.avatar_url);
  const creds = await credentialsFor(h.id, identity, me.display_name, { user_id: userId, avatar_url: me.avatar_url });
  if (creds) emitHuddle(req.app.get('io'), creds.huddle);
  res.json({ success: true, data: creds });
});

// Leaving as the last person ends the huddle (the sweeper is the backstop for
// tabs that vanish without calling this).
router.post('/:id/leave', async (req: Request, res: Response) => {
  const h = await loadAccessible(req, res);
  if (!h) return;
  await supabaseAdmin
    .from('huddle_participants')
    .update({ left_at: new Date().toISOString() })
    .eq('huddle_id', h.id)
    .eq('identity', `user:${req.userId!}`)
    .is('left_at', null);
  let detail = await buildHuddleDetail(h.id);
  if (detail && !detail.huddle.ended_at && detail.participant_count === 0) {
    detail = await endHuddle(req.app.get('io'), h.id);
  } else if (detail) {
    emitHuddle(req.app.get('io'), detail);
  }
  res.json({ success: true, data: detail });
});

router.post('/:id/end', async (req: Request, res: Response) => {
  const h = await loadAccessible(req, res);
  if (!h) return;
  if (h.started_by !== req.userId && !(await isWorkspaceAdmin(req.userId!))) {
    res.status(403).json({ success: false, error: 'Only the person who started the SquadUp can end it for everyone' });
    return;
  }
  res.json({ success: true, data: await endHuddle(req.app.get('io'), h.id) });
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const h = await loadAccessible(req, res);
    if (!h) return;
    const patch = z
      .object({ topic: z.string().trim().max(120).nullable().optional(), allow_guests: z.boolean().optional() })
      .parse(req.body);
    await supabaseAdmin
      .from('huddles')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', h.id);
    const detail = await buildHuddleDetail(h.id);
    if (detail) emitHuddle(req.app.get('io'), detail);
    res.json({ success: true, data: detail });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ success: false, error: err.errors });
      return;
    }
    console.error('Patch huddle error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Reconcile DB presence with LiveKit's own participant list. Marks rows left
// when LiveKit no longer sees the identity (tab crashed, network died) and
// ends huddles that have been empty for a while. Called by the sweeper.
export async function reconcileHuddles(io: any): Promise<void> {
  if (!isLivekitConfigured()) return;
  const { data: live } = await supabaseAdmin
    .from('huddles')
    .select('id, room_name, started_at')
    .is('ended_at', null);
  for (const h of (live || []) as any[]) {
    const identities = await listRoomIdentities(h.room_name);
    if (identities === null) continue; // LiveKit unreachable — leave state alone
    const connected = new Set(identities);
    const { data: rows } = await supabaseAdmin
      .from('huddle_participants')
      .select('id, identity, joined_at')
      .eq('huddle_id', h.id)
      .is('left_at', null);
    const graceMs = 45_000; // allow a freshly-issued token time to connect
    const now = Date.now();
    const stale = ((rows || []) as any[]).filter(
      (r) => !connected.has(r.identity) && now - Date.parse(r.joined_at) > graceMs,
    );
    if (stale.length) {
      await supabaseAdmin
        .from('huddle_participants')
        .update({ left_at: new Date().toISOString() })
        .in('id', stale.map((r) => r.id));
    }
    const remaining = ((rows || []) as any[]).length - stale.length;
    const ageMs = now - Date.parse(h.started_at);
    if (remaining === 0 && connected.size === 0 && ageMs > graceMs) {
      await endHuddle(io, h.id);
    } else if (stale.length) {
      const detail = await buildHuddleDetail(h.id);
      if (detail) emitHuddle(io, detail);
    }
  }
}

export default router;
