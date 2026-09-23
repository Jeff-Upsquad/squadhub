/**
 * Block a request that belongs to the Work side of SquadHub when the caller is
 * a partner who has no work yet (see utils/workAccess for the whole picture).
 *
 * Most work endpoints need no guard: they resolve through resource_memberships
 * and a pre-work partner holds none, so they answer with nothing. This is for
 * the handful that would otherwise reach across the whole workspace — the
 * roster and starting a conversation with it.
 *
 * Answers 403 with code WORK_LOCKED so a client can tell it apart from a
 * permission error and from an expired session (which is a 401 and logs out).
 */

import type { Request, Response, NextFunction } from 'express';
import { isUserWorkLocked } from '../utils/workAccess';

export async function requireWorkUnlocked(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.userId) {
    next();
    return;
  }
  if (await isUserWorkLocked(req.userId)) {
    res.status(403).json({
      success: false,
      code: 'WORK_LOCKED',
      error: 'Your work space unlocks when you get your first project. Browse Discover to find work.',
    });
    return;
  }
  next();
}
