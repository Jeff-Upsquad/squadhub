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

  // CORS / public web origin. Production: https://app.squadhub.in (set
  // CLIENT_URL); nothing here hardcodes a production host.
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  webAppUrl: process.env.WEB_APP_URL || process.env.CLIENT_URL || 'http://localhost:3000',

  // Self-serve signup. Product decision (Phase 1): accounts come from
  // SquadHire (SSO creates them); public signup stays OFF until launch. When
  // off, POST /auth/register only admits emails with a pending workspace
  // invitation. Set PUBLIC_SIGNUP_ENABLED=true to open it.
  publicSignupEnabled: process.env.PUBLIC_SIGNUP_ENABLED === 'true',

  // Squad Hub (internal) bridge — see docs/bridge-contract.md. Bridge is
  // disabled (routes 503 / outbound no-op) while SAAS_BRIDGE_SECRET is unset.
  hubApiUrl: process.env.HUB_API_URL || '',
  saasBridgeSecret: process.env.SAAS_BRIDGE_SECRET || '',

  // Partner App Versioning
  // The legacy RN/Expo app ended at 1.1.0. Keep the migration metadata on
  // the native 2.x line and point users at the canonical download page.
  partnerAppMinVersion: process.env.PARTNER_APP_MIN_VERSION || '2.0.0',
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
  // "Sign in with SquadHub" SSO into SquadHire's /staff portal. Comma-separated
  // exact-match allowlist of SquadHire callback URLs we may redirect codes to
  // (e.g. https://<squadhire-host>/api/staff-auth/sso/callback). Empty = SSO off.
  squadhireSsoRedirectUris: (process.env.SQUADHIRE_SSO_REDIRECT_URIS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Candidates mini app — instant env kill switch for the SquadHire proxy.
  // Set CANDIDATES_PROXY_ENABLED=false to make /candidates/* return 503 without
  // a deploy (complements the mini_apps.is_enabled=false kill switch).
  candidatesProxyEnabled: (process.env.CANDIDATES_PROXY_ENABLED || 'true') !== 'false',

  // Squad CRM system events — delivers the self-serve password-reset temp
  // password over WhatsApp (the CRM owns the approved template and the sender
  // number). When unset, the reset still works but reports "not delivered", so
  // dev boxes need no CRM wiring; set PASSWORD_RESET_DEBUG=1 locally to print
  // the temp password to the server log instead (never in production).
  squadCrmSystemEventsUrl: process.env.SQUAD_CRM_SYSTEM_EVENTS_URL || '',
  squadCrmInboundSecret: process.env.SQUAD_CRM_INBOUND_SECRET || '',

  // upsquad website — admin API for subscription requests.
  // When unset, the proxy endpoints return 503 and local dev works without it.
  upsquadApiUrl: process.env.UPSQUAD_API_URL || '',
  upsquadApiToken: process.env.UPSQUAD_API_TOKEN || '',

  // Anthropic — used by the cash book receipt analyzer. When unset the
  // /cashbook/analyze-receipts endpoint returns 503 instead of crashing.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',

  // Web Push (browser notifications for the installable PWA). When the VAPID
  // keypair is unset, sendWebPush no-ops (like FCM) so dev boxes boot without it.
  // Generate a keypair with: npx web-push generate-vapid-keys
  webPushVapidPublicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '',
  webPushVapidPrivateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '',
  webPushVapidSubject: process.env.WEB_PUSH_VAPID_SUBJECT || 'mailto:support@example.com',

  // Meeting-link providers for the Meetings mini app. Jitsi needs no secret
  // (deterministic room URL) and is always available. Google Meet and Zoom are
  // optional adapters — each appears in the "Select Meeting App" dropdown only
  // when its secrets are present; otherwise it is silently hidden.
  jitsiBaseUrl: process.env.JITSI_BASE_URL || 'https://meet.jit.si',
  googleMeetClientId: process.env.GOOGLE_MEET_CLIENT_ID || '',
  googleMeetClientSecret: process.env.GOOGLE_MEET_CLIENT_SECRET || '',
  googleMeetRefreshToken: process.env.GOOGLE_MEET_REFRESH_TOKEN || '',
  googleMeetCalendarId: process.env.GOOGLE_MEET_CALENDAR_ID || 'primary',
  zoomAccountId: process.env.ZOOM_ACCOUNT_ID || '',
  zoomClientId: process.env.ZOOM_CLIENT_ID || '',
  zoomClientSecret: process.env.ZOOM_CLIENT_SECRET || '',

  // Build Agent bridge API (/agent/*). A static bearer token for the external
  // build executor (ZCode automation today, VPS runner later) plus the UUID of
  // a dedicated "Build Agent" user row used to attribute comments/activity.
  // When agentApiToken is unset every /agent endpoint returns 503, so dev
  // boxes without wiring are closed by default. Generate a token with:
  //   openssl rand -hex 32
  agentApiToken: process.env.AGENT_API_TOKEN || '',
  agentUserId: process.env.AGENT_USER_ID || '',

  // Huddles (in-app calls) run on LiveKit. All three must be present for the
  // feature to switch on; otherwise /huddles/config reports disabled and the
  // start button stays hidden. LIVEKIT_URL is the client-facing wss:// URL
  // (LiveKit Cloud project URL, or ws://localhost:7880 with `livekit-server --dev`).
  livekitUrl: process.env.LIVEKIT_URL || '',
  livekitApiKey: process.env.LIVEKIT_API_KEY || '',
  livekitApiSecret: process.env.LIVEKIT_API_SECRET || '',
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
