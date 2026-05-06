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

  rewrites: async () => ({
    beforeFiles: [
      { source: '/auth/:path*', destination: `${API_URL}/auth/:path*` },
      { source: '/workspaces/:path*', destination: `${API_URL}/workspaces/:path*` },
      { source: '/channels/:path*', destination: `${API_URL}/channels/:path*` },
      { source: '/messages/:path*', destination: `${API_URL}/messages/:path*` },
      { source: '/users/:path*', destination: `${API_URL}/users/:path*` },
      { source: '/dms/:path*', destination: `${API_URL}/dms/:path*` },
      { source: '/favorites/:path*', destination: `${API_URL}/favorites/:path*` },
      { source: '/checkin/:path*', destination: `${API_URL}/checkin/:path*` },
      { source: '/off-days/:path*', destination: `${API_URL}/off-days/:path*` },
      { source: '/pm/:path*', destination: `${API_URL}/pm/:path*` },
      { source: '/mini-apps/:path*', destination: `${API_URL}/mini-apps/:path*` },
      { source: '/onboarding-links/:path*', destination: `${API_URL}/onboarding-links/:path*` },
      { source: '/subscription-cards/:path*', destination: `${API_URL}/subscription-cards/:path*` },
      { source: '/memberships/:path*', destination: `${API_URL}/memberships/:path*` },
      { source: '/clients/:path*', destination: `${API_URL}/clients/:path*` },
      { source: '/client-spaces/:path*', destination: `${API_URL}/client-spaces/:path*` },
      { source: '/timer/:path*', destination: `${API_URL}/timer/:path*` },
      { source: '/admin/:path*', destination: `${API_URL}/admin/:path*` },
      { source: '/partner/:path*', destination: `${API_URL}/partner/:path*` },
      { source: '/cashbook/:path*', destination: `${API_URL}/cashbook/:path*` },
      { source: '/partner-app/:path+', destination: `${API_URL}/partner-app/:path+` },
      { source: '/notifications/:path*', destination: `${API_URL}/notifications/:path*` },
      { source: '/lms/:path*', destination: `${API_URL}/lms/:path*` },
      { source: '/profile-access/:path*', destination: `${API_URL}/profile-access/:path*` },
      { source: '/view-preferences/:path*', destination: `${API_URL}/view-preferences/:path*` },
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
