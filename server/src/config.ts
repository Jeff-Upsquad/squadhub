import dotenv from 'dotenv';
import path from 'path';

// Load .env from server directory (for local dev; Docker uses env_file directly)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Supabase
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // JWT
  jwtSecret: process.env.JWT_SECRET || '',

  // Cloudflare R2
  r2AccountId: process.env.R2_ACCOUNT_ID || '',
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  r2BucketName: process.env.R2_BUCKET_NAME || 'squadhub-files',
  r2PublicUrl: process.env.R2_PUBLIC_URL || '',

  // CORS
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  adminUrl: process.env.ADMIN_URL || 'http://localhost:5174',
  cashbookUrl: process.env.CASHBOOK_URL || 'https://cashbook.squadhub.in',
  desktopUrl: process.env.DESKTOP_URL || 'tauri://localhost',

  // SquadBooks integration (sibling app at books.squadhub.in, its own Supabase project).
  squadbooksUrl: process.env.SQUADBOOKS_URL || 'https://books.squadhub.in',
  squadbooksAdminApiKey: process.env.SQUADBOOKS_ADMIN_API_KEY || '',

  // Cash Book App Versioning
  cashbookMinVersion: process.env.CASHBOOK_MIN_VERSION || '1.0.0',
  cashbookDownloadUrl: process.env.CASHBOOK_DOWNLOAD_URL || '',

  // Partner App Versioning
  partnerAppMinVersion: process.env.PARTNER_APP_MIN_VERSION || '1.0.0',
  partnerAppDownloadUrl: process.env.PARTNER_APP_DOWNLOAD_URL || '',

  // SquadHire (Profiles) integration — all optional; when unset the outbound
  // webhook logs a no-op and the inbound callback endpoint returns 503, so
  // dev boxes work without any SquadHire wiring.
  //   squadhireWebhookUrl:     full URL to POST cards to (e.g. http://localhost:5010/api/webhooks/squadhub/cards)
  //   squadhireWebhookSecret:  shared secret we send in X-SquadHub-Signature when publishing
  //   squadhireCallbackSecret: shared secret we expect in X-SquadHub-Signature when receiving accept/reject callbacks
  squadhireWebhookUrl: process.env.SQUADHIRE_WEBHOOK_URL || '',
  squadhireWebhookSecret: process.env.SQUADHIRE_WEBHOOK_SECRET || '',
  squadhireCallbackSecret: process.env.SQUADHIRE_CALLBACK_SECRET || '',
  squadhireAdminUrl: process.env.SQUADHIRE_ADMIN_URL || '',

  // upsquad website — admin API for subscription requests.
  // When unset, the proxy endpoints return 503 and local dev works without it.
  upsquadApiUrl: process.env.UPSQUAD_API_URL || '',
  upsquadApiToken: process.env.UPSQUAD_API_TOKEN || '',

  // Anthropic — used by the cash book receipt analyzer. When unset the
  // /cashbook/analyze-receipts endpoint returns 503 instead of crashing.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
} as const;

// Validate required env vars at startup
const required = ['supabaseUrl', 'supabaseAnonKey', 'supabaseServiceRoleKey', 'jwtSecret'] as const;

export function validateConfig() {
  const missing = required.filter((key) => !config[key]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Copy server/.env.example to server/.env and fill in the values.');
    process.exit(1);
  }
}
