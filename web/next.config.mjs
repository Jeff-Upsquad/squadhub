import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  rewrites: async () => ({
    beforeFiles: [
      { source: '/auth/:path*', destination: 'http://localhost:4000/auth/:path*' },
      { source: '/workspaces/:path*', destination: 'http://localhost:4000/workspaces/:path*' },
      { source: '/channels/:path*', destination: 'http://localhost:4000/channels/:path*' },
      { source: '/messages/:path*', destination: 'http://localhost:4000/messages/:path*' },
      { source: '/users/:path*', destination: 'http://localhost:4000/users/:path*' },
      { source: '/dms/:path*', destination: 'http://localhost:4000/dms/:path*' },
      { source: '/favorites/:path*', destination: 'http://localhost:4000/favorites/:path*' },
      { source: '/checkin/:path*', destination: 'http://localhost:4000/checkin/:path*' },
      { source: '/pm/:path*', destination: 'http://localhost:4000/pm/:path*' },
      { source: '/mini-apps/:path*', destination: 'http://localhost:4000/mini-apps/:path*' },
      { source: '/memberships/:path*', destination: 'http://localhost:4000/memberships/:path*' },
      { source: '/clients/:path*', destination: 'http://localhost:4000/clients/:path*' },
      { source: '/timer/:path*', destination: 'http://localhost:4000/timer/:path*' },
      { source: '/admin/:path*', destination: 'http://localhost:4000/admin/:path*' },
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
