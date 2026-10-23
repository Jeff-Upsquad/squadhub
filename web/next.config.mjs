import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const API_URL = process.env.INTERNAL_API_URL || 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(__dirname, '..'),
  // Allow an independent UI preview server without sharing the main dev cache.
  distDir: process.env.SQUADHUB_NEXT_DIST_DIR || '.next',

  devIndicators: process.env.SQUADHUB_NEXT_DIST_DIR === '.next-ui-preview' ? false : {
    position: 'bottom-right',
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
      { source: '/messages/:path*', destination: `${API_URL}/messages/:path*` },
      { source: '/users/:path*', destination: `${API_URL}/users/:path*` },
      { source: '/dms/:path*', destination: `${API_URL}/dms/:path*` },
      { source: '/support/:path*', destination: `${API_URL}/support/:path*` },
      { source: '/partner/:path*', destination: `${API_URL}/partner/:path*` },
      { source: '/subscription-cards/:path*', destination: `${API_URL}/subscription-cards/:path*` },
      { source: '/job-cards/:path*', destination: `${API_URL}/job-cards/:path*` },
      { source: '/upload/:path*', destination: `${API_URL}/upload/:path*` },
      { source: '/favorites/:path*', destination: `${API_URL}/favorites/:path*` },
      { source: '/app-favorites/:path*', destination: `${API_URL}/app-favorites/:path*` },
      { source: '/notes/:path*', destination: `${API_URL}/notes/:path*` },
      { source: '/checkin/:path*', destination: `${API_URL}/checkin/:path*` },
      { source: '/pm/:path*', destination: `${API_URL}/pm/:path*` },
      { source: '/mini-apps/:path*', destination: `${API_URL}/mini-apps/:path*` },
      { source: '/memberships/:path*', destination: `${API_URL}/memberships/:path*` },
      { source: '/timer/:path*', destination: `${API_URL}/timer/:path*` },
      { source: '/partner-payments/:path*', destination: `${API_URL}/partner-payments/:path*` },
      { source: '/notifications/:path*', destination: `${API_URL}/notifications/:path*` },
      { source: '/push/:path*', destination: `${API_URL}/push/:path*` },
      { source: '/meetings/:path*', destination: `${API_URL}/meetings/:path*` },
      { source: '/meeting-events/:path*', destination: `${API_URL}/meeting-events/:path*` },
      { source: '/huddles/:path*', destination: `${API_URL}/huddles/:path*` },
      { source: '/view-preferences/:path*', destination: `${API_URL}/view-preferences/:path*` },
      { source: '/feature-tips/:path*', destination: `${API_URL}/feature-tips/:path*` },
    ],
  }),

  webpack: (config, { dev }) => {
    // Dev-only: the webpack filesystem cache under web/.next keeps corrupting
    // (ENOENT on *.pack.gz → missing CSS chunks → unstyled pages and
    // `__webpack_modules__ is not a function` overlays). In-memory caching is
    // marginally slower on boot but doesn't rot. Production builds keep the
    // default filesystem cache.
    if (dev) config.cache = false;
    config.resolve.alias = {
      ...config.resolve.alias,
      '@tanstack/react-query': path.dirname(require.resolve('@tanstack/react-query/package.json')),
      '@': path.resolve(__dirname, './src'),
    };
    return config;
  },
};

export default nextConfig;
