import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

// ---------------------------------------------------------------------------
// In-app updater for the sideloaded Squad Hub Business app (in.squadhub.business).
// Parallel to /partner-app/version but reads a SEPARATE manifest, so the two
// apps' update channels never cross. The native app polls this on launch,
// compares `version_code` against its own versionCode, and prompts to
// download+install the APK at `apk_url` (verifying `sha256`).
// ---------------------------------------------------------------------------
interface VersionManifest {
  version_code: number;
  version_name: string;
  apk_url: string;
  sha256: string;
  release_notes: string;
  force_update: boolean;
  min_supported_version_code: number;
  published_at?: string;
}

// Returned when the manifest is missing/unreadable so the endpoint never
// hard-fails — version_code matches the first shipped build, so clients see
// "no update" rather than an error.
const FALLBACK_MANIFEST: VersionManifest = {
  version_code: 1,
  version_name: '1.0.0',
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
  const fromEnv = process.env.BUSINESS_RELEASE_MANIFEST_PATH;
  cachedPath = fromEnv ? path.resolve(fromEnv) : path.resolve(__dirname, '../../business-release-manifest.json');
  return cachedPath;
}

function loadManifest(): VersionManifest {
  const p = manifestPath();
  try {
    cached = JSON.parse(fs.readFileSync(p, 'utf8')) as VersionManifest;
    return cached;
  } catch (err) {
    console.warn('[business-app/version] manifest not loaded:', (err as Error).message, 'at', p, '— using fallback');
    cached = null;
    return FALLBACK_MANIFEST;
  }
}

loadManifest();
try {
  fs.watchFile(manifestPath(), { interval: 5000 }, () => {
    console.log('[business-app/version] manifest changed, reloading');
    loadManifest();
  });
} catch {
  /* ignore — falls back to a fresh read on each request */
}

// GET /business-app/version — public, no auth. App polls on launch + periodically.
router.get('/version', (_req: Request, res: Response) => {
  const manifest = cached ?? loadManifest();
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
