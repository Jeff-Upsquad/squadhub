import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { checkResourceAccess, meetsAccessLevel } from '../../middleware/permissions';
import { config } from '../../config';
import {
  TASK_ATTACHMENT_MAX_BYTES,
  generateTaskUploadUrl,
  headR2Object,
  deleteR2Object,
} from '../../r2';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', 'partner', 'client', 'client_staff'));

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
        uploaded_by: req.userId!,
      })
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

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

// DELETE /pm/task-attachments/:id — deletes the row, then fire-and-forget removes
// the R2 object. R2 errors are logged but don't fail the request.
router.delete('/task-attachments/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const { data: row, error: fetchErr } = await supabaseAdmin
      .from('task_attachments')
      .select('id, task_id, object_key')
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

    // Best-effort R2 cleanup.
    deleteR2Object(row.object_key).catch((e) => console.error('R2 delete error for', row.object_key, e));

    res.json({ success: true });
  } catch (err) {
    console.error('Delete task attachment error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
