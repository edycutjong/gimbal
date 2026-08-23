import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

/**
 * `/app` without a trailing slash, in dev and preview.
 *
 * The static host resolves it — `vercel.json` rewrites `/app` to
 * `/app/index.html` — but Vite's own SPA fallback answers an extensionless path
 * with the ROOT `index.html`, which would silently serve the landing page at the
 * app's address. Every link, every e2e spec and every screenshot would then be
 * testing the wrong page while returning 200.
 *
 * Three lines of dev-server middleware, no runtime code, nothing in the bundle.
 */
function appRoute(): Plugin {
  const rewrite = (req: { url?: string }): void => {
    if (req.url === '/app' || req.url?.startsWith('/app?')) {
      req.url = `/app/index.html${req.url.slice(4)}`;
    }
  };
  return {
    name: 'gimbal-app-route',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        rewrite(req);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        rewrite(req);
        next();
      });
    },
  };
}

// No framework plugin, no adapter, no server runtime — `vite build` emits a plain
// static directory and that directory is the deploy artifact (architecture.md §2.1).
//
// TWO HTML ENTRY POINTS, and no router in either.
//   `/`     index.html      — the landing page. Explains the instrument.
//   `/app`  app/index.html  — the instrument. Six screens, one enum, no deep links.
// Rollup needs both named here or it only ever walks the root one. They share
// every stylesheet and several UI modules, so the shared chunk is emitted once.
export default defineConfig({
  plugins: [appRoute()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
      },
    },
  },
  server: {
    // getUserMedia needs a secure context; localhost counts as one.
    host: '127.0.0.1',
    port: 5173,
  },
});
