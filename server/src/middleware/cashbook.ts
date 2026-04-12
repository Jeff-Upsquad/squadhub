import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../supabase';
import type { CashBookUserRole } from '@squadhub/shared';

// Extend Express Request for cash book context
declare global {
  namespace Express {
    interface Request {
      cashBookClientId?: string;
      cashBookRole?: CashBookUserRole;
    }
  }
}

/**
 * Verify the authenticated user has cash book access.
 * Attaches cashBookClientId and cashBookRole to the request.
 */
export async function requireCashBookAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
    return;
  }

  // Look up user in cash_book_users
  const { data: cbUser, error: cbError } = await supabaseAdmin
    .from('cash_book_users')
    .select('client_id, role, is_active')
    .eq('user_id', req.userId)
    .eq('is_active', true)
    .maybeSingle();

  if (cbError || !cbUser) {
    res.status(403).json({ success: false, error: 'Cash book access not granted' });
    return;
  }

  // Verify the client's cash book access is enabled
  const { data: access } = await supabaseAdmin
    .from('cash_book_client_access')
    .select('is_enabled')
    .eq('client_id', cbUser.client_id)
    .eq('is_enabled', true)
    .maybeSingle();

  if (!access) {
    res.status(403).json({ success: false, error: 'Cash book is not enabled for this client' });
    return;
  }

  req.cashBookClientId = cbUser.client_id;
  req.cashBookRole = cbUser.role as CashBookUserRole;
  next();
}

/**
 * Require the cash book user to be a client_admin.
 * Must be used after requireCashBookAccess.
 */
export async function requireCashBookAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.cashBookRole !== 'client_admin') {
    res.status(403).json({ success: false, error: 'Client admin access required' });
    return;
  }
  next();
}
