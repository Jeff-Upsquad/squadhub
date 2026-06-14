import { Router, Request, Response } from 'express';
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

const CRM_ROLES = ['admin', 'member', 'guest'] as const;
const CRM_LEVELS = ['view', 'full', 'admin'] as const;
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
// Workspace members enriched with their CRM grant + per-module overrides.
router.get('/users', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string | undefined;
    const app = (req.query.app as string) || 'squadcrm';
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id required' });
      return;
    }

    const { data: members, error } = await supabaseAdmin
      .from('workspace_members')
      .select('user_id, role')
      .eq('workspace_id', workspaceId);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const userIds = Array.from(new Set((members || []).map((m: any) => m.user_id)));
    const usersMap: Record<string, any> = {};
    if (userIds.length > 0) {
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id, display_name, email, avatar_url, user_type')
        .in('id', userIds);
      (users || []).forEach((u: any) => { usersMap[u.id] = u; });
    }

    const { data: grants } = await supabaseAdmin
      .from('crm_app_access')
      .select('user_id, role, enabled')
      .eq('workspace_id', workspaceId)
      .eq('app', app);
    const grantMap: Record<string, any> = {};
    (grants || []).forEach((g: any) => { grantMap[g.user_id] = g; });

    const { data: overrides } = await supabaseAdmin
      .from('crm_module_access')
      .select('user_id, module, level')
      .eq('workspace_id', workspaceId)
      .eq('app', app);
    const overrideMap: Record<string, Record<string, string>> = {};
    (overrides || []).forEach((o: any) => {
      (overrideMap[o.user_id] = overrideMap[o.user_id] || {})[o.module] = o.level;
    });

    const membersOut = (members || []).map((m: any) => ({
      user_id: m.user_id,
      membership_role: m.role,
      user: usersMap[m.user_id] || null,
      access: grantMap[m.user_id]
        ? { role: grantMap[m.user_id].role, enabled: grantMap[m.user_id].enabled }
        : null,
      module_levels: overrideMap[m.user_id] || {},
    }));

    res.json({ success: true, data: { workspace_id: workspaceId, app, members: membersOut } });
  } catch (err) {
    console.error('CRM access list users error:', err);
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

export default router;
