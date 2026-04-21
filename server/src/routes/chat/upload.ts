import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { loadChatContext } from '../../middleware/chat';
import { supabaseAdmin } from '../../supabase-chat';
import { FILE_SIZE_LIMITS, generateChatUploadUrl } from '../../r2';

const router = Router();

const presignSchema = z.object({
  conversation_type: z.enum(['group', 'dm']),
  conversation_id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  content_type: z.string().min(1),
  file_size: z.number().int().positive(),
  file_category: z.enum(['image', 'audio', 'video', 'file']),
});

// POST /chat/upload/presign — returns pre-signed PUT URL for R2 upload
router.post('/presign', requireAuth, loadChatContext, async (req: Request, res: Response) => {
  try {
    const body = presignSchema.parse(req.body);

    // Verify access to the target conversation.
    if (body.conversation_type === 'group') {
      const { data: membership } = await supabaseAdmin
        .from('chat_group_members')
        .select('id')
        .eq('group_id', body.conversation_id)
        .eq('user_id', req.userId!)
        .maybeSingle();
      if (!membership) {
        res.status(403).json({ success: false, error: 'Not a member of this group' });
        return;
      }
    } else {
      const { data: conv } = await supabaseAdmin
        .from('chat_dm_conversations')
        .select('user1_id, user2_id')
        .eq('id', body.conversation_id)
        .maybeSingle();
      if (!conv || (conv.user1_id !== req.userId && conv.user2_id !== req.userId)) {
        res.status(403).json({ success: false, error: 'Not a participant in this DM' });
        return;
      }
    }

    const limit = FILE_SIZE_LIMITS[body.file_category];
    if (limit && body.file_size > limit) {
      res.status(400).json({
        success: false,
        error: `${body.file_category} exceeds max size of ${Math.floor(limit / 1024 / 1024)} MB`,
      });
      return;
    }

    const { uploadUrl, objectKey, publicUrl } = await generateChatUploadUrl(
      body.conversation_type,
      body.conversation_id,
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
    console.error('Chat presign error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
