import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

const router = Router();

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

// GET /partner-app/version — public, no auth. App polls on launch + periodically.
router.get('/version', (_req: Request, res: Response) => {
  res.json({ success: true, data: cached ?? loadManifest() });
});

export default router;
