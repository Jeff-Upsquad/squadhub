import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import {
  buildClientShareSnapshot,
  getClientSpaceTemplate,
  getDesignTaskType,
  sanitizeDesignCustom,
} from '../services/folderShareMetrics';
import { config } from '../config';
import { generateTaskUploadUrl, headR2Object, deleteR2Object } from '../r2';
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

    const snap = await buildClientShareSnapshot(link.folder_id as string);
    if (!snap) {
      res.json({ success: true, data: invalid });
      return;
    }

    const payload: DesignSharePayload = { valid: true, client: snap.client, spaces: snap.spaces };
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
  space_id: z.string().uuid(), // which space (child folder) the request targets
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  // Client-settable urgency — 'emergency' is internal-only and never accepted.
  priority: z.enum(['urgent', 'high', 'normal', 'low', 'none']).optional(),
  due_date: z.string().trim().max(40).nullish(),
  // Untrusted custom design-field values; sanitized server-side against the
  // task type's field definitions before being written to metadata.
  custom: z.record(z.string(), z.any()).optional(),
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

    // The target space must be a design/video space directly under the linked
    // client folder — never an arbitrary folder.
    const space = await getClientSpaceTemplate(body.space_id, link.folder_id as string);
    if (!space) {
      res.status(404).json({ success: false, error: 'Space not found' });
      return;
    }
    const isVideo = space.template_slug === 'video-editing-space';

    // Find the queued (Briefs) backing list, or create it — mirrors the
    // dashboard's handleNewTask. Done via an advisory-locked DB function so
    // concurrent client submissions can't create duplicate backing lists.
    const { data: queuedListId, error: ensureErr } = await supabaseAdmin.rpc(
      'ensure_design_queued_list',
      { p_folder: body.space_id, p_created_by: link.created_by as string },
    );
    if (ensureErr || !queuedListId) {
      res.status(500).json({ success: false, error: ensureErr?.message || 'Failed to prepare list' });
      return;
    }

    // Resolve the design/video task type + its brief fields (used to validate
    // the submitted custom values and derive the category). Falls back to the
    // workspace default type if the design type is somehow missing.
    const typeInfo = await getDesignTaskType(isVideo);
    let taskTypeId: string | null = typeInfo?.id ?? null;
    let typeKey: string | null = typeInfo?.key ?? null;
    if (!taskTypeId) {
      const { data: def } = await supabaseAdmin
        .from('task_types')
        .select('id, key')
        .eq('is_default', true)
        .maybeSingle();
      taskTypeId = (def as any)?.id ?? null;
      typeKey = (def as any)?.key ?? null;
    }
    if (!taskTypeId) {
      res.status(500).json({ success: false, error: 'No task type configured for this space' });
      return;
    }
    const defaultStatus = typeKey === 'task' ? 'open' : 'todo';

    // Sanitize client-submitted design fields and derive the category, exactly
    // as the internal New Design Task form persists them to metadata.custom.
    const { custom, category } = sanitizeDesignCustom(typeInfo?.fields || [], body.custom);

    // Enforce required brief fields server-side too — the public form validates
    // this, but a direct POST must not bypass it.
    const isEmpty = (v: unknown) =>
      v == null || v === '' || (Array.isArray(v) && v.length === 0);
    const missingRequired = (typeInfo?.fields || []).find(
      (f) => f.is_required && isEmpty((custom as Record<string, unknown>)[f.key]),
    );
    if (missingRequired) {
      res.status(400).json({ success: false, error: `${missingRequired.label} is required` });
      return;
    }

    const metadata: Record<string, any> = { via_share_link: true };
    if (Object.keys(custom).length) metadata.custom = custom;
    if (category) metadata.category = category;

    const dueDate = body.due_date && /^\d{4}-\d{2}-\d{2}/.test(body.due_date) ? body.due_date : null;

    // Per-client sequential display number, like POST /pm/tasks.
    let displayNumber: number | null = null;
    if (space.client_id) {
      const { data: n } = await supabaseAdmin.rpc('increment_client_task_counter', {
        p_client_id: space.client_id,
      });
      if (typeof n === 'number') displayNumber = n;
    }

    const insertData: Record<string, any> = {
      list_id: queuedListId,
      title: body.title,
      description: body.description,
      status: defaultStatus,
      priority: body.priority || 'none',
      due_date: dueDate,
      task_type_id: taskTypeId,
      assignee_ids: [],
      metadata,
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

// ============================================================
// Voice notes — a client can attach a short audio brief to their request.
// Mirrors the internal /pm/task-attachments presign + confirm flow (direct
// browser → R2 upload), but token-gated and restricted to AUDIO uploaded onto
// a task that was itself created through THIS share link.
// ============================================================
const VOICE_NOTE_MAX_BYTES = 25 * 1024 * 1024; // 25 MB — tighter than the 100 MB task cap

async function loadActiveLink(
  token: string,
): Promise<{ folder_id: string; created_by: string } | null> {
  if (!UUID_RE.test(token)) return null;
  const { data } = await supabaseAdmin
    .from('design_space_share_links')
    .select('folder_id, created_by, enabled')
    .eq('id', token)
    .maybeSingle();
  if (!data || !data.enabled) return null;
  return { folder_id: data.folder_id as string, created_by: data.created_by as string };
}

// A task may receive a voice note only if it was created through the share link
// (metadata.via_share_link) AND lives in a space (child folder) under the link's
// client folder — never an arbitrary task.
async function taskAcceptsShareUpload(taskId: string, clientFolderId: string): Promise<boolean> {
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('list_id, metadata')
    .eq('id', taskId)
    .maybeSingle();
  if (!task || (task.metadata as any)?.via_share_link !== true) return false;
  const { data: list } = await supabaseAdmin
    .from('lists')
    .select('folder_id')
    .eq('id', (task as any).list_id)
    .maybeSingle();
  if (!list?.folder_id) return false;
  const { data: space } = await supabaseAdmin
    .from('folders')
    .select('parent_folder_id')
    .eq('id', list.folder_id)
    .maybeSingle();
  return (space as any)?.parent_folder_id === clientFolderId;
}

const voicePresignSchema = z.object({
  task_id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  content_type: z.string().min(1).max(255),
  file_size: z.number().int().positive(),
});

router.post('/:token/voice-note/presign', writeLimit, async (req: Request, res: Response) => {
  try {
    const link = await loadActiveLink(String(req.params.token || ''));
    if (!link) {
      res.status(404).json({ success: false, error: 'Link not found' });
      return;
    }
    const body = voicePresignSchema.parse(req.body);
    if (!body.content_type.startsWith('audio/')) {
      res.status(400).json({ success: false, error: 'Only audio uploads are allowed' });
      return;
    }
    if (body.file_size > VOICE_NOTE_MAX_BYTES) {
      res.status(400).json({ success: false, error: 'Voice note too large (max 25 MB)' });
      return;
    }
    if (!(await taskAcceptsShareUpload(body.task_id, link.folder_id))) {
      res.status(403).json({ success: false, error: 'Not allowed' });
      return;
    }
    const { uploadUrl, objectKey } = await generateTaskUploadUrl(
      body.task_id,
      body.filename,
      body.content_type,
    );
    res.json({ success: true, data: { upload_url: uploadUrl, key: objectKey } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Public voice-note presign error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const voiceConfirmSchema = z.object({
  task_id: z.string().uuid(),
  object_key: z.string().min(1),
  file_name: z.string().min(1).max(255),
  mime_type: z.string().min(1).max(255),
});

router.post('/:token/voice-note/confirm', writeLimit, async (req: Request, res: Response) => {
  try {
    const link = await loadActiveLink(String(req.params.token || ''));
    if (!link) {
      res.status(404).json({ success: false, error: 'Link not found' });
      return;
    }
    const body = voiceConfirmSchema.parse(req.body);
    if (!body.mime_type.startsWith('audio/')) {
      res.status(400).json({ success: false, error: 'Only audio uploads are allowed' });
      return;
    }
    // Server-generated keys live under tasks/<task_id>/ — reject anything else.
    if (!body.object_key.startsWith(`tasks/${body.task_id}/`)) {
      res.status(400).json({ success: false, error: 'Invalid object key' });
      return;
    }
    if (!(await taskAcceptsShareUpload(body.task_id, link.folder_id))) {
      res.status(403).json({ success: false, error: 'Not allowed' });
      return;
    }
    const head = await headR2Object(body.object_key);
    if (!head) {
      res.status(400).json({ success: false, error: 'Upload not found in storage' });
      return;
    }
    if (head.contentLength > VOICE_NOTE_MAX_BYTES) {
      void deleteR2Object(body.object_key).catch((e) => console.error('R2 cleanup after oversize:', e));
      res.status(400).json({ success: false, error: 'Voice note too large (max 25 MB)' });
      return;
    }
    // R2 does not enforce that the PUT's Content-Type matches the presigned one,
    // so trust the ACTUAL stored content type — not the client-claimed mime_type.
    // Prevents uploading e.g. an HTML file through the audio presign and having
    // it served as HTML from the R2 public domain.
    if (head.contentType && !head.contentType.startsWith('audio/')) {
      void deleteR2Object(body.object_key).catch((e) => console.error('R2 cleanup after bad type:', e));
      res.status(400).json({ success: false, error: 'Uploaded file is not audio' });
      return;
    }
    const fileUrl = `${config.r2PublicUrl}/${body.object_key}`;
    const { data, error } = await supabaseAdmin
      .from('task_attachments')
      .insert({
        task_id: body.task_id,
        object_key: body.object_key,
        file_url: fileUrl,
        file_name: body.file_name,
        file_size: head.contentLength,
        mime_type: body.mime_type,
        uploaded_by: link.created_by,
      })
      .select('id')
      .single();
    if (error || !data) {
      res.status(500).json({ success: false, error: error?.message || 'Failed to save voice note' });
      return;
    }
    res.status(201).json({ success: true, data: { id: data.id } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Public voice-note confirm error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
