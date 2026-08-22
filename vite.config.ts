import { defineConfig } from 'vite';

// No framework plugin, no adapter, no server runtime — `vite build` emits a plain
// static directory and that directory is the deploy artifact (architecture.md §2.1).
export default defineConfig({
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  server: {
    // getUserMedia needs a secure context; localhost counts as one.
    host: '127.0.0.1',
    port: 5173,
  },
});
