import { Router, Request, Response } from 'express';
import { config } from '../config';

const router = Router();

// Public — no auth required (visited by partners before they have an account)
router.get('/app-config', (_req: Request, res: Response) => {
  res.json({
    minVersion: config.partnerAppMinVersion,
    downloadUrl: config.partnerAppDownloadUrl,
  });
});

export default router;
