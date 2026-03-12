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
