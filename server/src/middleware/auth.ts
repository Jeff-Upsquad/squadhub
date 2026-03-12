import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

// Extend Express Request to include user info
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
    }
  }
}

// Verify JWT token on protected routes
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { sub: string; email: string };
    req.userId = decoded.sub;
    req.userEmail = decoded.email;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

// Check if user has super_admin role in the workspace
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  // This will be fully implemented when we have the workspace context middleware
  // For now, we check the role from the request (set by a prior middleware)
  if ((req as any).workspaceRole !== 'super_admin') {
    res.status(403).json({ success: false, error: 'Super admin access required' });
    return;
  }
  next();
}
