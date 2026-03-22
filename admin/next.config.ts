import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  rewrites: async () => ({
    beforeFiles: [
      {
        source: '/auth/:path*',
        destination: 'http://localhost:4000/auth/:path*',
      },
      {
        source: '/admin/:path*',
        destination: 'http://localhost:4000/admin/:path*',
      },
      {
        source: '/users/:path*',
        destination: 'http://localhost:4000/users/:path*',
      },
      {
        source: '/workspaces/:path*',
        destination: 'http://localhost:4000/workspaces/:path*',
      },
      {
        source: '/health/:path*',
        destination: 'http://localhost:4000/health/:path*',
      },
    ],
  }),

  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': require('path').resolve(__dirname, './src'),
    };
    return config;
  },
};

export default nextConfig;
