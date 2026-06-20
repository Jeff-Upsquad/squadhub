import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/admin';
import { supabaseAdmin } from '../../supabase';
import { resolveAudience } from '../../services/featureTipAudience';
import { NAVIGABLE_TIP_VIEWS, TIP_ANCHOR_KEYS } from '@squadhub/shared';

const router = Router();
router.use(requireAuth, requireAdmin);

const audienceSchema = z
  .object({
    user_types: z
      .array(z.enum(['internal', 'client', 'client_staff', 'partner', 'partner_employee']))
      .optional(),
    workspace_roles: z.array(z.enum(['super_admin', 'admin', 'member', 'guest'])).optional(),
    role_ids: z.array(z.string().uuid()).optional(),
    department_ids: z.array(z.string().uuid()).optional(),
    user_ids: z.array(z.string().uuid()).optional(),
  })
  .strict();

const createTipSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(2000),
  target_view: z
    .string()
    .max(80)
    .nullable()
    .optional()
    .refine((v) => v == null || NAVIGABLE_TIP_VIEWS.some((x) => x.value === v), {
      message: 'Unknown target_view',
    }),
  target_anchor: z.string().max(80).nullable().optional(),
  audience: audienceSchema.optional(),
});

const updateTipSchema = createTipSchema.partial();

const triggerSchema = z.object({
  scope: z.enum(['everyone', 'unaccepted']),
});

// GET /admin/feature-tips/target-views — catalog for the editor dropdown.
router.get('/target-views', (_req: Request, res: Response) => {
  res.json({ success: true, data: NAVIGABLE_TIP_VIEWS });
});

// GET /admin/feature-tips/anchor-keys — catalog for the editor autocomplete.
router.get('/anchor-keys', (_req: Request, res: Response) => {
  res.json({ success: true, data: TIP_ANCHOR_KEYS });
});

// GET /admin/feature-tips — list with pagination + current-revision accepted count.
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = Math.max(parseInt((req.query.page as string) || '1', 10), 1);
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
    const from = (page - 1) * limit;

    let query = supabaseAdmin
      .from('feature_tips')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    if (req.query.active === 'true') query = query.eq('is_active', true);
    if (req.query.active === 'false') query = query.eq('is_active', false);

    const { data: tips, count, error } = await query;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Accepted count per tip at its current revision (one query for the page).
    const ids = (tips || []).map((t: any) => t.id);
    const acceptedByTip: Record<string, number> = {};
    if (ids.length) {
      const { data: states } = await supabaseAdmin
        .from('feature_tip_states')
        .select('tip_id, revision, status')
        .in('tip_id', ids)
        .eq('status', 'accepted');
      const revByTip: Record<string, number> = {};
      for (const t of tips as any[]) revByTip[t.id] = t.current_revision;
      for (const s of (states ?? []) as any[]) {
        if (s.revision === revByTip[s.tip_id]) {
          acceptedByTip[s.tip_id] = (acceptedByTip[s.tip_id] || 0) + 1;
        }
      }
    }

    const data = (tips || []).map((t: any) => ({ ...t, accepted_count: acceptedByTip[t.id] || 0 }));
    res.json({ success: true, data, total: count || 0, page, limit });
  } catch (err) {
    console.error('List feature tips error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/feature-tips/:id
router.get('/:id', async (req: Request, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('feature_tips')
    .select('*')
    .eq('id', req.params.id as string)
    .single();
  if (error || !data) {
    res.status(404).json({ success: false, error: 'Tip not found' });
    return;
  }
  res.json({ success: true, data });
});

// POST /admin/feature-tips — create (inactive until triggered).
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createTipSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('feature_tips')
      .insert({
        title: body.title,
        body: body.body,
        target_view: body.target_view ?? null,
        target_anchor: body.target_anchor ?? null,
        audience: body.audience ?? {},
        is_active: false,
        created_by: req.userId,
      })
      .select('*')
      .single();
    if (error || !data) {
      res.status(500).json({ success: false, error: error?.message || 'Insert failed' });
      return;
    }
    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create feature tip error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/feature-tips/:id — edit definition. Does not change revision/active.
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const body = updateTipSchema.parse(req.body);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.title !== undefined) patch.title = body.title;
    if (body.body !== undefined) patch.body = body.body;
    if (body.target_view !== undefined) patch.target_view = body.target_view ?? null;
    if (body.target_anchor !== undefined) patch.target_anchor = body.target_anchor ?? null;
    if (body.audience !== undefined) patch.audience = body.audience ?? {};

    const { data, error } = await supabaseAdmin
      .from('feature_tips')
      .update(patch)
      .eq('id', req.params.id as string)
      .select('*')
      .single();
    if (error || !data) {
      res.status(404).json({ success: false, error: 'Tip not found' });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update feature tip error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/feature-tips/:id — cascade drops its states.
router.delete('/:id', async (req: Request, res: Response) => {
  const { error } = await supabaseAdmin
    .from('feature_tips')
    .delete()
    .eq('id', req.params.id as string);
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.json({ success: true });
});

// POST /admin/feature-tips/:id/trigger — activate / re-issue.
//   scope='everyone'   → re-surface for ALL targeted users. Bumps the revision
//                        (so prior acceptances stop counting) only if there are
//                        already acceptances at the current revision, keeping
//                        revision numbers meaningful and history preserved.
//   scope='unaccepted' → keep the revision; just re-activate and clear active
//                        snoozes so everyone who hasn't accepted sees it again.
router.post('/:id/trigger', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { scope } = triggerSchema.parse(req.body);

    const { data: tip } = await supabaseAdmin
      .from('feature_tips')
      .select('id, current_revision, audience')
      .eq('id', id)
      .single();
    if (!tip) {
      res.status(404).json({ success: false, error: 'Tip not found' });
      return;
    }

    let revision = tip.current_revision as number;

    if (scope === 'everyone') {
      const { count } = await supabaseAdmin
        .from('feature_tip_states')
        .select('*', { count: 'exact', head: true })
        .eq('tip_id', id)
        .eq('revision', revision)
        .eq('status', 'accepted');
      if ((count || 0) > 0) revision = revision + 1;
    }

    const { error: upErr } = await supabaseAdmin
      .from('feature_tips')
      .update({
        is_active: true,
        last_triggered_at: new Date().toISOString(),
        current_revision: revision,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (upErr) {
      res.status(500).json({ success: false, error: upErr.message });
      return;
    }

    // Re-surface anyone currently snoozed at the resulting revision — for BOTH
    // scopes. A revision bump already re-pends old-revision rows via the LEFT
    // JOIN; but when the revision is unchanged ('unaccepted', or 'everyone' with
    // no prior acceptances) the existing snoozes must be cleared explicitly or
    // they'd stay hidden until their 3h window elapses.
    await supabaseAdmin
      .from('feature_tip_states')
      .update({ dismissed_until: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('tip_id', id)
      .eq('revision', revision)
      .eq('status', 'dismissed');

    // Nudge open clients to re-fetch /feature-tips/pending (content-free).
    const io = req.app.get('io');
    if (io) io.emit('feature_tips_changed');

    const targeted = await resolveAudience(tip.audience);
    res.json({ success: true, data: { revision, targeted_count: targeted.length } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Trigger feature tip error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/feature-tips/:id/roster?revision= — who accepted / snoozed / pending.
// Counts and rows are computed over the CURRENT audience (resolved live), so a
// user who left the audience drops out and new joiners appear as pending.
router.get('/:id/roster', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { data: tip } = await supabaseAdmin
      .from('feature_tips')
      .select('id, current_revision, audience')
      .eq('id', id)
      .single();
    if (!tip) {
      res.status(404).json({ success: false, error: 'Tip not found' });
      return;
    }

    const parsedRev = parseInt(req.query.revision as string, 10);
    const revision = Number.isInteger(parsedRev) ? parsedRev : (tip.current_revision as number);

    const targetUserIds = await resolveAudience(tip.audience);
    const targetSet = new Set(targetUserIds);

    // All state rows for this round, plus distinct revisions for the UI selector.
    const { data: states } = await supabaseAdmin
      .from('feature_tip_states')
      .select('user_id, status, accepted_at, dismissed_until, revision')
      .eq('tip_id', id);

    const now = Date.now();
    const stateForRev = new Map<string, any>();
    const revisionSet = new Set<number>();
    for (const s of (states ?? []) as any[]) {
      revisionSet.add(s.revision);
      if (s.revision === revision) stateForRev.set(s.user_id, s);
    }

    // User display info for the audience (chunked .in to stay under limits).
    const userInfo = new Map<string, any>();
    for (let i = 0; i < targetUserIds.length; i += 500) {
      const chunk = targetUserIds.slice(i, i + 500);
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id, display_name, email, avatar_url')
        .in('id', chunk);
      for (const u of (users ?? []) as any[]) userInfo.set(u.id, u);
    }

    let accepted = 0;
    let snoozed = 0;
    const rows = targetUserIds.map((uid) => {
      const s = stateForRev.get(uid);
      let status: 'accepted' | 'snoozed' | 'pending' = 'pending';
      if (s?.status === 'accepted') {
        status = 'accepted';
        accepted++;
      } else if (s?.status === 'dismissed' && s.dismissed_until && new Date(s.dismissed_until).getTime() > now) {
        status = 'snoozed';
        snoozed++;
      }
      const u = userInfo.get(uid) || { id: uid, display_name: '(unknown)', email: '', avatar_url: null };
      return {
        user: { id: u.id, display_name: u.display_name, email: u.email, avatar_url: u.avatar_url },
        status,
        accepted_at: s?.accepted_at ?? null,
        dismissed_until: s?.dismissed_until ?? null,
      };
    });

    res.json({
      success: true,
      data: {
        revision,
        current_revision: tip.current_revision,
        available_revisions: [...revisionSet].sort((a, b) => a - b),
        counts: {
          accepted,
          snoozed,
          pending: targetSet.size - accepted - snoozed,
          total: targetSet.size,
        },
        rows,
      },
    });
  } catch (err) {
    console.error('Feature tip roster error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
