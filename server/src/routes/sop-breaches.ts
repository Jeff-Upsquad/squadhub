import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { getItemAccess, meetsAccess } from '../services/lmsAccess';

const router = Router();

// All routes require auth; admin-only ones add requireAdmin per-route.
router.use(requireAuth);

// Helpers — window → ms for counting within window
function windowToMs(value: number, unit: string): number {
  const m: Record<string, number> = {
    minute: 60_000,
    hour: 60 * 60_000,
    day: 24 * 60 * 60_000,
    week: 7 * 24 * 60 * 60_000,
    month: 30 * 24 * 60 * 60_000,
  };
  return value * (m[unit] || m.day);
}

function windowLabel(value: number, unit: string): string {
  const plural = value === 1 ? unit : unit + 's';
  return `last ${value} ${plural}`;
}

// In-memory fallback when migration hasn't been run yet (lets the local demo work without supabase).
const memRules: Map<string, any> = new Map();
const memFlags: any[] = [];
const memStrikes: any[] = [];

async function tableExists(table: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from(table).select('id').limit(1);
  if (!error) return true;
  // PGRST205 = table not found
  if ((error as any).code === 'PGRST205' || error.message.includes('does not exist')) return false;
  return true;
}

/** Platform admin OR per-document LMS admin. */
async function requireDocumentAdmin(itemId: string, userId: string, res: Response): Promise<boolean> {
  const level = await getItemAccess(itemId, userId);
  if (!meetsAccess(level, 'admin')) {
    res.status(403).json({ success: false, error: 'Admin access required for this document' });
    return false;
  }
  return true;
}

/** Live SOP only — drafts/clones cannot own enforcement rules. */
async function liveSopItemId(itemId: string, res: Response): Promise<string | null> {
  const { data: item } = await supabaseAdmin
    .from('lms_items')
    .select('id, origin_item_id, track')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) {
    res.status(404).json({ success: false, error: 'Document not found' });
    return null;
  }
  if ((item as any).origin_item_id) {
    res.status(400).json({ success: false, error: 'Set enforcement on the published SOP, not a draft' });
    return null;
  }
  if ((item as any).track !== 'sop') {
    res.status(400).json({ success: false, error: 'Enforcement rules can only be set on SOPs' });
    return null;
  }
  return (item as any).id as string;
}

// ============================================================
// GET /sop-breaches/rules?item_id=xxx  — list rules for an SOP
// ============================================================
router.get('/rules', async (req: Request, res: Response) => {
  try {
    const itemId = req.query.item_id as string | undefined;
    if (!itemId) { res.status(400).json({ success: false, error: 'item_id required' }); return; }

    const hasTable = await tableExists('sop_enforcement_rules');
    if (!hasTable) {
      const rules = Array.from(memRules.values()).filter((r) => r.item_id === itemId);
      res.json({ success: true, data: rules });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('sop_enforcement_rules')
      .select('*')
      .eq('item_id', itemId)
      .order('created_at', { ascending: true });
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('List SOP rules error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// GET /sop-breaches/all-rules — all rules (for report picker)
// ============================================================
router.get('/all-rules', async (req: Request, res: Response) => {
  try {
    const hasTable = await tableExists('sop_enforcement_rules');
    if (!hasTable) {
      res.json({ success: true, data: Array.from(memRules.values()).filter((r) => r.is_active) });
      return;
    }
    // Include item + lesson titles for picker
    const { data: rules, error } = await supabaseAdmin
      .from('sop_enforcement_rules')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: true });
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }

    // Enrich with titles
    const itemIds = Array.from(new Set((rules || []).map((r: any) => r.item_id)));
    const lessonIds = Array.from(new Set((rules || []).map((r: any) => r.lesson_id).filter(Boolean)));
    let itemMap = new Map<string, string>();
    let lessonMap = new Map<string, string>();
    if (itemIds.length) {
      const { data: items } = await supabaseAdmin.from('lms_items').select('id, title').in('id', itemIds);
      for (const it of items || []) itemMap.set((it as any).id, (it as any).title);
    }
    if (lessonIds.length) {
      const { data: lessons } = await supabaseAdmin.from('lms_lessons').select('id, title').in('id', lessonIds);
      for (const l of lessons || []) lessonMap.set((l as any).id, (l as any).title);
    }
    const enriched = (rules || []).map((r: any) => ({
      ...r,
      item_title: itemMap.get(r.item_id) || r.item_id,
      lesson_title: r.lesson_id ? (lessonMap.get(r.lesson_id) || null) : null,
    }));
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('List all SOP rules error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// PUT /sop-breaches/rules — upsert rule (admin)
// ============================================================
const ruleSchema = z.object({
  item_id: z.string().uuid(),
  lesson_id: z.string().uuid().nullable().optional(),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
  window_value: z.coerce.number().int().min(1).max(999).default(30),
  window_unit: z.enum(['minute', 'hour', 'day', 'week', 'month']).default('day'),
  flag_threshold: z.coerce.number().int().min(1).max(100).default(3),
  // Fractional points are allowed (e.g. 0.5 for a low-severity page).
  strike_points: z.coerce.number().min(0).max(100).default(1),
  is_active: z.boolean().optional(),
});

function roundPoints(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Calendar-month strike-point total (IST), including strikes already saved. */
async function monthlyStrikePoints(userId: string, hasTable: boolean): Promise<number> {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const monthStart = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00+05:30`;
  if (!hasTable) {
    return roundPoints(
      memStrikes
        .filter((s) => s.user_id === userId && s.created_at >= monthStart)
        .reduce((sum, s) => sum + (Number(s.points) || 0), 0),
    );
  }
  const { data } = await supabaseAdmin
    .from('sop_strikes')
    .select('points')
    .eq('user_id', userId)
    .gte('created_at', monthStart);
  return roundPoints((data || []).reduce((sum, s: any) => sum + (Number(s.points) || 0), 0));
}

function zodMessage(err: z.ZodError): string {
  const issue = err.issues?.[0] || (err as any).errors?.[0];
  return issue?.message || 'Invalid rule';
}

router.put('/rules', async (req: Request, res: Response) => {
  try {
    const body = ruleSchema.parse(req.body);
    const liveId = await liveSopItemId(body.item_id, res);
    if (!liveId) return;
    if (!(await requireDocumentAdmin(liveId, req.userId!, res))) return;

    const lessonId = body.lesson_id || null;
    if (lessonId) {
      const { data: lesson } = await supabaseAdmin
        .from('lms_lessons')
        .select('id, item_id')
        .eq('id', lessonId)
        .maybeSingle();
      if (!lesson || (lesson as any).item_id !== liveId) {
        res.status(400).json({ success: false, error: 'Page does not belong to this SOP' });
        return;
      }
    }

    const strikePoints = roundPoints(body.strike_points);
    const hasTable = await tableExists('sop_enforcement_rules');
    if (!hasTable) {
      const key = `${liveId}::${lessonId || 'item'}`;
      const existing = memRules.get(key);
      const rule = {
        id: existing?.id || `mem-${Date.now()}`,
        ...body,
        item_id: liveId,
        lesson_id: lessonId,
        strike_points: strikePoints,
        is_active: body.is_active ?? true,
        created_by: existing?.created_by || req.userId!,
        created_at: existing?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      memRules.set(key, rule);
      res.json({ success: true, data: rule });
      return;
    }

    // Lookup + update/insert so NULL lesson_id (top-page rule) still unique-matches.
    // ON CONFLICT (item_id, lesson_id) never matches NULL = NULL in Postgres.
    let find = supabaseAdmin
      .from('sop_enforcement_rules')
      .select('id')
      .eq('item_id', liveId)
      .limit(1);
    find = lessonId ? find.eq('lesson_id', lessonId) : find.is('lesson_id', null);
    const { data: existingRows, error: findErr } = await find;
    if (findErr) { res.status(500).json({ success: false, error: findErr.message }); return; }
    const existingId = existingRows?.[0]?.id as string | undefined;

    const payload = {
      item_id: liveId,
      lesson_id: lessonId,
      severity: body.severity,
      window_value: body.window_value,
      window_unit: body.window_unit,
      flag_threshold: body.flag_threshold,
      strike_points: strikePoints,
      is_active: body.is_active ?? true,
      updated_at: new Date().toISOString(),
    };

    const query = existingId
      ? supabaseAdmin.from('sop_enforcement_rules').update(payload).eq('id', existingId)
      : supabaseAdmin.from('sop_enforcement_rules').insert({ ...payload, created_by: req.userId! });

    const { data, error } = await query.select().single();
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: zodMessage(err) }); return; }
    console.error('Upsert SOP rule error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /sop-breaches/rules/:id
router.delete('/rules/:id', async (req: Request, res: Response) => {
  try {
    const hasTable = await tableExists('sop_enforcement_rules');
    if (!hasTable) {
      let foundKey: string | null = null;
      let foundItemId: string | null = null;
      for (const [k, v] of memRules.entries()) {
        if (v.id === req.params.id) { foundKey = k; foundItemId = v.item_id; break; }
      }
      if (!foundKey || !foundItemId) { res.status(404).json({ success: false, error: 'Rule not found' }); return; }
      if (!(await requireDocumentAdmin(foundItemId, req.userId!, res))) return;
      memRules.delete(foundKey);
      res.json({ success: true });
      return;
    }
    const { data: rule } = await supabaseAdmin
      .from('sop_enforcement_rules')
      .select('id, item_id')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!rule) { res.status(404).json({ success: false, error: 'Rule not found' }); return; }
    if (!(await requireDocumentAdmin((rule as any).item_id, req.userId!, res))) return;
    const { error } = await supabaseAdmin.from('sop_enforcement_rules').delete().eq('id', req.params.id);
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete SOP rule error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// POST /sop-breaches/report — report a breach (creates a flag)
// ============================================================
const reportSchema = z.object({
  rule_id: z.string().min(1),
  user_id: z.string().uuid(), // who broke the SOP
  reason: z.string().max(500).optional(),
  source_kind: z.enum(['task', 'message', 'manual']).optional(),
  source_id: z.string().optional(),
});

router.post('/report', async (req: Request, res: Response) => {
  try {
    const body = reportSchema.parse(req.body);
    const hasTable = await tableExists('sop_enforcement_rules');

    // Resolve rule
    let rule: any = null;
    if (!hasTable) {
      rule = Array.from(memRules.values()).find((r) => r.id === body.rule_id) || null;
      if (!rule) { res.status(404).json({ success: false, error: 'Rule not found' }); return; }
    } else {
      const { data, error } = await supabaseAdmin.from('sop_enforcement_rules').select('*').eq('id', body.rule_id).maybeSingle();
      if (error || !data) { res.status(404).json({ success: false, error: 'Rule not found or inactive' }); return; }
      rule = data;
      if (!(rule as any).is_active) { res.status(400).json({ success: false, error: 'Rule is inactive' }); return; }
    }

    // Create flag
    let flag: any;
    if (!hasTable) {
      flag = {
        id: `mem-flag-${Date.now()}`,
        rule_id: rule.id,
        user_id: body.user_id,
        reporter_id: req.userId!,
        item_id: rule.item_id,
        lesson_id: rule.lesson_id || null,
        source_kind: body.source_kind || 'manual',
        source_id: body.source_id || null,
        reason: body.reason || null,
        created_at: new Date().toISOString(),
      };
      memFlags.push(flag);
    } else {
      const { data, error } = await supabaseAdmin
        .from('sop_flags')
        .insert({
          rule_id: rule.id,
          user_id: body.user_id,
          reporter_id: req.userId!,
          item_id: rule.item_id,
          lesson_id: rule.lesson_id || null,
          source_kind: body.source_kind || 'manual',
          source_id: body.source_id || null,
          reason: body.reason || null,
        })
        .select()
        .single();
      if (error) { res.status(500).json({ success: false, error: error.message }); return; }
      flag = data;
    }

    // Count flags within window for this user+rule
    const windowMs = windowToMs(rule.window_value, rule.window_unit);
    const since = new Date(Date.now() - windowMs).toISOString();
    let countInWindow = 1;
    let flagIdsInWindow: string[] = [flag.id];
    if (!hasTable) {
      const inWindow = memFlags.filter((f) => f.rule_id === rule.id && f.user_id === body.user_id && f.created_at >= since);
      countInWindow = inWindow.length;
      flagIdsInWindow = inWindow.map((f) => f.id);
    } else {
      const { data: recent, error: countErr } = await supabaseAdmin
        .from('sop_flags')
        .select('id, created_at')
        .eq('rule_id', rule.id)
        .eq('user_id', body.user_id)
        .gte('created_at', since)
        .order('created_at', { ascending: false });
      if (!countErr && recent) {
        countInWindow = recent.length;
        flagIdsInWindow = recent.map((r: any) => r.id);
      }
    }

    const threshold = rule.flag_threshold;
    const isStrike = countInWindow >= threshold;

    // If strike, create strike record
    let strike: any = null;
    if (isStrike) {
      if (!hasTable) {
        strike = {
          id: `mem-strike-${Date.now()}`,
          rule_id: rule.id,
          user_id: body.user_id,
          points: rule.strike_points,
          flag_count: countInWindow,
          window_value: rule.window_value,
          window_unit: rule.window_unit,
          severity: rule.severity,
          flag_ids: flagIdsInWindow,
          created_at: new Date().toISOString(),
        };
        memStrikes.push(strike);
      } else {
        const { data: s, error: sErr } = await supabaseAdmin
          .from('sop_strikes')
          .insert({
            rule_id: rule.id,
            user_id: body.user_id,
            points: rule.strike_points,
            flag_count: countInWindow,
            window_value: rule.window_value,
            window_unit: rule.window_unit,
            severity: rule.severity,
            flag_ids: flagIdsInWindow,
          })
          .select()
          .single();
        if (!sErr) strike = s;
      }
    }

    // Resolve SOP titles for notification
    let itemTitle = rule.item_id;
    let lessonTitle: string | null = null;
    if (!hasTable) {
      itemTitle = rule.item_title || rule.item_id;
    } else {
      const { data: item } = await supabaseAdmin.from('lms_items').select('title, slug').eq('id', rule.item_id).maybeSingle();
      if (item) itemTitle = (item as any).title;
      if (rule.lesson_id) {
        const { data: lesson } = await supabaseAdmin.from('lms_lessons').select('title').eq('id', rule.lesson_id).maybeSingle();
        if (lesson) lessonTitle = (lesson as any).title;
      }
    }

    const sopLabel = lessonTitle ? `${itemTitle} › ${lessonTitle}` : itemTitle;
    const link = `/resources/${rule.item_id}${rule.lesson_id ? `?lesson=${rule.lesson_id}` : ''}`;
    const reason = (body.reason || '').trim();
    const pts = roundPoints(Number(rule.strike_points) || 0);
    const monthlyPoints = await monthlyStrikePoints(body.user_id, hasTable);
    const windowTxt = windowLabel(rule.window_value, rule.window_unit);

    const notifTitle = isStrike ? `SOP strike: ${sopLabel}` : `SOP flag: ${sopLabel}`;
    const notifBody = [
      reason ? `Reason: ${reason}` : null,
      `Flags: ${countInWindow}/${threshold} in ${windowTxt}`,
      isStrike
        ? `This strike: ${pts} pt · Total this month: ${monthlyPoints} pt`
        : `Total strike points this month: ${monthlyPoints} pt`,
    ].filter(Boolean).join('\n');

    // Try to insert notification (best-effort)
    try {
      const hasNotifTable = await tableExists('notifications');
      if (hasNotifTable) {
        const { data: notifRow, error: notifErr } = await supabaseAdmin.from('notifications').insert({
          user_id: body.user_id,
          type: isStrike ? 'sop_strike' : 'sop_flag',
          reference_id: isStrike ? (strike?.id || flag.id) : flag.id,
          reference_type: isStrike ? 'sop_strike' : 'sop_flag',
          actor_id: req.userId!,
          title: notifTitle,
          body: notifBody,
          metadata: {
            rule_id: rule.id,
            item_id: rule.item_id,
            lesson_id: rule.lesson_id || null,
            item_title: itemTitle,
            lesson_title: lessonTitle,
            sop_label: sopLabel,
            severity: rule.severity,
            window_value: rule.window_value,
            window_unit: rule.window_unit,
            window_label: windowTxt,
            flag_threshold: threshold,
            strike_points: pts,
            flag_count: countInWindow,
            monthly_points: monthlyPoints,
            reason: reason || null,
            flag_id: flag.id,
            strike_id: strike?.id || null,
            sop_link: link,
          },
        }).select().single();
        if (notifErr) {
          console.error('SOP notification insert failed:', notifErr.message);
        } else if (notifRow) {
          try {
            const io = (req as any).app.get('io');
            if (io) io.to(`chat_user:${body.user_id}`).emit('new_notification', notifRow);
          } catch {}
        }
      }
    } catch (e) {
      console.error('SOP notification insert failed:', e);
    }

    res.json({
      success: true,
      data: {
        flag,
        strike,
        count_in_window: countInWindow,
        threshold,
        is_strike: isStrike,
        window_label: windowLabel(rule.window_value, rule.window_unit),
        severity: rule.severity,
        strike_points: rule.strike_points,
        sop_link: link,
        sop_label: sopLabel,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return; }
    console.error('Report SOP breach error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// GET /sop-breaches/my-flags — flags for current user (with rule details)
// ============================================================
router.get('/my-flags', async (req: Request, res: Response) => {
  try {
    const hasTable = await tableExists('sop_flags');
    if (!hasTable) {
      const mine = memFlags.filter((f) => f.user_id === req.userId!).map((f) => {
        const rule = Array.from(memRules.values()).find((r) => r.id === f.rule_id) || null;
        return { ...f, rule, item: { id: f.item_id, title: rule?.item_title || f.item_id }, lesson: null };
      });
      res.json({ success: true, data: mine });
      return;
    }
    const { data: flags, error } = await supabaseAdmin
      .from('sop_flags')
      .select('*')
      .eq('user_id', req.userId!)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }

    // Enrich with rule + titles
    const ruleIds = Array.from(new Set((flags || []).map((f: any) => f.rule_id)));
    let ruleMap = new Map<string, any>();
    if (ruleIds.length) {
      const { data: rules } = await supabaseAdmin.from('sop_enforcement_rules').select('*').in('id', ruleIds);
      for (const r of rules || []) ruleMap.set((r as any).id, r);
    }
    const itemIds = Array.from(new Set((flags || []).map((f: any) => f.item_id)));
    let itemMap = new Map<string, any>();
    if (itemIds.length) {
      const { data: items } = await supabaseAdmin.from('lms_items').select('id, title, slug').in('id', itemIds);
      for (const it of items || []) itemMap.set((it as any).id, it);
    }
    const enriched = (flags || []).map((f: any) => ({
      ...f,
      rule: ruleMap.get(f.rule_id) || null,
      item: itemMap.get(f.item_id) || null,
    }));
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('My flags error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// GET /sop-breaches/my-strikes
// ============================================================
router.get('/my-strikes', async (req: Request, res: Response) => {
  try {
    const hasTable = await tableExists('sop_strikes');
    if (!hasTable) {
      const mine = memStrikes.filter((s) => s.user_id === req.userId!).map((s) => {
        const rule = Array.from(memRules.values()).find((r) => r.id === s.rule_id) || null;
        return { ...s, rule, item: { id: s.item_id || rule?.item_id, title: rule?.item_title || 'SOP' } };
      });
      res.json({ success: true, data: mine });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('sop_strikes')
      .select('*')
      .eq('user_id', req.userId!)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('My strikes error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Admin: GET /sop-breaches/admin/flags?user_id=  — all flags
// ============================================================
router.get('/admin/flags', requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = req.query.user_id as string | undefined;
    const hasTable = await tableExists('sop_flags');
    if (!hasTable) {
      let flags = memFlags;
      if (userId) flags = flags.filter((f) => f.user_id === userId);
      // enrich reporter + user display
      res.json({ success: true, data: flags });
      return;
    }
    let q = supabaseAdmin.from('sop_flags').select('*').order('created_at', { ascending: false }).limit(200);
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q;
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }

    // Join users + rules for admin view
    const userIds = Array.from(new Set([...(data || []).map((f: any) => f.user_id), ...(data || []).map((f: any) => f.reporter_id)]));
    let userMap = new Map<string, any>();
    if (userIds.length) {
      const { data: users } = await supabaseAdmin.from('users').select('id, display_name, email, avatar_url').in('id', userIds);
      for (const u of users || []) userMap.set((u as any).id, u);
    }
    const ruleIds = Array.from(new Set((data || []).map((f: any) => f.rule_id)));
    let ruleMap = new Map<string, any>();
    if (ruleIds.length) {
      const { data: rules } = await supabaseAdmin.from('sop_enforcement_rules').select('*').in('id', ruleIds);
      for (const r of rules || []) ruleMap.set((r as any).id, r);
    }
    const enriched = (data || []).map((f: any) => ({
      ...f,
      user: userMap.get(f.user_id) || null,
      reporter: userMap.get(f.reporter_id) || null,
      rule: ruleMap.get(f.rule_id) || null,
    }));
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Admin flags error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Admin: GET /sop-breaches/admin/strikes?user_id=
router.get('/admin/strikes', requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = req.query.user_id as string | undefined;
    const hasTable = await tableExists('sop_strikes');
    if (!hasTable) {
      let strikes = memStrikes;
      if (userId) strikes = strikes.filter((s) => s.user_id === userId);
      res.json({ success: true, data: strikes });
      return;
    }
    let q = supabaseAdmin.from('sop_strikes').select('*').order('created_at', { ascending: false }).limit(200);
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q;
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }

    const userIds = Array.from(new Set((data || []).map((s: any) => s.user_id)));
    let userMap = new Map<string, any>();
    if (userIds.length) {
      const { data: users } = await supabaseAdmin.from('users').select('id, display_name, email, avatar_url').in('id', userIds);
      for (const u of users || []) userMap.set((u as any).id, u);
    }
    const ruleIds = Array.from(new Set((data || []).map((s: any) => s.rule_id)));
    let ruleMap = new Map<string, any>();
    if (ruleIds.length) {
      const { data: rules } = await supabaseAdmin.from('sop_enforcement_rules').select('*').in('id', ruleIds);
      for (const r of rules || []) ruleMap.set((r as any).id, r);
    }
    const enriched = (data || []).map((s: any) => ({
      ...s,
      user: userMap.get(s.user_id) || null,
      rule: ruleMap.get(s.rule_id) || null,
    }));
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Admin strikes error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Admin: GET /sop-breaches/admin/summary — per-user flag/strike counts
router.get('/admin/summary', requireAdmin, async (req: Request, res: Response) => {
  try {
    const hasTable = await tableExists('sop_flags');
    if (!hasTable) {
      const byUser = new Map<string, { flags: number; strikes: number; points: number }>();
      for (const f of memFlags) {
        const cur = byUser.get(f.user_id) || { flags: 0, strikes: 0, points: 0 };
        cur.flags++;
        byUser.set(f.user_id, cur);
      }
      for (const s of memStrikes) {
        const cur = byUser.get(s.user_id) || { flags: 0, strikes: 0, points: 0 };
        cur.strikes++; cur.points += Number(s.points) || 0;
        byUser.set(s.user_id, cur);
      }
      const users = Array.from(byUser.entries()).map(([user_id, v]) => ({ user_id, ...v }));
      res.json({ success: true, data: users });
      return;
    }
    const { data: flags } = await supabaseAdmin.from('sop_flags').select('user_id');
    const { data: strikes } = await supabaseAdmin.from('sop_strikes').select('user_id, points');
    const byUser = new Map<string, { flags: number; strikes: number; points: number }>();
    for (const f of flags || []) {
      const cur = byUser.get((f as any).user_id) || { flags: 0, strikes: 0, points: 0 };
      cur.flags++; byUser.set((f as any).user_id, cur);
    }
    for (const s of strikes || []) {
      const cur = byUser.get((s as any).user_id) || { flags: 0, strikes: 0, points: 0 };
      cur.strikes++; cur.points += Number((s as any).points) || 0;
      byUser.set((s as any).user_id, cur);
    }
    // enrich with user display
    const ids = Array.from(byUser.keys());
    let userMap = new Map<string, any>();
    if (ids.length) {
      const { data: users } = await supabaseAdmin.from('users').select('id, display_name, email, avatar_url').in('id', ids);
      for (const u of users || []) userMap.set((u as any).id, u);
    }
    const summary = Array.from(byUser.entries()).map(([uid, v]) => ({
      user_id: uid,
      user: userMap.get(uid) || { id: uid },
      ...v,
    })).sort((a, b) => b.points - a.points || b.flags - a.flags);
    res.json({ success: true, data: summary });
  } catch (err) {
    console.error('Admin summary error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
