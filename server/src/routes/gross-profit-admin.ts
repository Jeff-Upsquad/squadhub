import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { computeGrossProfit, Granularity } from '../utils/grossProfitPeriod';

const router = Router();

router.use(requireAuth, requireAdmin);

// GET /admin/gross-profit/clients?granularity=month|quarter|year&anchor=&currency=&subscription=
//
// Period-scoped gross profit per client (business), computed from the
// subscription_assignment_terms billing ledger: revenue = the finalized
// subscription price and partner cost = the finalized partner payout, both
// prorated across the days each engagement was active in the selected period
// (see utils/grossProfitPeriod). Aggregated per business + currency; each
// client carries the per-subscription `lines` that power the drill-in, so the
// UI needs no second request.
const GRANULARITIES: Granularity[] = ['month', 'quarter', 'year'];

router.get('/clients', async (req: Request, res: Response) => {
  try {
    const granularity = GRANULARITIES.includes(req.query.granularity as Granularity)
      ? (req.query.granularity as Granularity)
      : 'month';
    const anchor = typeof req.query.anchor === 'string' ? req.query.anchor : undefined;
    const currency =
      typeof req.query.currency === 'string' && req.query.currency ? req.query.currency : null;
    const subscription =
      typeof req.query.subscription === 'string' && req.query.subscription
        ? req.query.subscription
        : null;

    const data = await computeGrossProfit({ granularity, anchor, currency, subscription });
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('Gross profit clients error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
