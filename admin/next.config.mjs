import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  rewrites: async () => ({
    beforeFiles: [
      { source: '/api/auth/:path*', destination: 'http://server:4000/auth/:path*' },
      { source: '/api/admin/clients/:path*', destination: 'http://server:4000/admin/clients/:path*' },
      { source: '/api/admin/:path*', destination: 'http://server:4000/admin/:path*' },
      { source: '/api/users/:path*', destination: 'http://server:4000/users/:path*' },
      { source: '/api/workspaces/:path*', destination: 'http://server:4000/workspaces/:path*' },
      { source: '/api/health/:path*', destination: 'http://server:4000/health/:path*' },
      { source: '/api/clients/:path*', destination: 'http://server:4000/clients/:path*' },
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
