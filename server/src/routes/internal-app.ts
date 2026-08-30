import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

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
  const fromEnv = process.env.INTERNAL_RELEASE_MANIFEST_PATH;
  cachedPath = fromEnv ? path.resolve(fromEnv) : path.resolve(__dirname, '../../internal-release-manifest.json');
  return cachedPath;
}

function loadManifest(): VersionManifest {
  const manifestFile = manifestPath();
  try {
    cached = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as VersionManifest;
    return cached;
  } catch (err) {
    console.warn('[internal-app/version] manifest not loaded:', (err as Error).message, 'at', manifestFile, '— using fallback');
    cached = null;
    return FALLBACK_MANIFEST;
  }
}

loadManifest();
try {
  fs.watchFile(manifestPath(), { interval: 5000 }, () => {
    console.log('[internal-app/version] manifest changed, reloading');
    loadManifest();
  });
} catch {
  // Missing manifests use the fallback until the first Internal release.
}

router.get('/version', (_req: Request, res: Response) => {
  const manifest = cached ?? loadManifest();
  let published_at = manifest.published_at;
  if (!published_at) {
    try {
      published_at = fs.statSync(manifestPath()).mtime.toISOString();
    } catch {
      // Omit the timestamp when the fallback is active.
    }
  }
  res.json({ success: true, data: { ...manifest, published_at } });
});

export default router;
