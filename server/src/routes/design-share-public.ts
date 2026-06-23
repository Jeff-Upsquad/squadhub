import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import { buildDesignShareSnapshot } from '../services/folderShareMetrics';
import type { DesignSharePayload } from '@squadhub/shared';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// In-process IP rate-limiter (no Redis), mirroring routes/leads-public.ts.
// Reads stay generous; the write endpoint (POST .../request) is throttled
// harder to keep the public form from being used to spam tasks.
// ---------------------------------------------------------------------------
type Bucket = { count: number; resetAt: number };
function makeRateLimiter(max: number, windowMs: number) {
  const buckets = new Map<string, Bucket>();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of buckets) if (b.resetAt < now) buckets.delete(ip);
  }, 2 * 60_000).unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() ||
      req.ip ||
      'unknown';
    const now = Date.now();
    const bucket = buckets.get(ip);
    if (!bucket || bucket.resetAt < now) {
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (bucket.count >= max) {
      res.status(429).json({ success: false, error: 'Too many requests. Try again shortly.' });
      return;
    }
    bucket.count += 1;
    next();
  };
}

const readLimit = makeRateLimiter(60, 60_000); // 60 reads/min/IP
const writeLimit = makeRateLimiter(5, 60_000); // 5 submissions/min/IP

// ============================================================
// GET /design-share/:token — read-only design-space view (no auth).
// Returns { valid:false } for unknown/deleted links, { valid:false,
// disabled:true } for a disabled link, otherwise the full snapshot.
// ============================================================
router.get('/:token', readLimit, async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token || '');
    const invalid: DesignSharePayload = { valid: false };
    if (!UUID_RE.test(token)) {
      res.json({ success: true, data: invalid });
      return;
    }

    const { data: link } = await supabaseAdmin
      .from('design_space_share_links')
      .select('folder_id, enabled')
      .eq('id', token)
      .maybeSingle();
    if (!link) {
      res.json({ success: true, data: invalid });
      return;
    }
    if (!link.enabled) {
      res.json({ success: true, data: { valid: false, disabled: true } });
      return;
    }

    const snap = await buildDesignShareSnapshot(link.folder_id as string);
    if (!snap) {
      res.json({ success: true, data: invalid });
      return;
    }

    const payload: DesignSharePayload = { valid: true, ...snap };
    res.json({ success: true, data: payload });
  } catch (err) {
    console.error('Public design-share GET error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// POST /design-share/:token/request — client submits a new design request.
// Creates a task in the space's Briefs/queued list (auto-creating it if
// missing), attributed to the link's creator. No auth; tightly rate-limited.
// ============================================================
const requestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
});

router.post('/:token/request', writeLimit, async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token || '');
    if (!UUID_RE.test(token)) {
      res.status(404).json({ success: false, error: 'Link not found' });
      return;
    }

    const { data: link } = await supabaseAdmin
      .from('design_space_share_links')
      .select('folder_id, created_by, enabled')
      .eq('id', token)
      .maybeSingle();
    if (!link) {
      res.status(404).json({ success: false, error: 'Link not found' });
      return;
    }
    if (!link.enabled) {
      res.status(403).json({ success: false, error: 'This link is disabled' });
      return;
    }

    const body = requestSchema.parse(req.body);

    const { data: folder } = await supabaseAdmin
      .from('folders')
      .select('id, space_id, client_id, client_space_template:client_space_template_id(slug)')
      .eq('id', link.folder_id as string)
      .is('deleted_at', null)
      .single();
    if (!folder) {
      res.status(404).json({ success: false, error: 'Design space not found' });
      return;
    }
    const isVideo = ((folder as any).client_space_template?.slug as string | undefined) === 'video-editing-space';

    // Find the queued (Briefs) backing list, or create it — mirrors the
    // dashboard's handleNewTask. Done via an advisory-locked DB function so
    // concurrent client submissions can't create duplicate backing lists.
    const { data: queuedListId, error: ensureErr } = await supabaseAdmin.rpc(
      'ensure_design_queued_list',
      { p_folder: folder.id, p_created_by: link.created_by as string },
    );
    if (ensureErr || !queuedListId) {
      res.status(500).json({ success: false, error: ensureErr?.message || 'Failed to prepare list' });
      return;
    }

    // Resolve the design/video task type (falls back to the default type).
    const typeKey = isVideo ? 'video_edit_task' : 'design_task';
    let { data: tt } = await supabaseAdmin
      .from('task_types')
      .select('id, key')
      .eq('key', typeKey)
      .maybeSingle();
    if (!tt) {
      const { data: def } = await supabaseAdmin
        .from('task_types')
        .select('id, key')
        .eq('is_default', true)
        .maybeSingle();
      tt = def;
    }
    if (!tt?.id) {
      res.status(500).json({ success: false, error: 'No task type configured for this space' });
      return;
    }
    const defaultStatus = (tt as any).key === 'task' ? 'open' : 'todo';

    // Per-client sequential display number, like POST /pm/tasks.
    let displayNumber: number | null = null;
    if ((folder as any).client_id) {
      const { data: n } = await supabaseAdmin.rpc('increment_client_task_counter', {
        p_client_id: (folder as any).client_id,
      });
      if (typeof n === 'number') displayNumber = n;
    }

    const insertData: Record<string, any> = {
      list_id: queuedListId,
      title: body.title,
      description: body.description,
      status: defaultStatus,
      priority: 'none',
      task_type_id: tt.id,
      assignee_ids: [],
      metadata: { via_share_link: true },
      created_by: link.created_by as string,
    };
    if (displayNumber != null) insertData.display_number = displayNumber;

    const { data: task, error } = await supabaseAdmin
      .from('tasks')
      .insert(insertData)
      .select('id')
      .single();
    if (error || !task) {
      res.status(500).json({ success: false, error: error?.message || 'Failed to submit request' });
      return;
    }

    res.status(201).json({ success: true, data: { id: task.id } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Public design-share request error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
