import { Request, Response, NextFunction } from 'express';
import { requireWorkspaceAdmin } from './workspace';

// SaaS: there is no in-app platform admin (the super admin lives in the Hub and
// acts over the bridge). "Admin" means owner/admin of the ACTIVE workspace.
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireWorkspaceAdmin(req, res, next);
}
