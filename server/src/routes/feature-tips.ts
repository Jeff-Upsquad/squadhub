import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../supabase';
import { requireAuth } from '../middleware/auth';
import { getUserAudienceContext, matchesAudience } from '../services/featureTipAudience';
import type { PendingFeatureTip } from '@squadhub/shared';

const router = Router();
router.use(requireAuth);

const SNOOZE_MS = 3 * 60 * 60 * 1000; // Dismiss snooze window: 3 hours

// GET /feature-tips/pending — tips the current user should see right now.
// The SQL function handles active/accept/snooze/revision math; we then drop any
// tip the user is not in the audience for (audience needs role/dept joins).
router.get('/pending', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin.rpc('feature_tips_pending_for_user', {
      p_user_id: req.userId!,
    });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const candidates = (data || []) as Array<{
      id: string;
      title: string;
      body: string;
      target_view: string | null;
      target_anchor: string | null;
      revision: number;
      audience: any;
    }>;

    if (candidates.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    // Fetch the user's audience attributes once, then filter in memory.
    const ctx = await getUserAudienceContext(req.userId!);
    const result: PendingFeatureTip[] = candidates
      .filter((t) => matchesAudience(ctx, t.audience))
      .map((t) => ({
        id: t.id,
        title: t.title,
        body: t.body,
        target_view: t.target_view,
        target_anchor: t.target_anchor,
        revision: t.revision,
      }));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Pending feature tips error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Loads a tip's current revision, asserting it is active. Returns null (and the
// caller 404s) when missing/inactive so no state rows are created for dead tips.
async function loadActiveTip(id: string): Promise<{ current_revision: number } | null> {
  const { data } = await supabaseAdmin
    .from('feature_tips')
    .select('current_revision, is_active')
    .eq('id', id)
    .single();
  if (!data || !data.is_active) return null;
  return { current_revision: data.current_revision };
}

// If the client tells us which revision it rendered and the tip has since been
// re-issued to a new revision, reject so the client re-fetches and shows the new
// round before acknowledging (avoids marking an unseen revision as handled).
function revisionStale(req: Request, currentRevision: number): boolean {
  const r = req.body?.revision;
  return typeof r === 'number' && r !== currentRevision;
}

// POST /feature-tips/:id/accept — permanent acknowledgement at the current revision.
router.post('/:id/accept', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const tip = await loadActiveTip(id);
    if (!tip) {
      res.status(404).json({ success: false, error: 'Tip not found' });
      return;
    }
    if (revisionStale(req, tip.current_revision)) {
      res.status(409).json({ success: false, error: 'revision_changed' });
      return;
    }

    const { error } = await supabaseAdmin.from('feature_tip_states').upsert(
      {
        tip_id: id,
        user_id: req.userId!,
        revision: tip.current_revision,
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        dismissed_until: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tip_id,user_id,revision' },
    );
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Accept feature tip error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /feature-tips/:id/dismiss — snooze for 3 hours, then it becomes pending
// again (until the user accepts). Server clock only; nothing client-side.
router.post('/:id/dismiss', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const tip = await loadActiveTip(id);
    if (!tip) {
      res.status(404).json({ success: false, error: 'Tip not found' });
      return;
    }
    if (revisionStale(req, tip.current_revision)) {
      res.status(409).json({ success: false, error: 'revision_changed' });
      return;
    }

    // Never downgrade an existing acceptance — a stray/cross-device dismiss must
    // not undo "Got it" (which is permanent for this revision).
    const { data: existing } = await supabaseAdmin
      .from('feature_tip_states')
      .select('status')
      .eq('tip_id', id)
      .eq('user_id', req.userId!)
      .eq('revision', tip.current_revision)
      .maybeSingle();
    if (existing?.status === 'accepted') {
      res.json({ success: true });
      return;
    }

    const dismissedUntil = new Date(Date.now() + SNOOZE_MS).toISOString();
    const { error } = await supabaseAdmin.from('feature_tip_states').upsert(
      {
        tip_id: id,
        user_id: req.userId!,
        revision: tip.current_revision,
        status: 'dismissed',
        accepted_at: null,
        dismissed_until: dismissedUntil,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tip_id,user_id,revision' },
    );
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data: { dismissed_until: dismissedUntil } });
  } catch (err) {
    console.error('Dismiss feature tip error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
