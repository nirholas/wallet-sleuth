import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The docs are compiled from the repository root, one level above this app.
    fs: { allow: ['../..'] },
    proxy: {
      '/v1': { target: process.env.SLEUTH_API ?? 'http://localhost:8787', changeOrigin: true },
      '/healthz': { target: process.env.SLEUTH_API ?? 'http://localhost:8787', changeOrigin: true },
      '/readyz': { target: process.env.SLEUTH_API ?? 'http://localhost:8787', changeOrigin: true },
      '/docs/api': { target: process.env.SLEUTH_API ?? 'http://localhost:8787', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          graph: ['cytoscape'],
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
