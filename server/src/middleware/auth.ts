import { Request, Response, NextFunction } from 'express';
import { supabaseAuth } from '../supabase';
import { supabaseAdmin } from '../supabase';
import type { UserType } from '@squadhub/shared';

// Extend Express Request to include user info
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      userName?: string;
      userType?: UserType;
    }
  }
}

// Verify token using Supabase's own auth verification
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);

    if (error || !data.user) {
      res.status(401).json({ success: false, error: 'Invalid or expired token' });
      return;
    }

    req.userId = data.user.id;
    req.userEmail = data.user.email;

    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('user_type, status, display_name')
      .eq('id', data.user.id)
      .single();

    if (profile?.status === 'banned') {
      res.status(403).json({ success: false, error: 'Your account has been banned.' });
      return;
    }
    if (profile?.status === 'suspended') {
      res.status(403).json({ success: false, error: 'Your account has been suspended.' });
      return;
    }

    req.userType = (profile?.user_type as UserType) || 'internal';
    req.userName = (profile?.display_name as string) || undefined;

    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

// Check if user has super_admin role in the workspace
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if ((req as any).workspaceRole !== 'super_admin') {
    res.status(403).json({ success: false, error: 'Super admin access required' });
    return;
  }
  next();
}
