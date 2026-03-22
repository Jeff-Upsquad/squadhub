import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Use React strict mode in development
  reactStrictMode: true,

  // API proxy configuration for development
  rewrites: async () => ({
    beforeFiles: [
      {
        source: '/auth/:path*',
        destination: 'http://localhost:4000/auth/:path*',
      },
      {
        source: '/workspaces/:path*',
        destination: 'http://localhost:4000/workspaces/:path*',
      },
      {
        source: '/channels/:path*',
        destination: 'http://localhost:4000/channels/:path*',
      },
      {
        source: '/messages/:path*',
        destination: 'http://localhost:4000/messages/:path*',
      },
      {
        source: '/users/:path*',
        destination: 'http://localhost:4000/users/:path*',
      },
      {
        source: '/dms/:path*',
        destination: 'http://localhost:4000/dms/:path*',
      },
      {
        source: '/favorites/:path*',
        destination: 'http://localhost:4000/favorites/:path*',
      },
      {
        source: '/checkin/:path*',
        destination: 'http://localhost:4000/checkin/:path*',
      },
      {
        source: '/pm/:path*',
        destination: 'http://localhost:4000/pm/:path*',
      },
    ],
  }),

  // Webpack alias for @ imports
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': require('path').resolve(__dirname, './src'),
    };
    return config;
  },
};

export default nextConfig;
