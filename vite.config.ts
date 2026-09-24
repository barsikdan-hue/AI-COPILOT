import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      // Main chunk is ~528 kB / ~148 kB gzip after lazy-loading all heavy drawers.
      chunkSizeWarningLimit: 550,
    },
    resolve: {
      alias: {
        '@': import.meta.dirname,
      },
    },
    server: {
      // HMR can be disabled in hosted/test environments via DISABLE_HMR.
      // File watching can be disabled to prevent flicker during automated edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
