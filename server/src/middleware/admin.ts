import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../supabase';

// Platform Admin is a protected workspace role mirrored by users.is_admin.
// The durable flag remains the authorization gate so a partial/manual role
// assignment cannot accidentally grant access to the platform admin panel.
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
    return;
  }

  // Admin remains an Internal user classification.
  if (req.userType && req.userType !== 'internal') {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return;
  }

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('is_admin')
    .eq('id', req.userId)
    .single();

  if (error || !user?.is_admin) {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return;
  }

  next();
}
