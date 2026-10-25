import { defineConfig } from 'vite';

const bridge = `http://127.0.0.1:${process.env.THANG_PORT ?? 8787}`;

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: bridge.replace('http', 'ws'), ws: true },
      '/tiles': bridge,
      '/health': bridge,
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
  // The engine worker loads the WebAssembly engine with a dynamic import
  worker: { format: 'es' },
  test: { environment: 'node' },
});
