import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PARTNER_USER_TYPES, type Project } from '@squadhub/shared';
import { supabaseAdmin as db } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';

// Projects: the shared workspace project entity. Areas (spaces), Spaces
// (folders), and lists each reference one via project_id (nearest-wins), and
// Goals group by them too. Pickers and inline creation read this router;
// bulk management lives under /admin/projects.
const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};

const route = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response) => {
    try {
      const data = await fn(req, res);
      if (!res.headersSent) res.json({ success: true, data: data ?? null });
    } catch (e: any) {
      const status = e instanceof HttpError ? e.status : e instanceof z.ZodError ? 400 : e?.code === '23505' ? 409 : 500;
      if (status === 500) console.error('[pm/projects]', e);
      res.status(status).json({
        success: false,
        error: e instanceof z.ZodError ? e.issues[0]?.message || 'Invalid request'
          : status === 409 ? 'That already exists'
          : status === 500 ? 'Projects are temporarily unavailable'
          : e.message,
      });
    }
  };

const uuid = z.string().uuid();
const color = z.string().regex(/^#[0-9a-f]{6}$/i, 'Choose a valid color');

const COLS = 'id, workspace_id, name, color, description, status, created_by, created_at, updated_at, deleted_at';

/** Workspace membership for the caller. Throws 403 when not a member. */
async function membership(userId: string, workspaceId: string) {
  const { data } = await db.from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle();
  if (!data) return fail(403, 'You do not have access to this workspace');
  const role = data.role || 'member';
  return { role, isAdmin: role === 'admin' || role === 'super_admin' };
}

async function projectFor(userId: string, projectId: string): Promise<Project> {
  const { data: p, error } = await db.from('projects').select(COLS).eq('id', uuid.parse(projectId)).maybeSingle();
  if (error) throw error;
  if (!p || p.deleted_at) return fail(404, 'Project not found');
  await membership(userId, p.workspace_id);
  return p as Project;
}

// Picker list for a workspace. Includes archived (status='inactive') projects
// so a container's current assignment keeps rendering; pickers hide them from
// the choices. Deleted projects are gone entirely.
router.get('/', route(async (req) => {
  const workspaceId = uuid.parse(req.query.workspace_id);
  await membership(req.userId!, workspaceId);
  const { data, error } = await db.from('projects').select(COLS)
    .eq('workspace_id', workspaceId).is('deleted_at', null).order('created_at');
  if (error) throw error;
  return data;
}));

router.post('/', route(async (req) => {
  const body = z.object({
    workspace_id: uuid,
    name: z.string().trim().min(1, 'Name your project').max(160),
    color: color.default('#7c5cff'),
    description: z.string().max(2000).optional(),
  }).parse(req.body);
  await membership(req.userId!, body.workspace_id);
  const { data, error } = await db.from('projects')
    .insert({ ...body, description: body.description || '', created_by: req.userId })
    .select(COLS).single();
  if (error) throw error;
  return data;
}));

router.patch('/:id', route(async (req) => {
  const project = await projectFor(req.userId!, String(req.params.id));
  const body = z.object({
    name: z.string().trim().min(1).max(160).optional(),
    color: color.optional(),
    description: z.string().max(2000).optional(),
    status: z.enum(['active', 'inactive']).optional(),
  }).parse(req.body);
  const { isAdmin } = await membership(req.userId!, project.workspace_id);
  if (project.created_by !== req.userId && !isAdmin) fail(403, 'Only the project owner can change it');
  if (body.status && !isAdmin) fail(403, 'Only workspace admins can archive or restore projects');
  const { data, error } = await db.from('projects')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', project.id).select(COLS).single();
  if (error) throw error;
  return data;
}));

// Soft delete (trash). Containers keep their project_id and resolve to
// "No project" while the project is deleted; restoring brings it back.
router.delete('/:id', route(async (req) => {
  const project = await projectFor(req.userId!, String(req.params.id));
  const { isAdmin } = await membership(req.userId!, project.workspace_id);
  if (project.created_by !== req.userId && !isAdmin) fail(403, 'Only the project owner can delete it');
  const now = new Date().toISOString();
  const { error } = await db.from('projects').update({ deleted_at: now, updated_at: now }).eq('id', project.id);
  if (error) throw error;
}));

export default router;
