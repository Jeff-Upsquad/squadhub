/**
 * Apply CORS policies to the R2 buckets so the web apps can PUT / GET
 * directly against signed URLs:
 *   • squadhub-files  (R2_BUCKET_NAME)        — chat/task/LMS/cashbook uploads
 *   • squadhub-clips  (R2_CLIPS_BUCKET_NAME)  — Squad Clips recordings
 *
 * Run with:  npx tsx tools/set-r2-cors.ts
 */
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Prefer .env.production (VPS), fall back to .env (local dev).
const candidates = [
  join(__dirname, '..', 'server', '.env.production'),
  join(__dirname, '..', 'server', '.env'),
];
let envPath: string | null = null;
for (const p of candidates) {
  if (existsSync(p)) { envPath = p; break; }
}
if (!envPath) {
  console.error('No server/.env.production or server/.env found');
  process.exit(1);
}
console.log(`Reading env from: ${envPath}`);

const envText = readFileSync(envPath, 'utf8');
const env: Record<string, string> = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const accountId = env.R2_ACCOUNT_ID;
const accessKeyId = env.R2_ACCESS_KEY_ID;
const secretAccessKey = env.R2_SECRET_ACCESS_KEY;

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error('Missing R2_* vars in env file');
  process.exit(1);
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

type CorsRule = {
  AllowedOrigins: string[];
  AllowedMethods: string[];
  AllowedHeaders: string[];
  ExposeHeaders: string[];
  MaxAgeSeconds: number;
};

// Mirrors the policies set on the buckets via the Cloudflare dashboard — any
// divergence here will silently break uploads from one of the apps next time
// someone runs the script. Update both places together.
const bucketRules: Record<string, CorsRule[]> = {
  // Main platform bucket (chat, tasks, LMS, cashbook) — unchanged rules.
  [env.R2_BUCKET_NAME || 'squadhub-files']: [
    {
      AllowedOrigins: [
        'https://squadhub.in',
        'https://admin.squadhub.in',
        'https://cashbook.squadhub.in',
        'https://www.upsquadconnect.com',
        'https://upsquadconnect.com',
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:8081',
      ],
      AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
      AllowedHeaders: ['*'],
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 3600,
    },
  ],
  // Squad Clips bucket. GET is needed by the in-browser editor (ffmpeg.wasm
  // fetches the source video) and by <video crossorigin> for WebAudio; PUT by
  // presigned direct uploads. Deletes go through the clips server (no CORS).
  [env.R2_CLIPS_BUCKET_NAME || 'squadhub-clips']: [
    {
      AllowedOrigins: [
        'https://clips.squadhub.in',
        'https://squadhub.in',
        'http://localhost:3200',
        'http://localhost:3000',
      ],
      AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD'],
      AllowedHeaders: ['*'],
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 3600,
    },
  ],
};

async function applyBucket(bucket: string, nextRules: CorsRule[]) {
  console.log(`\n━━ Bucket: ${bucket}`);

  try {
    const current = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    console.log('Current CORS rules:', JSON.stringify(current.CORSRules, null, 2));
  } catch (err: any) {
    if (err?.name === 'NoSuchCORSConfiguration') {
      console.log('Current CORS rules: (none)');
    } else {
      console.log('Could not fetch current CORS:', err?.message);
    }
  }

  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: { CORSRules: nextRules },
    }),
  );

  console.log('✓ Applied new CORS rules:');
  console.log(JSON.stringify(nextRules, null, 2));
}

async function main() {
  let failures = 0;
  for (const [bucket, rules] of Object.entries(bucketRules)) {
    try {
      await applyBucket(bucket, rules);
    } catch (err: any) {
      failures++;
      console.error(`✗ ${bucket}: ${err?.message ?? err}`);
      if (err?.name === 'NoSuchBucket') {
        console.error(`  Create it first: Cloudflare dashboard → R2 → Create bucket → "${bucket}"`);
      }
    }
  }
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
