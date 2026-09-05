import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_URL = process.env.INTERNAL_API_URL || 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  devIndicators: {
    position: 'bottom-right',
  },

  // Allow CRM (and local CRM) to iframe the SquadHub embeds: the chat panel and
  // the Requirement Cards module.
  async headers() {
    const frameAncestors =
      "frame-ancestors 'self' https://crm.squadhub.in http://localhost:3100 http://127.0.0.1:3100";
    const embedHeaders = [
      { key: 'Content-Security-Policy', value: frameAncestors },
      // Clear any global DENY so iframe works (Caddy may also set this — keep in sync).
      { key: 'X-Frame-Options', value: '' },
    ];
    return [
      { source: '/embed/crm-chat', headers: embedHeaders },
      { source: '/embed/cards', headers: embedHeaders },
    ];
  },

  rewrites: async () => ({
    beforeFiles: [
      // Dev-only in practice: prod nginx proxies /socket.io before Next sees it
      // (web/nginx.conf). Without this, the socket client silently dies in dev
      // (no realtime messages, no presence) because io('/') has no route.
      { source: '/socket.io/:path*', destination: `${API_URL}/socket.io/:path*` },
      { source: '/auth/:path*', destination: `${API_URL}/auth/:path*` },
      // "Sign in with SquadHub" SSO: the /launch/squadhire bridge posts here.
      { source: '/sso/:path*', destination: `${API_URL}/sso/:path*` },
      { source: '/workspaces/:path*', destination: `${API_URL}/workspaces/:path*` },
      { source: '/channels/:path*', destination: `${API_URL}/channels/:path*` },
      { source: '/support/:path*', destination: `${API_URL}/support/:path*` },
      { source: '/messages/:path*', destination: `${API_URL}/messages/:path*` },
      { source: '/users/:path*', destination: `${API_URL}/users/:path*` },
      { source: '/dms/:path*', destination: `${API_URL}/dms/:path*` },
      // LMS / Jobs image uploads (presign-lms, presign-jobs) — without this,
      // Next serves a 404 HTML page and the editor alerts axios's default
      // "Request failed with status code 404".
      { source: '/upload/:path*', destination: `${API_URL}/upload/:path*` },
      { source: '/favorites/:path*', destination: `${API_URL}/favorites/:path*` },
      { source: '/app-favorites/:path*', destination: `${API_URL}/app-favorites/:path*` },
      { source: '/notes/:path*', destination: `${API_URL}/notes/:path*` },
      { source: '/checkin/:path*', destination: `${API_URL}/checkin/:path*` },
      { source: '/timesheet/:path*', destination: `${API_URL}/timesheet/:path*` },
      { source: '/off-days/:path*', destination: `${API_URL}/off-days/:path*` },
      { source: '/pm/:path*', destination: `${API_URL}/pm/:path*` },
      { source: '/mini-apps/:path*', destination: `${API_URL}/mini-apps/:path*` },
      { source: '/onboarding-links/:path*', destination: `${API_URL}/onboarding-links/:path*` },
      { source: '/subscription-cards/:path*', destination: `${API_URL}/subscription-cards/:path*` },
      { source: '/memberships/:path*', destination: `${API_URL}/memberships/:path*` },
      { source: '/clients/:path*', destination: `${API_URL}/clients/:path*` },
      { source: '/leads/:path*', destination: `${API_URL}/leads/:path*` },
      { source: '/design-share/:path*', destination: `${API_URL}/design-share/:path*` },
      { source: '/client-spaces/:path*', destination: `${API_URL}/client-spaces/:path*` },
      { source: '/timer/:path*', destination: `${API_URL}/timer/:path*` },
      { source: '/admin/:path*', destination: `${API_URL}/admin/:path*` },
      { source: '/partner/:path*', destination: `${API_URL}/partner/:path*` },
      // Partner Payments mini app
      { source: '/partner-payments/:path*', destination: `${API_URL}/partner-payments/:path*` },
      { source: '/cashbook/:path*', destination: `${API_URL}/cashbook/:path*` },
      { source: '/partner-app/:path+', destination: `${API_URL}/partner-app/:path+` },
      { source: '/internal-app/:path+', destination: `${API_URL}/internal-app/:path+` },
      { source: '/business-app/:path+', destination: `${API_URL}/business-app/:path+` },
      { source: '/notifications/:path*', destination: `${API_URL}/notifications/:path*` },
      { source: '/push/:path*', destination: `${API_URL}/push/:path*` },
      { source: '/lms/:path*', destination: `${API_URL}/lms/:path*` },
      { source: '/meetings/:path*', destination: `${API_URL}/meetings/:path*` },
      { source: '/meeting-events/:path*', destination: `${API_URL}/meeting-events/:path*` },
      { source: '/profile-access/:path*', destination: `${API_URL}/profile-access/:path*` },
      { source: '/view-preferences/:path*', destination: `${API_URL}/view-preferences/:path*` },
      { source: '/feature-tips/:path*', destination: `${API_URL}/feature-tips/:path*` },
      { source: '/candidates/:path*', destination: `${API_URL}/candidates/:path*` },
    ],
  }),

  // The Leads mini app renders the admin panel's Job Cards / Subscription
  // Cards / Assignments modules from source rather than keeping a second copy
  // in this app, and those files live outside web/. Next needs this to compile
  // TSX from an external directory.
  experimental: {
    externalDir: true,
  },

  webpack: (config, { dev }) => {
    // Dev-only: the webpack filesystem cache under web/.next keeps corrupting
    // (ENOENT on *.pack.gz → missing CSS chunks → unstyled pages and
    // `__webpack_modules__ is not a function` overlays). In-memory caching is
    // marginally slower on boot but doesn't rot. Production builds keep the
    // default filesystem cache.
    if (dev) config.cache = false;
    config.resolve.alias = {
      ...config.resolve.alias,
      // Two source roots for `@`, tried in order. web/src always wins, so no
      // import that resolves today can change meaning; admin/src only catches
      // specifiers that would otherwise fail to resolve — which is exactly the
      // shared module tree (`@/views/admin/*`) and the few infra leaves it
      // depends on (ConfirmDialog, CardCodeChip, useSquadhireConfig, squadCrm).
      //
      // Because those admin files import `@/services/api`, `@/components/Toast`
      // and `@/stores/authStore`, and web/src has all three, each app injects
      // its OWN api client, toast and auth store into the shared modules.
      '@': [path.resolve(__dirname, './src'), path.resolve(__dirname, '../admin/src')],
    };
    return config;
  },
};

export default nextConfig;
