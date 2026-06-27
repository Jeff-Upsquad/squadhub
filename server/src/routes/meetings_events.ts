import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { checkResourceAccess, meetsAccessLevel } from '../middleware/permissions';
import { supabaseAdmin } from '../supabase';
import type {
  MeetingEventDetail,
  MeetingGuest,
  MeetingSlot,
  MeetingSlotSummary,
  MeetingVoterRef,
  MeetingVoteValue,
  NotificationType,
} from '@squadhub/shared';
import { availableProviders, generateMeetingLink } from '../services/meetingProviders';

const router = Router();
router.use(requireAuth);

const MAX_GUESTS = 200;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

// A best-effort ISO start for the Meet/Zoom adapters (which encode a time).
// We treat the meeting-local wall time as the instant — a small offset versus
// the true zone, acceptable because Jitsi (the default) ignores it and the
// link is regenerated against the locked slot on confirm.
function slotStartIso(slot: { slot_date: string; start_min: number | null }): string | null {
  if (slot.start_min == null) return null;
  const h = Math.floor(slot.start_min / 60);
  const m = slot.start_min % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${slot.slot_date}T${pad(h)}:${pad(m)}:00.000Z`;
}

async function isParticipant(meetingId: string, userId: string): Promise<boolean> {
  const { data: ev } = await supabaseAdmin
    .from('meeting_events')
    .select('created_by')
    .eq('id', meetingId)
    .maybeSingle();
  if (!ev) return false;
  if ((ev as any).created_by === userId) return true;
  const { data: g } = await supabaseAdmin
    .from('meeting_event_guests')
    .select('user_id')
    .eq('meeting_event_id', meetingId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!g;
}

// Gate routes that a guest reaching the meeting only via an in-chat card must be
// able to hit (vote/suggest/respond/detail) — participation, NOT the mini-app grant.
function requireMeetingParticipant() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ok = await isParticipant((req.params.id as string), req.userId!);
    if (!ok) {
      res.status(403).json({ success: false, error: 'Not a participant of this meeting' });
      return;
    }
    next();
  };
}

async function isHost(meetingId: string, userId: string): Promise<boolean> {
  const { data: ev } = await supabaseAdmin
    .from('meeting_events')
    .select('created_by')
    .eq('id', meetingId)
    .maybeSingle();
  return !!ev && (ev as any).created_by === userId;
}

type UserRow = { id: string; display_name: string | null; avatar_url: string | null };

function refOf(map: Map<string, UserRow>, userId: string): MeetingVoterRef {
  const u = map.get(userId);
  return { user_id: userId, display_name: u?.display_name ?? null, avatar_url: u?.avatar_url ?? null };
}

// Assemble the full detail payload the UI renders (and the socket pushes).
async function buildDetail(meetingId: string, viewerId: string): Promise<MeetingEventDetail | null> {
  const { data: event } = await supabaseAdmin
    .from('meeting_events')
    .select('*')
    .eq('id', meetingId)
    .maybeSingle();
  if (!event) return null;

  const [{ data: slots }, { data: guests }, { data: attachments }] = await Promise.all([
    supabaseAdmin
      .from('meeting_event_slots')
      .select('*')
      .eq('meeting_event_id', meetingId)
      .order('sort_order', { ascending: true })
      .order('slot_date', { ascending: true }),
    supabaseAdmin
      .from('meeting_event_guests')
      .select('*, user:users!user_id(id, display_name, avatar_url)')
      .eq('meeting_event_id', meetingId),
    supabaseAdmin.from('meeting_event_attachments').select('*').eq('meeting_event_id', meetingId),
  ]);

  const slotRows = (slots || []) as MeetingSlot[];
  const slotIds = slotRows.map((s) => s.id);
  const suggestionSlotIds = slotRows.filter((s) => s.is_suggestion).map((s) => s.id);

  const [{ data: votes }, { data: responses }] = await Promise.all([
    slotIds.length
      ? supabaseAdmin.from('meeting_slot_votes').select('slot_id, user_id, vote').in('slot_id', slotIds)
      : Promise.resolve({ data: [] as any[] }),
    suggestionSlotIds.length
      ? supabaseAdmin
          .from('meeting_suggestion_responses')
          .select('slot_id, user_id, response')
          .in('slot_id', suggestionSlotIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  // User lookup map: start from guests, then fill any stragglers (voters,
  // suggesters) not present as guests.
  const userMap = new Map<string, UserRow>();
  for (const g of (guests || []) as any[]) {
    if (g.user) userMap.set(g.user.id, g.user as UserRow);
  }
  const missing = new Set<string>();
  for (const v of (votes || []) as any[]) if (!userMap.has(v.user_id)) missing.add(v.user_id);
  for (const r of (responses || []) as any[]) if (!userMap.has(r.user_id)) missing.add(r.user_id);
  for (const s of slotRows) if (s.suggested_by && !userMap.has(s.suggested_by)) missing.add(s.suggested_by);
  if (missing.size) {
    const { data: extra } = await supabaseAdmin
      .from('users')
      .select('id, display_name, avatar_url')
      .in('id', Array.from(missing));
    for (const u of (extra || []) as UserRow[]) userMap.set(u.id, u);
  }

  const votesBySlot = new Map<string, { user_id: string; vote: MeetingVoteValue }[]>();
  for (const v of (votes || []) as any[]) {
    const arr = votesBySlot.get(v.slot_id) || [];
    arr.push({ user_id: v.user_id, vote: v.vote });
    votesBySlot.set(v.slot_id, arr);
  }
  const respBySlot = new Map<string, { user_id: string; response: 'confirm' | 'reject' }[]>();
  for (const r of (responses || []) as any[]) {
    const arr = respBySlot.get(r.slot_id) || [];
    arr.push({ user_id: r.user_id, response: r.response });
    respBySlot.set(r.slot_id, arr);
  }

  const slotSummaries: MeetingSlotSummary[] = slotRows.map((slot) => {
    const sv = votesBySlot.get(slot.id) || [];
    const counts = { yes: 0, no: 0, maybe: 0 };
    const voters = { yes: [] as MeetingVoterRef[], no: [] as MeetingVoterRef[], maybe: [] as MeetingVoterRef[] };
    let myVote: MeetingVoteValue | null = null;
    for (const v of sv) {
      counts[v.vote]++;
      voters[v.vote].push(refOf(userMap, v.user_id));
      if (v.user_id === viewerId) myVote = v.vote;
    }
    const summary: MeetingSlotSummary = { slot, counts, voters, my_vote: myVote };
    if (slot.is_suggestion) {
      const rr = respBySlot.get(slot.id) || [];
      summary.suggestion = {
        status: slot.suggestion_status ?? 'pending',
        suggested_by: slot.suggested_by ? refOf(userMap, slot.suggested_by) : null,
        confirms: rr.filter((r) => r.response === 'confirm').map((r) => refOf(userMap, r.user_id)),
        rejects: rr.filter((r) => r.response === 'reject').map((r) => refOf(userMap, r.user_id)),
        my_response: rr.find((r) => r.user_id === viewerId)?.response ?? null,
      };
    }
    return summary;
  });

  const guestDtos: MeetingGuest[] = ((guests || []) as any[]).map((g) => ({
    meeting_event_id: g.meeting_event_id,
    user_id: g.user_id,
    role: g.role,
    responded: g.responded,
    invited_at: g.invited_at,
    user: g.user || undefined,
  }));

  return {
    event: event as any,
    slots: slotSummaries,
    guests: guestDtos,
    attachments: (attachments || []) as any,
  };
}

function emit(req: Request, detail: MeetingEventDetail): void {
  const io = req.app.get('io');
  if (io) io.to(`meeting:${detail.event.id}`).emit('meeting_event_updated', detail);
}

async function notify(
  rows: { user_id: string; type: NotificationType; title: string; body?: string }[],
  meetingId: string,
  actorId: string,
): Promise<void> {
  const filtered = rows.filter((r) => r.user_id !== actorId);
  if (!filtered.length) return;
  await supabaseAdmin.from('notifications').insert(
    filtered.map((r) => ({
      user_id: r.user_id,
      type: r.type,
      reference_id: meetingId,
      reference_type: 'meeting_event',
      actor_id: actorId,
      title: r.title,
      body: r.body ?? null,
      metadata: { meeting_event_id: meetingId },
    })),
  );
}

async function markResponded(meetingId: string, userId: string): Promise<void> {
  await supabaseAdmin
    .from('meeting_event_guests')
    .update({ responded: true })
    .eq('meeting_event_id', meetingId)
    .eq('user_id', userId);
}

// ------------------------------------------------------------
// GET /meeting-events/providers — configured link providers (dropdown)
// ------------------------------------------------------------
router.get('/providers', (_req: Request, res: Response) => {
  res.json({ success: true, data: availableProviders() });
});

// ------------------------------------------------------------
// GET /meeting-events/my — meetings the caller created or is invited to
// ------------------------------------------------------------
router.get('/my', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { data: guestRows } = await supabaseAdmin
      .from('meeting_event_guests')
      .select('meeting_event_id')
      .eq('user_id', userId);
    const ids = new Set<string>(((guestRows || []) as any[]).map((g) => g.meeting_event_id));

    const { data: created } = await supabaseAdmin
      .from('meeting_events')
      .select('id')
      .eq('created_by', userId);
    for (const c of (created || []) as any[]) ids.add(c.id);

    if (ids.size === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const { data: events, error } = await supabaseAdmin
      .from('meeting_events')
      .select('*')
      .in('id', Array.from(ids))
      .order('created_at', { ascending: false });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: events });
  } catch (err) {
    console.error('List my meeting-events error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /meeting-events — create a meeting (any authenticated user; the creator
// becomes the host). Resolves @all from the origin channel/DM, generates the
// link, optionally posts the in-chat card.
// ------------------------------------------------------------
const slotInput = z.object({
  slot_date: z.string(), // YYYY-MM-DD
  start_min: z.number().int().min(0).max(1439).nullable().optional(),
});
const createSchema = z.object({
  title: z.string().min(1),
  kind: z.enum(['virtual', 'in_person', 'event']).default('virtual'),
  agenda: z.string().optional(),
  duration_min: z.number().int().positive().nullable().optional(),
  timezone: z.string().optional(),
  guest_ids: z.array(z.string().uuid()).default([]),
  include_all_channel: z.boolean().optional(),
  origin_channel_id: z.string().uuid().nullable().optional(),
  origin_dm_conversation_id: z.string().uuid().nullable().optional(),
  link_provider: z.enum(['jitsi', 'google_meet', 'zoom']).optional(),
  slots: z.array(slotInput).min(1),
  attachments: z
    .array(
      z.object({
        file_url: z.string(),
        file_name: z.string().optional(),
        file_size: z.number().optional(),
        file_mime: z.string().optional(),
      }),
    )
    .optional(),
  post_card: z.boolean().optional(),
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const body = createSchema.parse(req.body);

    // Resolve the guest set (creator is added as host below).
    const guestSet = new Set<string>(body.guest_ids);
    if (body.include_all_channel && body.origin_channel_id) {
      const { data: members } = await supabaseAdmin
        .from('resource_memberships')
        .select('user_id')
        .eq('resource_type', 'channel')
        .eq('resource_id', body.origin_channel_id);
      for (const m of (members || []) as any[]) guestSet.add(m.user_id);
    }
    if (body.origin_dm_conversation_id) {
      const { data: parts } = await supabaseAdmin
        .from('dm_participants')
        .select('user_id')
        .eq('conversation_id', body.origin_dm_conversation_id);
      for (const p of (parts || []) as any[]) guestSet.add(p.user_id);
    }
    guestSet.delete(userId); // creator handled separately as host
    if (guestSet.size > MAX_GUESTS) {
      res.status(400).json({ success: false, error: `Too many guests (max ${MAX_GUESTS})` });
      return;
    }

    // Insert the event first so we have an id for the deterministic Jitsi link.
    const { data: event, error: evErr } = await supabaseAdmin
      .from('meeting_events')
      .insert({
        title: body.title,
        kind: body.kind,
        agenda: body.agenda ?? null,
        duration_min: body.duration_min ?? null,
        timezone: body.timezone || 'Asia/Kolkata',
        origin_channel_id: body.origin_channel_id ?? null,
        origin_dm_conversation_id: body.origin_dm_conversation_id ?? null,
        created_by: userId,
      })
      .select('*')
      .single();
    if (evErr || !event) {
      res.status(500).json({ success: false, error: evErr?.message || 'Insert failed' });
      return;
    }
    const meetingId = (event as any).id as string;

    // Slots: end_min derived from duration for timed slots.
    const slotRows = body.slots.map((s, i) => {
      const start = s.start_min ?? null;
      const end = start != null && body.duration_min ? start + body.duration_min : null;
      return {
        meeting_event_id: meetingId,
        slot_date: s.slot_date,
        start_min: start,
        end_min: end,
        sort_order: i,
      };
    });
    await supabaseAdmin.from('meeting_event_slots').insert(slotRows);

    // Guests (host + invitees).
    const guestRows = [
      { meeting_event_id: meetingId, user_id: userId, role: 'host' as const },
      ...Array.from(guestSet).map((uid) => ({
        meeting_event_id: meetingId,
        user_id: uid,
        role: 'guest' as const,
      })),
    ];
    await supabaseAdmin.from('meeting_event_guests').insert(guestRows);

    // Attachments.
    if (body.attachments?.length) {
      await supabaseAdmin.from('meeting_event_attachments').insert(
        body.attachments.map((a) => ({
          meeting_event_id: meetingId,
          file_url: a.file_url,
          file_name: a.file_name ?? null,
          file_size: a.file_size ?? null,
          file_mime: a.file_mime ?? null,
          uploaded_by: userId,
        })),
      );
    }

    // Auto-generate the video link (virtual only). Representative start = first
    // timed slot, if any.
    if (body.kind === 'virtual') {
      const firstTimed = body.slots.find((s) => s.start_min != null) ?? null;
      const link = await generateMeetingLink(body.link_provider ?? 'jitsi', {
        meetingEventId: meetingId,
        title: body.title,
        createdBy: userId,
        startsAt: firstTimed ? slotStartIso({ slot_date: firstTimed.slot_date, start_min: firstTimed.start_min ?? null }) : null,
        durationMin: body.duration_min ?? null,
      });
      await supabaseAdmin
        .from('meeting_events')
        .update({ link_provider: link.provider, link_url: link.url, link_meta: link.meta })
        .eq('id', meetingId);
    }

    // Notify invited guests.
    await notify(
      Array.from(guestSet).map((uid) => ({
        user_id: uid,
        type: 'meeting_invited' as NotificationType,
        title: `You're invited to "${body.title}"`,
      })),
      meetingId,
      userId,
    );

    // Optionally post the interactive card into the origin conversation.
    if (body.post_card && (body.origin_channel_id || body.origin_dm_conversation_id)) {
      await postCard(req, meetingId, userId, body.origin_channel_id ?? null, body.origin_dm_conversation_id ?? null, body.title);
    }

    const detail = await buildDetail(meetingId, userId);
    res.status(201).json({ success: true, data: detail });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ success: false, error: err.errors });
      return;
    }
    console.error('Create meeting-event error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// GET /meeting-events/:id — full detail (participant)
// ------------------------------------------------------------
router.get('/:id', requireMeetingParticipant(), async (req: Request, res: Response) => {
  const detail = await buildDetail((req.params.id as string), req.userId!);
  if (!detail) {
    res.status(404).json({ success: false, error: 'Meeting not found' });
    return;
  }
  res.json({ success: true, data: detail });
});

// ------------------------------------------------------------
// PATCH /meeting-events/:id — edit title/agenda/kind while open (host)
// ------------------------------------------------------------
router.patch('/:id', requireMeetingParticipant(), async (req: Request, res: Response) => {
  try {
    const meetingId = (req.params.id as string);
    if (!(await isHost(meetingId, req.userId!))) {
      res.status(403).json({ success: false, error: 'Only the host can edit' });
      return;
    }
    const patch = z
      .object({ title: z.string().min(1).optional(), agenda: z.string().nullable().optional() })
      .parse(req.body);
    await supabaseAdmin
      .from('meeting_events')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', meetingId)
      .eq('status', 'open');
    const detail = await buildDetail(meetingId, req.userId!);
    if (detail) emit(req, detail);
    res.json({ success: true, data: detail });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ success: false, error: err.errors });
      return;
    }
    console.error('Patch meeting-event error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /meeting-events/:id/guests — invite more people (host)
// ------------------------------------------------------------
router.post('/:id/guests', requireMeetingParticipant(), async (req: Request, res: Response) => {
  try {
    const meetingId = (req.params.id as string);
    if (!(await isHost(meetingId, req.userId!))) {
      res.status(403).json({ success: false, error: 'Only the host can invite' });
      return;
    }
    const { guest_ids } = z.object({ guest_ids: z.array(z.string().uuid()).min(1) }).parse(req.body);
    const { data: ev } = await supabaseAdmin.from('meeting_events').select('title').eq('id', meetingId).maybeSingle();
    await supabaseAdmin
      .from('meeting_event_guests')
      .upsert(
        guest_ids.map((uid) => ({ meeting_event_id: meetingId, user_id: uid, role: 'guest' as const })),
        { onConflict: 'meeting_event_id,user_id', ignoreDuplicates: true },
      );
    await notify(
      guest_ids.map((uid) => ({
        user_id: uid,
        type: 'meeting_invited' as NotificationType,
        title: `You're invited to "${(ev as any)?.title ?? 'a meeting'}"`,
      })),
      meetingId,
      req.userId!,
    );
    const detail = await buildDetail(meetingId, req.userId!);
    if (detail) emit(req, detail);
    res.json({ success: true, data: detail });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ success: false, error: err.errors });
      return;
    }
    console.error('Invite guests error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /meeting-events/:id/slots/:slotId/vote — Yes / No / Maybe
// ------------------------------------------------------------
router.post('/:id/slots/:slotId/vote', requireMeetingParticipant(), async (req: Request, res: Response) => {
  try {
    const meetingId = (req.params.id as string);
    const { vote } = z.object({ vote: z.enum(['yes', 'no', 'maybe']) }).parse(req.body);
    const now = new Date().toISOString();
    await supabaseAdmin
      .from('meeting_slot_votes')
      .upsert(
        { slot_id: (req.params.slotId as string), user_id: req.userId!, vote, updated_at: now },
        { onConflict: 'slot_id,user_id' },
      );
    await markResponded(meetingId, req.userId!);
    const detail = await buildDetail(meetingId, req.userId!);
    if (detail) emit(req, detail);
    res.json({ success: true, data: detail });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ success: false, error: err.errors });
      return;
    }
    console.error('Vote error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /meeting-events/:id/suggest — propose an alternate slot
// ------------------------------------------------------------
router.post('/:id/suggest', requireMeetingParticipant(), async (req: Request, res: Response) => {
  try {
    const meetingId = (req.params.id as string);
    const userId = req.userId!;
    const input = z
      .object({
        slot_date: z.string(),
        start_min: z.number().int().min(0).max(1439).nullable().optional(),
        end_min: z.number().int().min(0).max(1439).nullable().optional(),
      })
      .parse(req.body);

    const { data: maxRow } = await supabaseAdmin
      .from('meeting_event_slots')
      .select('sort_order')
      .eq('meeting_event_id', meetingId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrder = ((maxRow as any)?.sort_order ?? 0) + 1;

    await supabaseAdmin.from('meeting_event_slots').insert({
      meeting_event_id: meetingId,
      slot_date: input.slot_date,
      start_min: input.start_min ?? null,
      end_min: input.end_min ?? null,
      is_suggestion: true,
      suggested_by: userId,
      suggestion_status: 'pending',
      sort_order: nextOrder,
    });
    await markResponded(meetingId, userId);

    // Notify the host + other guests that a new time was suggested.
    const { data: ev } = await supabaseAdmin
      .from('meeting_events')
      .select('title')
      .eq('id', meetingId)
      .maybeSingle();
    const { data: guests } = await supabaseAdmin
      .from('meeting_event_guests')
      .select('user_id')
      .eq('meeting_event_id', meetingId);
    await notify(
      ((guests || []) as any[]).map((g) => ({
        user_id: g.user_id,
        type: 'meeting_suggestion' as NotificationType,
        title: `New time suggested for "${(ev as any)?.title ?? 'a meeting'}"`,
      })),
      meetingId,
      userId,
    );

    const detail = await buildDetail(meetingId, userId);
    if (detail) emit(req, detail);
    res.status(201).json({ success: true, data: detail });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ success: false, error: err.errors });
      return;
    }
    console.error('Suggest error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /meeting-events/:id/slots/:slotId/suggestion-response — confirm/reject.
// Per-attendee responses are advisory; the HOST's confirm promotes the
// suggestion to a real votable slot (accepted), a host reject kills it.
// ------------------------------------------------------------
router.post(
  '/:id/slots/:slotId/suggestion-response',
  requireMeetingParticipant(),
  async (req: Request, res: Response) => {
    try {
      const meetingId = (req.params.id as string);
      const slotId = (req.params.slotId as string);
      const userId = req.userId!;
      const { response } = z.object({ response: z.enum(['confirm', 'reject']) }).parse(req.body);

      await supabaseAdmin
        .from('meeting_suggestion_responses')
        .upsert({ slot_id: slotId, user_id: userId, response }, { onConflict: 'slot_id,user_id' });

      let resolved: 'accepted' | 'rejected' | null = null;
      if (await isHost(meetingId, userId)) {
        const newStatus = response === 'confirm' ? 'accepted' : 'rejected';
        // Accepting promotes it to an ordinary votable slot.
        await supabaseAdmin
          .from('meeting_event_slots')
          .update({
            suggestion_status: newStatus,
            is_suggestion: newStatus === 'accepted' ? false : true,
          })
          .eq('id', slotId);
        resolved = newStatus;
      }

      if (resolved) {
        const { data: slot } = await supabaseAdmin
          .from('meeting_event_slots')
          .select('suggested_by')
          .eq('id', slotId)
          .maybeSingle();
        const { data: ev } = await supabaseAdmin
          .from('meeting_events')
          .select('title')
          .eq('id', meetingId)
          .maybeSingle();
        const suggester = (slot as any)?.suggested_by as string | null;
        if (suggester) {
          await notify(
            [
              {
                user_id: suggester,
                type: 'meeting_suggestion_resolved' as NotificationType,
                title: `Your suggested time for "${(ev as any)?.title ?? 'a meeting'}" was ${resolved}`,
              },
            ],
            meetingId,
            userId,
          );
        }
      }

      const detail = await buildDetail(meetingId, userId);
      if (detail) emit(req, detail);
      res.json({ success: true, data: detail });
    } catch (err: any) {
      if (err?.name === 'ZodError') {
        res.status(400).json({ success: false, error: err.errors });
        return;
      }
      console.error('Suggestion response error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  },
);

// ------------------------------------------------------------
// POST /meeting-events/:id/confirm — host locks a slot
// ------------------------------------------------------------
router.post('/:id/confirm', requireMeetingParticipant(), async (req: Request, res: Response) => {
  try {
    const meetingId = (req.params.id as string);
    const userId = req.userId!;
    if (!(await isHost(meetingId, userId))) {
      res.status(403).json({ success: false, error: 'Only the host can confirm' });
      return;
    }
    const { slot_id } = z.object({ slot_id: z.string().uuid() }).parse(req.body);

    const { data: slot } = await supabaseAdmin
      .from('meeting_event_slots')
      .select('*')
      .eq('id', slot_id)
      .eq('meeting_event_id', meetingId)
      .maybeSingle();
    if (!slot) {
      res.status(404).json({ success: false, error: 'Slot not found' });
      return;
    }

    const { data: ev } = await supabaseAdmin
      .from('meeting_events')
      .select('*')
      .eq('id', meetingId)
      .maybeSingle();

    // Regenerate Meet/Zoom links against the locked time (they encode it).
    let linkPatch: Record<string, unknown> = {};
    if (
      (ev as any)?.kind === 'virtual' &&
      (ev as any)?.link_provider &&
      (ev as any).link_provider !== 'jitsi'
    ) {
      const link = await generateMeetingLink((ev as any).link_provider, {
        meetingEventId: meetingId,
        title: (ev as any).title,
        createdBy: userId,
        startsAt: slotStartIso(slot as any),
        durationMin: (ev as any).duration_min,
      });
      linkPatch = { link_provider: link.provider, link_url: link.url, link_meta: link.meta };
    }

    await supabaseAdmin
      .from('meeting_events')
      .update({
        confirmed_slot_id: slot_id,
        status: 'confirmed',
        updated_at: new Date().toISOString(),
        ...linkPatch,
      })
      .eq('id', meetingId);

    const { data: guests } = await supabaseAdmin
      .from('meeting_event_guests')
      .select('user_id')
      .eq('meeting_event_id', meetingId);
    await notify(
      ((guests || []) as any[]).map((g) => ({
        user_id: g.user_id,
        type: 'meeting_confirmed' as NotificationType,
        title: `"${(ev as any)?.title ?? 'A meeting'}" is confirmed`,
      })),
      meetingId,
      userId,
    );

    const detail = await buildDetail(meetingId, userId);
    if (detail) emit(req, detail);
    res.json({ success: true, data: detail });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ success: false, error: err.errors });
      return;
    }
    console.error('Confirm meeting error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /meeting-events/:id/cancel — host cancels
// ------------------------------------------------------------
router.post('/:id/cancel', requireMeetingParticipant(), async (req: Request, res: Response) => {
  try {
    const meetingId = (req.params.id as string);
    const userId = req.userId!;
    if (!(await isHost(meetingId, userId))) {
      res.status(403).json({ success: false, error: 'Only the host can cancel' });
      return;
    }
    const { data: ev } = await supabaseAdmin
      .from('meeting_events')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', meetingId)
      .select('title')
      .maybeSingle();
    const { data: guests } = await supabaseAdmin
      .from('meeting_event_guests')
      .select('user_id')
      .eq('meeting_event_id', meetingId);
    await notify(
      ((guests || []) as any[]).map((g) => ({
        user_id: g.user_id,
        type: 'meeting_cancelled' as NotificationType,
        title: `"${(ev as any)?.title ?? 'A meeting'}" was cancelled`,
      })),
      meetingId,
      userId,
    );
    const detail = await buildDetail(meetingId, userId);
    if (detail) emit(req, detail);
    res.json({ success: true, data: detail });
  } catch (err) {
    console.error('Cancel meeting error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /meeting-events/:id/post-card — post/repost the card to a conversation
// ------------------------------------------------------------
router.post('/:id/post-card', requireMeetingParticipant(), async (req: Request, res: Response) => {
  try {
    const meetingId = (req.params.id as string);
    const { channel_id, dm_conversation_id } = z
      .object({
        channel_id: z.string().uuid().optional(),
        dm_conversation_id: z.string().uuid().optional(),
      })
      .parse(req.body);
    if (!channel_id && !dm_conversation_id) {
      res.status(400).json({ success: false, error: 'channel_id or dm_conversation_id required' });
      return;
    }
    if (channel_id) {
      const level = await checkResourceAccess(req.userId!, 'channel', channel_id);
      if (!level || !meetsAccessLevel(level, 'commenter')) {
        res.status(403).json({ success: false, error: 'Commenter access required' });
        return;
      }
    }
    const { data: ev } = await supabaseAdmin
      .from('meeting_events')
      .select('title')
      .eq('id', meetingId)
      .maybeSingle();
    await postCard(req, meetingId, req.userId!, channel_id ?? null, dm_conversation_id ?? null, (ev as any)?.title ?? 'Meeting');
    res.json({ success: true });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ success: false, error: err.errors });
      return;
    }
    console.error('Post card error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Insert a chat message that carries the meeting reference, and emit new_message
// so it renders as a MeetingPollCard for everyone in the room.
async function postCard(
  req: Request,
  meetingId: string,
  senderId: string,
  channelId: string | null,
  dmId: string | null,
  title: string,
): Promise<void> {
  const { data: message } = await supabaseAdmin
    .from('messages')
    .insert({
      channel_id: channelId,
      dm_conversation_id: dmId,
      sender_id: senderId,
      content: `📅 ${title}`,
      type: 'text',
      meeting_event_id: meetingId,
      mentions: [],
    })
    .select('*, sender:users!sender_id(id, display_name, avatar_url)')
    .single();
  const io = req.app.get('io');
  if (io && message) {
    const room = channelId || dmId;
    if (room) io.to(room).emit('new_message', message);
  }
}

export default router;
