import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

// Admin surface for CRM access management. Reads/writes the crm_* access
// tables in the shared Supabase project (those tables are OWNED by the
// SquadCRM migration 025_crm_access_management.sql; here we only consume
// and write them, the same way this admin already manages workspace_members
// and client_user_access). SquadCRM's crm-server enforces what we set here.

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

// Apps other than SquadCRM (e.g. SquadHire) keep their grants in their OWN
// Supabase, which this server can't reach. For app=squadhire, proxy the whole
// request to that app's shcrm-server admin API over a shared secret. SquadCRM
// (shared Supabase) falls through to the local handlers below.
const SHCRM_ADMIN_API_URL = process.env.SHCRM_ADMIN_API_URL || '';
const SHCRM_ADMIN_API_SECRET = process.env.SHCRM_ADMIN_API_SECRET || '';

router.use(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const app = (req.query.app as string) || (req.body && (req.body as { app?: string }).app);
  if (app !== 'squadhire') {
    next();
    return;
  }
  if (!SHCRM_ADMIN_API_URL || !SHCRM_ADMIN_API_SECRET) {
    res.status(503).json({ success: false, error: 'SquadHire CRM admin link not configured' });
    return;
  }
  try {
    const url = new URL(`${SHCRM_ADMIN_API_URL}/admin/crm-access${req.path}`);
    for (const [k, v] of Object.entries(req.query)) {
      if (typeof v === 'string') url.searchParams.set(k, v);
    }
    const init: RequestInit = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'x-crm-access-signature': SHCRM_ADMIN_API_SECRET,
      },
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = JSON.stringify(req.body ?? {});
    }
    const upstream = await fetch(url, init);
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(text);
  } catch (err) {
    console.error('SquadHire CRM admin proxy error:', err);
    res.status(502).json({ success: false, error: 'SquadHire CRM is unreachable' });
  }
});

const CRM_ROLES = ['admin', 'member', 'guest'] as const;
// 'none' = explicitly denied: the user has CRM app access but is locked out of
// this module. SquadCRM's crm-server must treat 'none' as DENY when enforcing.
const CRM_LEVELS = ['view', 'full', 'admin', 'none'] as const;
const appSchema = z.string().min(1).default('squadcrm');

// GET /admin/crm-access/modules?app=squadcrm — the module registry (matrix columns).
router.get('/modules', async (req: Request, res: Response) => {
  try {
    const app = (req.query.app as string) || 'squadcrm';
    const { data, error } = await supabaseAdmin
      .from('crm_modules')
      .select('app, key, label, sort')
      .eq('app', app)
      .eq('is_active', true)
      .order('sort', { ascending: true });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('CRM access list modules error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/crm-access/workspaces — workspaces to pick from.
router.get('/workspaces', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('workspaces')
      .select('id, name')
      .order('name');
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('CRM access list workspaces error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/crm-access/workspace-config?workspace_id=… — enforcement flag.
router.get('/workspace-config', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string | undefined;
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id required' });
      return;
    }
    const { data } = await supabaseAdmin
      .from('crm_workspace_config')
      .select('workspace_id, access_enforcement_enabled')
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    res.json({
      success: true,
      data: { workspace_id: workspaceId, access_enforcement_enabled: data?.access_enforcement_enabled === true },
    });
  } catch (err) {
    console.error('CRM access get workspace-config error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /admin/crm-access/workspace-config — toggle enforcement for a workspace.
const wsConfigSchema = z.object({
  workspace_id: z.string().uuid(),
  access_enforcement_enabled: z.boolean(),
});
router.patch('/workspace-config', async (req: Request, res: Response) => {
  try {
    const body = wsConfigSchema.parse(req.body);
    const { error } = await supabaseAdmin
      .from('crm_workspace_config')
      .upsert(
        { workspace_id: body.workspace_id, access_enforcement_enabled: body.access_enforcement_enabled },
        { onConflict: 'workspace_id' },
      );
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: { workspace_id: body.workspace_id, access_enforcement_enabled: body.access_enforcement_enabled } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('CRM access set workspace-config error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/crm-access/users?workspace_id=…&app=squadcrm
// ONLY the users who have been granted CRM access (the access list), enriched
// with their role + per-module overrides. Empty until people are added — this
// is an invite/grant list, NOT the full workspace roster.
router.get('/users', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string | undefined;
    const app = (req.query.app as string) || 'squadcrm';
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id required' });
      return;
    }

    const { data: grants, error } = await supabaseAdmin
      .from('crm_app_access')
      .select('user_id, role, enabled')
      .eq('workspace_id', workspaceId)
      .eq('app', app);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!grants || grants.length === 0) {
      res.json({ success: true, data: { workspace_id: workspaceId, app, members: [] } });
      return;
    }

    const userIds = Array.from(new Set(grants.map((g: any) => g.user_id)));
    const usersMap: Record<string, any> = {};
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, avatar_url, user_type')
      .in('id', userIds);
    (users || []).forEach((u: any) => { usersMap[u.id] = u; });

    const { data: overrides } = await supabaseAdmin
      .from('crm_module_access')
      .select('user_id, module, level')
      .eq('workspace_id', workspaceId)
      .eq('app', app);
    const overrideMap: Record<string, Record<string, string>> = {};
    (overrides || []).forEach((o: any) => {
      (overrideMap[o.user_id] = overrideMap[o.user_id] || {})[o.module] = o.level;
    });

    const membersOut = grants.map((g: any) => ({
      user_id: g.user_id,
      user: usersMap[g.user_id] || null,
      access: { role: g.role, enabled: g.enabled },
      module_levels: overrideMap[g.user_id] || {},
    }));

    res.json({ success: true, data: { workspace_id: workspaceId, app, members: membersOut } });
  } catch (err) {
    console.error('CRM access list users error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/crm-access/candidates?workspace_id=…&app=squadcrm&q=…
// Workspace members NOT yet granted CRM access — the pool for "Add user".
router.get('/candidates', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string | undefined;
    const app = (req.query.app as string) || 'squadcrm';
    const q = ((req.query.q as string) || '').trim().toLowerCase();
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id required' });
      return;
    }

    const { data: members } = await supabaseAdmin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId);
    const memberIds = Array.from(new Set((members || []).map((m: any) => m.user_id)));
    if (memberIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const { data: grants } = await supabaseAdmin
      .from('crm_app_access')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('app', app);
    const granted = new Set((grants || []).map((g: any) => g.user_id));
    const candidateIds = memberIds.filter((id) => !granted.has(id));
    if (candidateIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, avatar_url, user_type')
      .in('id', candidateIds);

    let out = (users || []) as any[];
    if (q) {
      out = out.filter(
        (u: any) =>
          (u.display_name || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q),
      );
    }
    out.sort((a: any, b: any) => (a.display_name || '').localeCompare(b.display_name || ''));
    res.json({ success: true, data: out });
  } catch (err) {
    console.error('CRM access list candidates error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/crm-access/grant — grant/enable app access at a role.
const grantSchema = z.object({
  user_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  app: appSchema,
  role: z.enum(CRM_ROLES),
});
router.post('/grant', async (req: Request, res: Response) => {
  try {
    const body = grantSchema.parse(req.body);

    // Soft membership check — only workspace members can be granted CRM access.
    const { data: member } = await supabaseAdmin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', body.workspace_id)
      .eq('user_id', body.user_id)
      .maybeSingle();
    if (!member) {
      res.status(400).json({ success: false, error: 'User is not a member of this workspace' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('crm_app_access')
      .upsert(
        {
          user_id: body.user_id,
          workspace_id: body.workspace_id,
          app: body.app,
          role: body.role,
          enabled: true,
          granted_by: req.userId,
        },
        { onConflict: 'user_id,workspace_id,app' },
      )
      .select()
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // A newly added user starts with NO access to any module — the admin then
    // grants specific modules from the list. ignoreDuplicates keeps any
    // pre-existing per-module overrides intact rather than clobbering them.
    const { data: mods } = await supabaseAdmin
      .from('crm_modules')
      .select('key')
      .eq('app', body.app)
      .eq('is_active', true);
    const seedRows = (mods || []).map((m: { key: string }) => ({
      user_id: body.user_id,
      workspace_id: body.workspace_id,
      app: body.app,
      module: m.key,
      level: 'none',
      granted_by: req.userId,
    }));
    if (seedRows.length > 0) {
      await supabaseAdmin
        .from('crm_module_access')
        .upsert(seedRows, { onConflict: 'user_id,workspace_id,app,module', ignoreDuplicates: true });
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('CRM access grant error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /admin/crm-access/grant — change role and/or enabled (revoke = enabled:false).
const updateGrantSchema = z.object({
  user_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  app: appSchema,
  role: z.enum(CRM_ROLES).optional(),
  enabled: z.boolean().optional(),
});
router.patch('/grant', async (req: Request, res: Response) => {
  try {
    const body = updateGrantSchema.parse(req.body);
    const patch: Record<string, unknown> = {};
    if (body.role !== undefined) patch.role = body.role;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ success: false, error: 'Nothing to update' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('crm_app_access')
      .update(patch)
      .eq('user_id', body.user_id)
      .eq('workspace_id', body.workspace_id)
      .eq('app', body.app)
      .select()
      .maybeSingle();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ success: false, error: 'No grant to update (grant access first)' });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('CRM access update grant error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/crm-access/module-level — set or clear a per-module override.
// level=null removes the override (reverts to the role default).
const moduleLevelSchema = z.object({
  user_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  app: appSchema,
  module: z.string().min(1),
  level: z.enum(CRM_LEVELS).nullable(),
});
router.put('/module-level', async (req: Request, res: Response) => {
  try {
    const body = moduleLevelSchema.parse(req.body);

    if (body.level === null) {
      const { error } = await supabaseAdmin
        .from('crm_module_access')
        .delete()
        .eq('user_id', body.user_id)
        .eq('workspace_id', body.workspace_id)
        .eq('app', body.app)
        .eq('module', body.module);
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
      res.json({ success: true, data: { module: body.module, level: null } });
      return;
    }

    // Validate the module exists for this app.
    const { data: mod } = await supabaseAdmin
      .from('crm_modules')
      .select('key')
      .eq('app', body.app)
      .eq('key', body.module)
      .maybeSingle();
    if (!mod) {
      res.status(400).json({ success: false, error: 'Unknown module for this app' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('crm_module_access')
      .upsert(
        {
          user_id: body.user_id,
          workspace_id: body.workspace_id,
          app: body.app,
          module: body.module,
          level: body.level,
          granted_by: req.userId,
        },
        { onConflict: 'user_id,workspace_id,app,module' },
      )
      .select()
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
    console.error('CRM access set module-level error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/crm-access/grant — remove a user from the CRM access list
// (deletes the grant + any per-module overrides).
const deleteGrantSchema = z.object({
  user_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  app: appSchema,
});
router.delete('/grant', async (req: Request, res: Response) => {
  try {
    const body = deleteGrantSchema.parse(req.body);
    await supabaseAdmin
      .from('crm_module_access')
      .delete()
      .eq('user_id', body.user_id)
      .eq('workspace_id', body.workspace_id)
      .eq('app', body.app);
    const { error } = await supabaseAdmin
      .from('crm_app_access')
      .delete()
      .eq('user_id', body.user_id)
      .eq('workspace_id', body.workspace_id)
      .eq('app', body.app);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('CRM access delete grant error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
