import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../supabase';
import type { ChatAppVariant } from '@squadhub/shared';

declare global {
  namespace Express {
    interface Request {
      isAdmin?: boolean;
      appVariant?: ChatAppVariant;
      displayName?: string;
    }
  }
}

// Look up the current user's is_admin flag + derive the chat app variant.
// Run AFTER requireAuth. Populates req.isAdmin and req.appVariant.
export async function loadChatContext(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
    return;
  }

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('is_admin, user_type, display_name')
    .eq('id', req.userId)
    .single();

  if (error || !user) {
    res.status(401).json({ success: false, error: 'User not found' });
    return;
  }

  req.isAdmin = !!user.is_admin;
  req.displayName = user.display_name;
  req.appVariant = deriveAppVariant(user.user_type, user.is_admin);
  next();
}

// clients app: client + client_staff
// team app:    partner + internal + any is_admin
export function deriveAppVariant(userType: string | null | undefined, isAdmin: boolean | null | undefined): ChatAppVariant {
  if (userType === 'client' || userType === 'client_staff') return 'clients';
  return 'team';
}

// Block the clients app from accessing DM endpoints.
export function requireTeamVariant(req: Request, res: Response, next: NextFunction): void {
  if (req.appVariant !== 'team') {
    res.status(403).json({ success: false, error: 'DMs are only available in the team app' });
    return;
  }
  next();
}
