import { Request, Response, NextFunction } from 'express';
import type { UserType } from '@squadhub/shared';

/**
 * Middleware that restricts access to specific user types.
 * Usage: requireUserType('internal') or requireUserType('internal', 'partner')
 */
export function requireUserType(...allowedTypes: UserType[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.userType || !allowedTypes.includes(req.userType)) {
      res.status(403).json({ success: false, error: 'Access denied for your user type' });
      return;
    }
    next();
  };
}
