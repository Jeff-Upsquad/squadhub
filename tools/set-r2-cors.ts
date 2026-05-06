/**
 * Apply a CORS policy to the R2 bucket so both squadhub.in and
 * admin.squadhub.in can PUT / GET directly against signed URLs.
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
const bucket = env.R2_BUCKET_NAME;

if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
  console.error('Missing R2_* vars in env file');
  process.exit(1);
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

async function main() {
  console.log(`Bucket: ${bucket}`);

  // Fetch current config for comparison
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

  // Mirrors the policy currently set on the bucket via the Cloudflare
  // dashboard — any divergence here will silently break uploads from one of
  // the apps next time someone runs the script. Update both places together.
  const nextRules = [
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
  ];

  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: { CORSRules: nextRules },
    }),
  );

  console.log('\n✓ Applied new CORS rules:');
  console.log(JSON.stringify(nextRules, null, 2));
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
