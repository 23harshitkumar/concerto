import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Polyfill Node globals for concerto-cto / concerto-core in the browser
    global: 'globalThis',
    'process.env': '{}',
    'process.browser': 'true',
  },
  resolve: {
    alias: {
      // Stub out Node built-ins that concerto uses but aren't needed in the browser
      path: 'path-browserify',
      stream: 'stream-browserify',
      events: 'eventemitter3',
    },
  },
  optimizeDeps: {
    include: ['@accordproject/concerto-cto', '@accordproject/concerto-core'],
  },
});
