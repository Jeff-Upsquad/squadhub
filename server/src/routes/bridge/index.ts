// ============================================================
// Squad Hub SaaS bridge — inbound router, mounted at /bridge/v1.
//
// Server-to-server only (app.squadhub.in → api.squadhub.in). Every request is
// HMAC-verified by requireBridge (utils/bridgeSign.ts): 503 when
// SAAS_BRIDGE_SECRET is unset, 401 on a bad/stale signature. Mount with
// bridgeJsonParser BEFORE the app-wide express.json() so the raw body is kept
// for the signature hash.
// ============================================================
import { Router } from 'express';
import { requireBridge } from '../../utils/bridgeSign';
import businessRoutes from './business';
import talentRoutes from './talent';
import supportRoutes from './support';
import miscRoutes from './misc';

const router = Router();

router.use(requireBridge);
router.use(businessRoutes);
router.use(talentRoutes);
router.use(supportRoutes);
router.use(miscRoutes);

// Unknown bridge path → JSON 404 in the bridge's response shape.
router.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Unknown bridge endpoint' });
});

export default router;
