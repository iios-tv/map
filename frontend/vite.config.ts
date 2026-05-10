import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BACKEND =
  process.env.IIOSMAP_BACKEND ?? process.env.LAMULANA_BACKEND ?? 'http://127.0.0.1:8765';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/images': { target: BACKEND, changeOrigin: true },
      '/composites': { target: BACKEND, changeOrigin: true },
      '/ws': { target: BACKEND.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
