import { Request, Response, NextFunction } from 'express';
import { userHasMiniApp } from '../utils/miniAppAccess';

/**
 * Gate a route behind a mini app: allow internal admins (full access, matching
 * requireAdmin) OR any user granted the mini app identified by `slug`
 * (role-based or direct). Use this to expose admin-grade management endpoints
 * to non-admin users who have been given the corresponding mini app.
 */
export function requireMiniAppOrAdmin(slug: string) {
  return requireAnyMiniAppOrAdmin([slug]);
}

/**
 * Same gate, but satisfied by ANY of several mini apps. Use where one endpoint
 * legitimately serves more than one module — e.g. the SquadHire category
 * picker, which both Sales Leads and Leads need.
 */
export function requireAnyMiniAppOrAdmin(slugs: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    if (!req.workspaceId) {
      res.status(400).json({ success: false, error: 'X-Workspace-Id header is required' });
      return;
    }

    // SaaS: the ACTIVE workspace must have one of the listed apps enabled.
    // (The Hub's platform-admin bypass does not exist here.)
    for (const slug of slugs) {
      if (await userHasMiniApp(req.userId, slug)) {
        next();
        return;
      }
    }

    res
      .status(403)
      .json({ success: false, error: `Access denied: requires the ${slugs.join(' or ')} app` });
  };
}
