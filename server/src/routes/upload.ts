import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { generatePresignedUploadUrl, generateLmsUploadUrl, generateJobsUploadUrl, FILE_SIZE_LIMITS } from '../r2';

const router = Router();

const presignSchema = z.object({
  workspace_id: z.string().uuid(),
  channel_or_dm_id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  content_type: z.string().min(1),
  file_size: z.number().positive(),
  file_category: z.enum(['image', 'audio', 'video', 'file']),
});

const lmsPresignSchema = z.object({
  item_id: z.string().uuid(),
  lesson_id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  content_type: z.string().min(1),
  file_size: z.number().positive(),
  file_category: z.enum(['image', 'audio', 'video', 'file']),
});

const jobsPresignSchema = z.object({
  kind: z.enum(['logo', 'photo']),
  filename: z.string().min(1).max(255),
  content_type: z.string().min(1),
  file_size: z.number().positive(),
});

// POST /upload/presign-jobs — business/brand logos + photos for the Job
// Cards onboarding profiles (images only; served to candidates).
router.post('/presign-jobs', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = jobsPresignSchema.parse(req.body);

    if (!body.content_type.startsWith('image/')) {
      res.status(400).json({ success: false, error: 'Only image uploads are allowed here' });
      return;
    }
    const maxSize = FILE_SIZE_LIMITS.image;
    if (body.file_size > maxSize) {
      const maxMB = Math.round(maxSize / (1024 * 1024));
      res.status(400).json({ success: false, error: `File too large. Maximum size is ${maxMB}MB` });
      return;
    }

    const result = await generateJobsUploadUrl(body.kind, body.filename, body.content_type);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Jobs presign error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /upload/presign — get a pre-signed URL for direct upload to R2
router.post('/presign', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = presignSchema.parse(req.body);

    // Check file size limit
    const maxSize = FILE_SIZE_LIMITS[body.file_category];
    if (body.file_size > maxSize) {
      const maxMB = Math.round(maxSize / (1024 * 1024));
      res.status(400).json({
        success: false,
        error: `File too large. Maximum size for ${body.file_category} is ${maxMB}MB`,
      });
      return;
    }

    const result = await generatePresignedUploadUrl(
      body.workspace_id,
      body.channel_or_dm_id,
      body.filename,
      body.content_type,
    );

    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Presign error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /upload/presign-lms — for LMS content-block media uploads
router.post('/presign-lms', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = lmsPresignSchema.parse(req.body);

    const maxSize = FILE_SIZE_LIMITS[body.file_category];
    if (body.file_size > maxSize) {
      const maxMB = Math.round(maxSize / (1024 * 1024));
      res.status(400).json({
        success: false,
        error: `File too large. Maximum size for ${body.file_category} is ${maxMB}MB`,
      });
      return;
    }

    const result = await generateLmsUploadUrl(
      body.item_id,
      body.lesson_id,
      body.filename,
      body.content_type,
    );

    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('LMS presign error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
