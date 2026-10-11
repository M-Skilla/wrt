import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The UI calls /api/*; in dev Vite forwards it to the backend on :3001.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.WRT_API ?? 'http://localhost:3001', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
});
