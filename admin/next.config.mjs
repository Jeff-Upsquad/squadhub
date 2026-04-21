import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_URL = process.env.INTERNAL_API_URL || 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  rewrites: async () => ({
    beforeFiles: [
      { source: '/api/auth/:path*', destination: `${API_URL}/auth/:path*` },
      { source: '/api/admin/clients/:path*', destination: `${API_URL}/admin/clients/:path*` },
      { source: '/api/admin/:path*', destination: `${API_URL}/admin/:path*` },
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
