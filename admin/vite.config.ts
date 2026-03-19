import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/auth': 'http://localhost:4000',
      '/workspaces': 'http://localhost:4000',
      '/admin': 'http://localhost:4000',
      '/users': 'http://localhost:4000',
      '/health': 'http://localhost:4000',
    },
  },
});
