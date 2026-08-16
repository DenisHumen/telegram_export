import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// TgVault frontend — dev server on 5177, proxies /api and /ws to the backend on 8077.
export default defineConfig({
  plugins: [react()],
  // Absolute, NOT './'. The app is a SPA served from the app root: on a deep
  // link such as /accounts/new a relative base would resolve the bundle to
  // /accounts/assets/index-*.js, the SPA fallback would answer with
  // index.html, and the page would die on a MIME-type error.
  base: '/',
  server: {
    port: 5177,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8077',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8077',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          data: ['@tanstack/react-query', 'zustand'],
        },
      },
    },
  },
});
