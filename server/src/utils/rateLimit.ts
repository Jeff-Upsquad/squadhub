/**
 * Minimal fixed-window rate limiter.
 *
 * Added for the self-serve password-reset endpoints, which are unauthenticated
 * and hand out live credentials — without a cap, the phone lookup could be used
 * to enumerate registered numbers and the temp password could be brute-forced.
 *
 * Deliberately in-process and dependency-free: SquadHub runs as a single API
 * process on one VPS, so a shared store would be complexity without benefit.
 * If the API is ever scaled horizontally this needs to move to Redis/Postgres,
 * since each process would otherwise enforce its own separate budget.
 */

import type { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

export function rateLimit(opts: {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Requests allowed per key per window. */
  max: number;
  /** Bucket key — defaults to client IP. */
  keyFn?: (req: Request) => string;
  message?: string;
}) {
  const buckets = new Map<string, Bucket>();
  const message = opts.message ?? 'Too many requests. Please try again in a few minutes.';

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();

    // Sweep expired buckets so the map can't grow without bound.
    if (buckets.size > 5_000) {
      for (const [k, v] of buckets) {
        if (v.resetAt <= now) buckets.delete(k);
      }
    }

    const key = opts.keyFn ? opts.keyFn(req) : req.ip || 'unknown';
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > opts.max) {
      res.status(429).json({ success: false, error: message });
      return;
    }
    next();
  };
}
