import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

// Admin recovery for soft-deleted Squad Clips learning clips. The `clips` table
// is owned by the separate Squad Clips app but lives in the same Supabase
// project, so the platform service role can list/restore them here. A learning
// clip deleted from the Squad Clips library is soft-deleted (deleted_at set,
// media kept); admins can restore it (re-enabling its /embed/lms link) or
// permanently delete the record.
const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

// GET /admin/clips-recovery — list soft-deleted clips (newest first)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('clips')
      .select('id, title, user_id, mime_type, duration_seconds, lms_enabled, deleted_at')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const rows = data ?? [];
    const ownerIds = [...new Set(rows.map((c) => c.user_id).filter(Boolean))];
    const owners = ownerIds.length
      ? (
          await supabaseAdmin
            .from('users')
            .select('id, display_name, email')
            .in('id', ownerIds)
        ).data ?? []
      : [];
    const byId = new Map(owners.map((u) => [u.id, u]));

    const items = rows.map((c) => ({
      ...c,
      owner_name: byId.get(c.user_id)?.display_name || byId.get(c.user_id)?.email || 'Unknown',
    }));

    res.json({ success: true, data: items });
  } catch (err) {
    console.error('Admin clips-recovery list error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/clips-recovery/recover { id } — restore a soft-deleted clip
router.put('/recover', async (req: Request, res: Response) => {
  try {
    const { id } = (req.body ?? {}) as { id?: string };
    if (!id) {
      res.status(400).json({ success: false, error: 'id is required' });
      return;
    }
    const { error } = await supabaseAdmin
      .from('clips')
      .update({ deleted_at: null })
      .eq('id', id)
      .not('deleted_at', 'is', null);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Clip recovered' });
  } catch (err) {
    console.error('Admin clips-recovery restore error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/clips-recovery/permanent { id } — drop the record for good.
// Removes the DB row only; the media object in R2 is left to the Squad Clips
// app's own lifecycle (the platform service role doesn't hold that bucket's
// credentials), so this clears the record without orphan-deleting blindly.
router.delete('/permanent', async (req: Request, res: Response) => {
  try {
    const { id } = (req.body ?? {}) as { id?: string };
    if (!id) {
      res.status(400).json({ success: false, error: 'id is required' });
      return;
    }
    const { error } = await supabaseAdmin
      .from('clips')
      .delete()
      .eq('id', id)
      .not('deleted_at', 'is', null);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Clip permanently deleted' });
  } catch (err) {
    console.error('Admin clips-recovery permanent delete error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
