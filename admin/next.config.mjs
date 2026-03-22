import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  rewrites: async () => ({
    beforeFiles: [
      { source: '/auth/:path*', destination: 'http://server:4000/auth/:path*' },
      { source: '/admin/:path*', destination: 'http://server:4000/admin/:path*' },
      { source: '/users/:path*', destination: 'http://server:4000/users/:path*' },
      { source: '/workspaces/:path*', destination: 'http://server:4000/workspaces/:path*' },
      { source: '/health/:path*', destination: 'http://server:4000/health/:path*' },
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
