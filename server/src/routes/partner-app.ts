import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { config } from '../config';
import { rateLimit } from '../utils/rateLimit';
import { requireAuth } from '../middleware/auth';
import { recordPartnerAppSighting } from '../utils/partnerAppInstalls';

const router = Router();

const iosWaitlistSchema = z.object({
  email: z.string().trim().email().max(320),
  phone: z.string().trim().regex(/^[+()\d\s-]{10,25}$/),
}).strict();

router.post(
  '/ios-waitlist',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    // Caddy appends the actual visitor as the last forwarded hop. This API
    // runs behind Caddy, while req.ip alone is its Docker gateway address.
    keyFn: (req) => req.header('x-forwarded-for')?.split(',').at(-1)?.trim() || req.ip || 'unknown',
  }),
  async (req: Request, res: Response) => {
    const parsed = iosWaitlistSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.phone.replace(/\D/g, '').length < 10 || parsed.data.phone.replace(/\D/g, '').length > 15) {
      res.status(400).json({ success: false, error: 'Enter a valid email and phone number.' });
      return;
    }
    if (!config.squadhireWebhookUrl || !config.squadhireWebhookSecret) {
      res.status(503).json({ success: false, error: 'Waitlist is temporarily unavailable. Please try again later.' });
      return;
    }

    try {
      const url = new URL(config.squadhireWebhookUrl);
      url.pathname = '/api/integrations/squadhub/partner-ios-waitlist';
      url.search = '';
      const upstream = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SquadHub-Signature': config.squadhireWebhookSecret,
        },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(10_000),
      });
      if (!upstream.ok) {
        console.error('[partner-app/ios-waitlist] SquadHire responded', upstream.status);
        res.status(503).json({ success: false, error: 'Waitlist is temporarily unavailable. Please try again later.' });
        return;
      }
      // Do not expose whether a given email/phone pair exists in SquadHire.
      res.json({ success: true });
    } catch (err) {
      console.error('[partner-app/ios-waitlist] SquadHire request failed:', (err as Error).message);
      res.status(503).json({ success: false, error: 'Waitlist is temporarily unavailable. Please try again later.' });
    }
  },
);

const checkinSchema = z.object({
  version_name: z.string().trim().min(1).max(50),
  version_code: z.number().int().positive(),
  platform: z.enum(['ios', 'android']),
}).strict();

// POST /partner-app/checkin — the native app reports its build on every
// signed-in launch. Feeds partner_app_installs, which SquadHire reads to tick
// "Partner app downloaded" on its onboarding boards.
router.post('/checkin', requireAuth, async (req: Request, res: Response) => {
  const parsed = checkinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    return;
  }
  try {
    await recordPartnerAppSighting(req.userId!, parsed.data);
    res.json({ success: true });
  } catch (err) {
    console.error('[partner-app/checkin] failed:', (err as Error).message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Public — no auth required (visited by partners before they have an account)
router.get('/app-config', (_req: Request, res: Response) => {
  res.json({
    minVersion: config.partnerAppMinVersion,
    downloadUrl: config.partnerAppDownloadUrl,
  });
});

// ---------------------------------------------------------------------------
// In-app updater (sideloaded APK). Mirrors the Squad CRM /mobile/version flow:
// the native partner app polls this on launch + periodically, compares
// `version_code` against its own versionCode, and prompts to download+install
// the APK at `apk_url` (verifying `sha256`). `force_update` makes the prompt
// blocking; `min_supported_version_code` lets us hard-cut legacy builds.
// ---------------------------------------------------------------------------
interface VersionManifest {
  version_code: number;
  version_name: string;
  apk_url: string;
  sha256: string;
  release_notes: string;
  force_update: boolean;
  min_supported_version_code: number;
  // Optional explicit publish time (ISO 8601). When absent, /version derives it
  // from the manifest file's mtime, which the release flow bumps on every edit.
  published_at?: string;
}

// Returned when the manifest file is missing/unreadable so the endpoint never
// hard-fails — version_code matches the current shipped build, so clients see
// "no update" rather than an error.
const FALLBACK_MANIFEST: VersionManifest = {
  version_code: 1,
  version_name: '2.0.0',
  apk_url: '',
  sha256: '',
  release_notes: '',
  force_update: false,
  min_supported_version_code: 1,
};

let cached: VersionManifest | null = null;
let cachedPath: string | null = null;

function manifestPath(): string {
  if (cachedPath) return cachedPath;
  const fromEnv = process.env.PARTNER_RELEASE_MANIFEST_PATH;
  // Default resolves to <server>/partner-release-manifest.json in both dev
  // (src/routes) and the built image (dist/routes) — two levels up from here.
  cachedPath = fromEnv ? path.resolve(fromEnv) : path.resolve(__dirname, '../../partner-release-manifest.json');
  return cachedPath;
}

function loadManifest(): VersionManifest {
  const p = manifestPath();
  try {
    cached = JSON.parse(fs.readFileSync(p, 'utf8')) as VersionManifest;
    return cached;
  } catch (err) {
    console.warn('[partner-app/version] manifest not loaded:', (err as Error).message, 'at', p, '— using fallback');
    cached = null;
    return FALLBACK_MANIFEST;
  }
}

// Load once on init and watch the file so editing it on the server (e.g. after
// uploading a new APK) takes effect without a restart.
loadManifest();
try {
  fs.watchFile(manifestPath(), { interval: 5000 }, () => {
    console.log('[partner-app/version] manifest changed, reloading');
    loadManifest();
  });
} catch {
  /* ignore — falls back to a fresh read on each request */
}

/** The live release manifest (what the in-app updater offers right now). */
export function currentPartnerManifest(): VersionManifest {
  return cached ?? loadManifest();
}

// GET /partner-app/version — public, no auth. App polls on launch + periodically.
router.get('/version', (_req: Request, res: Response) => {
  const manifest = cached ?? loadManifest();
  // "Last updated" for the public download page. Prefer an explicit
  // published_at in the manifest; otherwise fall back to the manifest file's
  // mtime — the release flow rewrites this file on every publish, so its mtime
  // tracks the latest release. The native updater ignores the extra field.
  let published_at = manifest.published_at;
  if (!published_at) {
    try {
      published_at = fs.statSync(manifestPath()).mtime.toISOString();
    } catch {
      /* ignore — omit published_at if the file can't be stat'd */
    }
  }
  res.json({ success: true, data: { ...manifest, published_at } });
});

export default router;
