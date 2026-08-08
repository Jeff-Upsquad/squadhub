import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { checkResourceAccess, meetsAccessLevel } from '../../middleware/permissions';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { config } from '../../config';
import {
  TASK_ATTACHMENT_MAX_BYTES,
  generateTaskUploadUrl,
  headR2Object,
  deleteR2Object,
  r2Client,
} from '../../r2';
import { PARTNER_USER_TYPES } from '@squadhub/shared';
import { logTaskActivity } from '../../utils/taskActivity';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

async function getTaskListId(taskId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('tasks').select('list_id').eq('id', taskId).single();
  return data?.list_id || null;
}

async function requireTaskAccess(userId: string, taskId: string, level: 'viewer' | 'member'): Promise<string | null> {
  const listId = await getTaskListId(taskId);
  if (!listId) return null;
  const userLevel = await checkResourceAccess(userId, 'list', listId);
  if (!userLevel) return null;
  if (level === 'member' && !meetsAccessLevel(userLevel, 'member')) return null;
  return listId;
}

// HTTP headers must be Latin-1. Build a Content-Disposition that keeps an
// ASCII fallback `filename=` plus RFC 5987 `filename*=` for the real name
// (Mac screenshots often include non-ASCII spaces/dashes that crash Node
// with ERR_INVALID_CHAR if stuffed into a plain quoted filename).
function attachmentContentDisposition(fileName: string): string {
  const raw = (fileName || 'attachment').replace(/[\r\n"]/g, '_');
  const ascii = raw.replace(/[^\x20-\x7E]/g, '_').trim() || 'attachment';
  const encoded = encodeURIComponent(raw).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// GET /pm/tasks/:taskId/attachments
router.get('/tasks/:taskId/attachments', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.taskId as string;
    const listId = await requireTaskAccess(req.userId!, taskId, 'viewer');
    if (!listId) {
      res.status(403).json({ success: false, error: 'No access to this task' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('task_attachments')
      .select('*')
      .eq('task_id', taskId)
      .order('uploaded_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('List task attachments error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/task-attachments/presign — returns a pre-signed PUT URL for direct R2 upload.
// No DB row is written here; the client must call /confirm after the upload succeeds.
const presignSchema = z.object({
  task_id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  content_type: z.string().min(1).max(255),
  file_size: z.number().int().positive(),
});

router.post('/task-attachments/presign', async (req: Request, res: Response) => {
  try {
    const body = presignSchema.parse(req.body);

    const listId = await requireTaskAccess(req.userId!, body.task_id, 'member');
    if (!listId) {
      res.status(403).json({ success: false, error: 'Member access required' });
      return;
    }

    if (body.file_size > TASK_ATTACHMENT_MAX_BYTES) {
      res.status(400).json({
        success: false,
        error: `File too large. Maximum size is ${Math.round(TASK_ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB`,
      });
      return;
    }

    const { uploadUrl, objectKey, publicUrl } = await generateTaskUploadUrl(
      body.task_id,
      body.filename,
      body.content_type,
    );

    res.json({
      success: true,
      data: {
        upload_url: uploadUrl,
        public_url: publicUrl,
        key: objectKey,
        expires_in: 3600,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Task attachment presign error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/task-attachments/confirm — called by the client after a successful R2 PUT.
// Server HEAD-validates the object exists and re-checks the size cap, then writes the row.
const confirmSchema = z.object({
  task_id: z.string().uuid(),
  object_key: z.string().min(1),
  file_name: z.string().min(1).max(255),
  mime_type: z.string().min(1).max(255),
});

router.post('/task-attachments/confirm', async (req: Request, res: Response) => {
  try {
    const body = confirmSchema.parse(req.body);

    const listId = await requireTaskAccess(req.userId!, body.task_id, 'member');
    if (!listId) {
      res.status(403).json({ success: false, error: 'Member access required' });
      return;
    }

    // The object key is server-generated and starts with `tasks/<task_id>/`.
    // Reject confirms that point outside the task's own prefix to prevent
    // attaching arbitrary blobs the user didn't upload through us.
    if (!body.object_key.startsWith(`tasks/${body.task_id}/`)) {
      res.status(400).json({ success: false, error: 'Invalid object key' });
      return;
    }

    const head = await headR2Object(body.object_key);
    if (!head) {
      res.status(400).json({ success: false, error: 'Upload not found in storage' });
      return;
    }

    if (head.contentLength > TASK_ATTACHMENT_MAX_BYTES) {
      // Best-effort cleanup of the oversized object so it doesn't linger.
      void deleteR2Object(body.object_key).catch((e) => console.error('R2 cleanup after oversize:', e));
      res.status(400).json({
        success: false,
        error: `File too large. Maximum size is ${Math.round(TASK_ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB`,
      });
      return;
    }

    // R2 presigned PUTs don't enforce that the upload's Content-Type matches the
    // one signed at presign, so the client-claimed `mime_type` isn't trustworthy.
    // Trust the ACTUAL stored content type instead, and reject a bait-and-switch
    // where its top-level family differs from what the client claimed (e.g.
    // presign image/*, then upload text/html — which would then be served inline
    // from the public R2 domain). All in-app uploaders set the PUT Content-Type
    // to the same value they confirm, so legitimate uploads always match.
    const claimedFamily = body.mime_type.split('/')[0].toLowerCase();
    const actualType = head.contentType || null;
    const actualFamily = actualType ? actualType.split('/')[0].toLowerCase() : null;
    if (actualFamily && actualFamily !== claimedFamily) {
      void deleteR2Object(body.object_key).catch((e) => console.error('R2 cleanup after type mismatch:', e));
      res.status(400).json({ success: false, error: 'Uploaded file type does not match the requested type' });
      return;
    }
    // Source of truth = what R2 will actually serve (falls back to the claimed
    // type only when R2 doesn't report one).
    const storedMimeType = actualType || body.mime_type;

    const fileUrl = `${config.r2PublicUrl}/${body.object_key}`;

    const { data, error } = await supabaseAdmin
      .from('task_attachments')
      .insert({
        task_id: body.task_id,
        object_key: body.object_key,
        file_url: fileUrl,
        file_name: body.file_name,
        file_size: head.contentLength,
        mime_type: storedMimeType,
        uploaded_by: req.userId!,
      })
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    await logTaskActivity(body.task_id, req.userId!, [{
      event_type: 'attachment_added',
      new_value: { name: body.file_name },
    }]);

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Task attachment confirm error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/task-attachments/:id/download — streams the file through our API with
// Content-Disposition: attachment. Same-origin + auth beats public R2 URLs,
// which browsers render inline (and whose CORS often blocks a client-side blob
// save, so the old path fell back to opening a new tab).
router.get('/task-attachments/:id/download', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const { data: row, error: fetchErr } = await supabaseAdmin
      .from('task_attachments')
      .select('id, task_id, object_key, file_name, mime_type')
      .eq('id', id)
      .single();

    if (fetchErr || !row) {
      res.status(404).json({ success: false, error: 'Attachment not found' });
      return;
    }

    const listId = await requireTaskAccess(req.userId!, row.task_id, 'viewer');
    if (!listId) {
      res.status(403).json({ success: false, error: 'No access to this task' });
      return;
    }

    const obj = await r2Client.send(
      new GetObjectCommand({
        Bucket: config.r2BucketName,
        Key: row.object_key,
      }),
    );
    if (!obj.Body) {
      res.status(404).json({ success: false, error: 'File not found in storage' });
      return;
    }

    const filename = String(row.file_name || 'attachment');
    res.setHeader('Content-Type', obj.ContentType || row.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', attachmentContentDisposition(filename));
    res.setHeader('Cache-Control', 'private, no-store');
    if (obj.ContentLength != null) {
      res.setHeader('Content-Length', String(obj.ContentLength));
    }

    await pipeline(obj.Body as Readable, res);
  } catch (err) {
    console.error('Task attachment download error:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
});

// DELETE /pm/task-attachments/:id — deletes the row, then fire-and-forget removes
// the R2 object. R2 errors are logged but don't fail the request.
router.delete('/task-attachments/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const { data: row, error: fetchErr } = await supabaseAdmin
      .from('task_attachments')
      .select('id, task_id, object_key, file_name')
      .eq('id', id)
      .single();

    if (fetchErr || !row) {
      res.status(404).json({ success: false, error: 'Attachment not found' });
      return;
    }

    const listId = await requireTaskAccess(req.userId!, row.task_id, 'member');
    if (!listId) {
      res.status(403).json({ success: false, error: 'Member access required' });
      return;
    }

    const { error: delErr } = await supabaseAdmin.from('task_attachments').delete().eq('id', id);
    if (delErr) {
      res.status(500).json({ success: false, error: delErr.message });
      return;
    }

    await logTaskActivity(row.task_id, req.userId!, [{
      event_type: 'attachment_removed',
      old_value: { name: (row as any).file_name },
    }]);

    // Best-effort R2 cleanup.
    deleteR2Object(row.object_key).catch((e) => console.error('R2 delete error for', row.object_key, e));

    res.json({ success: true });
  } catch (err) {
    console.error('Delete task attachment error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
