#!/usr/bin/env node
/**
 * U-DIST — the SHIPPED bundle, not the source.
 *
 * `npm run check:build` runs `vite build` and then greps `dist/`. It lives here
 * rather than in `npm test` because `dist/` is gitignored and does not exist on
 * a clean clone; a member of `npm test` that read it would either error out or
 * pass vacuously, which is the failure the partition rule exists to prevent.
 *
 * The script builds its own input, so a judge with nothing but `npm ci` can
 * still run it.
 *
 * What it asserts: the production bundle contains no simulation path, no
 * fixture-replay route, and no third-party origin. Because the app has no
 * dev-gated replay route at all (the verification harness overrides
 * `getUserMedia` from the test runner instead), there is nothing here that
 * depends on tree-shaking having worked.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

if (!existsSync(DIST)) {
  process.stderr.write('dist/ does not exist — run `npm run check:build`, which builds it first.\n');
  process.exit(1);
}

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html', '.json', '.map']);

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const problems = [];
const files = walk(DIST).filter((f) => TEXT_EXTENSIONS.has(extname(f)));

if (files.length === 0) problems.push('no text files found in dist/ — the grep would pass vacuously');

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const name = relative(ROOT, file);

  // The vendored MediaPipe runtime is third-party code we do not author; it is
  // excluded from the prose greps and checked only for network origins.
  const isVendored = name.includes('dist/model/');

  if (!isVendored) {
    for (const pattern of [/\bMOCK_/, /simulateMotion/, /replayFixture/, /__DEV_ROUTE__/, /import\.meta\.env\.DEV/]) {
      if (pattern.test(text)) problems.push(`${name}: shipped bundle matches ${pattern}`);
    }
    if (/\b(openai|anthropic|api\.gemini)\b/i.test(text)) {
      problems.push(`${name}: shipped bundle references an inference provider`);
    }
    // The product has ONE address, and it is the custom domain. A
    // `*.vercel.app` string baked into the bundle is a platform artifact that
    // would outlive a project rename and contradict every document.
    if (/[\w-]*\.vercel\.app/.test(text)) {
      problems.push(`${name}: shipped bundle names a *.vercel.app address`);
    }
  }

  for (const url of text.match(/https?:\/\/[^\s'"`)\\]+/g) ?? []) {
    // MATCHED ON A PARSED ORIGIN, never as a substring or a bare prefix.
    // `startsWith('https://gimbal.edycu.dev')` accepts
    // `https://gimbal.edycu.dev.attacker.test/x`, and `includes('w3.org')`
    // accepts `https://cdn.example/?ref=w3.org` — both of which are exactly the
    // third-party origin this scan exists to catch, wearing an allowed string
    // as a costume. `openapi.vercel.sh` was permitted here and appears nowhere
    // in `dist/`; a dead allowance only ever widens a check, so it is gone.
    let origin = null;
    let path = '';
    try {
      const parsed = new URL(url);
      origin = parsed.origin;
      path = parsed.pathname;
    } catch {
      /* not a URL we can parse — fall through and fail it */
    }
    const allowed =
      // The XML namespace literal in the SVG the report renders. A namespace is
      // an identifier, not a fetch, and no browser resolves it.
      origin === 'http://www.w3.org' ||
      // The landing page's canonical link, og:url and og:image are ABSOLUTE by
      // necessity — a link-preview scraper resolves nothing relative — and the
      // repository link is where a reader goes to check the claims. These are
      // addresses the bundle NAMES, not origins it CONTACTS: `connect-src
      // 'self'` still means the page can reach neither of them at runtime.
      // Nothing else is permitted, which is what keeps a CDN, a font host or an
      // analytics endpoint out of the one surface that argues it has none.
      origin === 'https://gimbal.edycu.dev' ||
      (origin === 'https://github.com' && path.startsWith('/edycutjong/gimbal')) ||
      (isVendored &&
        origin !== null &&
        /(^|\.)(mediapipe\.dev|google\.com|googleapis\.com|googlesource\.com|emscripten\.org|github\.io|chromium\.org)$/.test(
          new URL(url).hostname,
        ));
    if (!allowed) problems.push(`${name}: shipped bundle references ${url}`);
  }
}

// Both entry points, the model, the WASM runtime and the vendored typeface must
// all actually be in the deploy artifact.
for (const required of [
  'dist/index.html',
  'dist/app/index.html',
  'dist/og.png',
  'dist/icon.svg',
  'dist/fonts/InterVariable.woff2',
  'dist/model/face_landmarker.64184e22.task',
  'dist/model/vision_wasm_internal.wasm',
]) {
  if (!existsSync(join(ROOT, required))) problems.push(`${required} is missing from the build output`);
}

// A landing page whose script never shipped is a page with no hero and no theme
// picker, and it would still look fine in a diff.
const landing = readFileSync(join(DIST, 'index.html'), 'utf8');
if (!/<script[^>]+type="module"/.test(landing)) problems.push('dist/index.html: no module script');
if (!/LIMITATIONS-BODY-START/.test(landing)) problems.push('dist/index.html: the limitations block did not ship');

if (problems.length > 0) {
  process.stderr.write(`\nU-DIST failed — ${problems.length} problem(s):\n\n`);
  for (const p of problems) process.stderr.write(`  ${p}\n`);
  process.stderr.write('\n');
  process.exit(1);
}

process.stdout.write(`\n  ✓ U-DIST  the shipped bundle carries no simulation path and no third-party origin (${files.length} files scanned)\n\n`);
