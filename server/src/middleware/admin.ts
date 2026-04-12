import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../supabase';

// Check if the current user has 'admin' role and is an internal user
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
    return;
  }

  // Only internal users can be admins
  if (req.userType && req.userType !== 'internal') {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return;
  }

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', req.userId)
    .single();

  if (error || !user || user.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return;
  }

  next();
}
