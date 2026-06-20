import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';
import { mirrorMeeting } from '../services/taskMirror';

const router = Router();

// Keep the meeting's mirror tasks in sync without ever failing the primary
// request — a mirror hiccup must not block creating/finishing a meeting.
function syncMeetingMirror(meetingId: string): void {
  mirrorMeeting(meetingId).catch((err) =>
    console.error('[meetings] mirror sync failed:', err),
  );
}

router.use(requireAuth);

const createSchema = z.object({
  title: z.string().min(1),
  scheduled_at: z.string(), // ISO timestamp
  duration_min: z.number().int().positive().optional(),
  location: z.string().optional(),
  attendee_ids: z.array(z.string().uuid()).optional(),
});

// ------------------------------------------------------------
// GET /meetings/my — the current user's still-scheduled meetings (as
// creator OR attendee) whose scheduled_at is today or overdue, in the
// caller's timezone. Powers the Home "Meetings" secondary card.
// Day-bucketing mirrors /pm/tasks/my.
// ------------------------------------------------------------
router.get('/my', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const tz = (req.query.tz as string) || 'Asia/Kolkata';

    const { data, error } = await supabaseAdmin
      .from('meetings')
      .select('*')
      .eq('status', 'scheduled')
      .or(`created_by.eq.${userId},attendee_ids.cs.{${userId}}`)
      .order('scheduled_at', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const todayStr = fmt.format(new Date());

    const due = (data || []).filter((m: any) => {
      if (!m.scheduled_at) return false;
      const dayStr = fmt.format(new Date(m.scheduled_at));
      return dayStr <= todayStr; // today or overdue
    });

    res.json({ success: true, data: due });
  } catch (err) {
    console.error('List my meetings error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /meetings — create a meeting. The creator is always implicitly an
// attendee for card purposes (the /my query matches on created_by too).
// ------------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const body = createSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('meetings')
      .insert({
        title: body.title,
        scheduled_at: body.scheduled_at,
        duration_min: body.duration_min ?? 30,
        location: body.location ?? null,
        attendee_ids: body.attendee_ids ?? [],
        created_by: userId,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    syncMeetingMirror((data as any).id);
    res.json({ success: true, data });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ success: false, error: err.errors });
      return;
    }
    console.error('Create meeting error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /meetings/:id/done — mark a meeting done so it drops off the card.
// Only the creator or an attendee may complete it.
// ------------------------------------------------------------
router.post('/:id/done', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('meetings')
      .select('id, created_by, attendee_ids')
      .eq('id', id)
      .single();

    if (fetchErr || !existing) {
      res.status(404).json({ success: false, error: 'Meeting not found' });
      return;
    }

    const isParticipant =
      (existing as any).created_by === userId ||
      ((existing as any).attendee_ids || []).includes(userId);
    if (!isParticipant) {
      res.status(403).json({ success: false, error: 'Not a participant of this meeting' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('meetings')
      .update({ status: 'done', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Meeting is no longer 'scheduled' → mirror sync removes its tasks.
    syncMeetingMirror(id as string);
    res.json({ success: true, data });
  } catch (err) {
    console.error('Mark meeting done error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
