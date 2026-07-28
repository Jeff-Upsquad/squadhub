import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_URL = process.env.INTERNAL_API_URL || 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Module renamed Published Cards -> Subscription Cards. Old paths redirect so
  // existing bookmarks/deep links keep working (query strings are preserved).
  redirects: async () => [
    { source: '/admin/published-cards', destination: '/admin/subscription-cards', permanent: false },
    { source: '/m/published-cards', destination: '/m/subscription-cards', permanent: false },
  ],

  rewrites: async () => ({
    beforeFiles: [
      { source: '/api/auth/:path*', destination: `${API_URL}/auth/:path*` },
      { source: '/api/admin/clients/:path*', destination: `${API_URL}/admin/clients/:path*` },
      { source: '/api/admin/:path*', destination: `${API_URL}/admin/:path*` },
      // Collaborative LMS endpoints (shares/comments/review) — admins pass the
      // per-item access gate, so the admin editor reuses the same routes.
      { source: '/api/lms/:path*', destination: `${API_URL}/lms/:path*` },
      { source: '/api/users/:path*', destination: `${API_URL}/users/:path*` },
      { source: '/api/workspaces/:path*', destination: `${API_URL}/workspaces/:path*` },
      { source: '/api/health/:path*', destination: `${API_URL}/health/:path*` },
      { source: '/api/clients/:path*', destination: `${API_URL}/clients/:path*` },
      { source: '/api/pm/:path*', destination: `${API_URL}/pm/:path*` },
      { source: '/api/memberships/:path*', destination: `${API_URL}/memberships/:path*` },
      { source: '/api/upload/:path*', destination: `${API_URL}/upload/:path*` },
    ],
  }),

  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname, './src'),
    };
    return config;
  },
};

export default nextConfig;
