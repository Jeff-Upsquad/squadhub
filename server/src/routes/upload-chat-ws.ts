// ============================================================
// Workspace chat presign endpoint.
// Separate from /chat/upload (which is for Squad Chat Android).
// Validates access against channel resource_memberships OR
// dm_participants before issuing an R2 presigned PUT URL.
// ============================================================
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { checkResourceAccess } from '../middleware/permissions';
import { supabaseAdmin } from '../supabase';
import { FILE_SIZE_LIMITS, generatePresignedUploadUrl } from '../r2';

const router = Router();

const presignSchema = z.object({
  scope: z.enum(['channel', 'dm']),
  scope_id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  content_type: z.string().min(1).max(255),
  file_size: z.number().int().positive(),
  file_category: z.enum(['image', 'audio', 'video', 'file']),
});

// POST /messages/upload-presign — pre-signed R2 PUT URL for chat attachments.
router.post('/upload-presign', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = presignSchema.parse(req.body);

    // Access check
    let workspaceId: string | null = null;
    if (body.scope === 'channel') {
      const level = await checkResourceAccess(req.userId!, 'channel', body.scope_id);
      if (!level) {
        res.status(403).json({ success: false, error: 'No access to this channel' });
        return;
      }
      const { data: ch } = await supabaseAdmin
        .from('channels').select('workspace_id').eq('id', body.scope_id).maybeSingle();
      workspaceId = ch?.workspace_id || null;
    } else {
      const { data: participant } = await supabaseAdmin
        .from('dm_participants')
        .select('user_id')
        .eq('conversation_id', body.scope_id)
        .eq('user_id', req.userId!)
        .maybeSingle();
      if (!participant) {
        res.status(403).json({ success: false, error: 'Not a participant in this DM' });
        return;
      }
      const { data: conv } = await supabaseAdmin
        .from('dm_conversations').select('workspace_id').eq('id', body.scope_id).maybeSingle();
      workspaceId = conv?.workspace_id || null;
    }

    if (!workspaceId) {
      res.status(404).json({ success: false, error: 'Conversation not found' });
      return;
    }

    const limit = FILE_SIZE_LIMITS[body.file_category];
    if (limit && body.file_size > limit) {
      res.status(400).json({
        success: false,
        error: `${body.file_category} exceeds max size of ${Math.floor(limit / 1024 / 1024)} MB`,
      });
      return;
    }

    const { uploadUrl, objectKey, publicUrl } = await generatePresignedUploadUrl(
      workspaceId,
      body.scope_id,
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
    console.error('Workspace presign error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
