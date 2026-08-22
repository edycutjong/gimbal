#!/usr/bin/env node
/**
 * `npm run check:deploy` — the three checks that reach outside the repo.
 *
 * These are NOT in `npm test` for one reason each, and the reason is always the
 * partition rule: the file the check reads is not a committed file.
 *
 *   U-CFG — fetches the deployed URL. `npm test` must make ZERO network requests
 *           in a project whose headline claim is zero network requests.
 *   U-DOC — reads the deployed page's own text and the repo's docs together.
 *   U-DEP — cross-checks the "Built With" tag list, which lives in the project's
 *           private submission notes, never inside this repo.
 *
 * Usage: GIMBAL_URL=https://… npm run check:deploy
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const URL_UNDER_TEST = process.env.GIMBAL_URL;

if (!URL_UNDER_TEST) {
  process.stderr.write(
    '\nGIMBAL_URL is not set.\n\n' +
      'These three checks read the DEPLOYED site, so they need its address:\n\n' +
      '  GIMBAL_URL=https://your-deployment npm run check:deploy\n\n' +
      'They are deliberately outside `npm test`, which must stay offline.\n\n',
  );
  process.exit(1);
}

const problems = [];
const ok = (id, message) => process.stdout.write(`  ✓ ${id}  ${message}\n`);

// ── U-CFG ─────────────────────────────────────────────────────────────────
// A 3.7 MB .task binary and a .wasm served with the wrong MIME type is a silent
// twenty-minute bug: `Content-Type: application/wasm` is required for streaming
// instantiation, and an unknown extension served as text/html fails obscurely.
{
  const wasm = new URL('/model/vision_wasm_internal.wasm', URL_UNDER_TEST).href;
  const res = await fetch(wasm, { method: 'HEAD' }).catch((e) => ({ ok: false, error: e.message }));
  if (!res.ok) {
    problems.push(`U-CFG: could not fetch ${wasm}${res.error ? ` (${res.error})` : ` (${res.status})`}`);
  } else {
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('application/wasm')) {
      problems.push(`U-CFG: ${wasm} is served as "${type}", not application/wasm`);
    }
    const cache = res.headers.get('cache-control') ?? '';
    if (!cache.includes('immutable')) {
      problems.push(`U-CFG: /model/ is not served immutable (got "${cache}")`);
    }
  }

  const page = await fetch(URL_UNDER_TEST).catch((e) => ({ ok: false, error: e.message }));
  if (!page.ok) {
    problems.push(`U-CFG: could not fetch ${URL_UNDER_TEST}`);
  } else {
    const csp = page.headers.get('content-security-policy') ?? '';
    if (!csp.includes("connect-src 'self'")) {
      problems.push("U-CFG: the deployed CSP header lacks connect-src 'self'");
    }
    const permissions = page.headers.get('permissions-policy') ?? '';
    if (!permissions.includes('microphone=()')) {
      problems.push('U-CFG: the deployed Permissions-Policy does not deny the microphone');
    }
    if (problems.length === 0) ok('U-CFG', 'wasm MIME, immutable cache, CSP and Permissions-Policy all correct');
  }
}

// ── U-DOC ─────────────────────────────────────────────────────────────────
// Rule: nothing states a URL that is not the canonical one, and no placeholder
// token ever reaches the public tree.
{
  const forbidden = [/\bTODO\b/, /\bTBD\b/, /\bxxx\b/i, /\b0x\.\.\./, /<owner>/, /<[a-z-]+>/];
  const docs = ['README.md', 'DEMO.md', 'METHODS.md', 'LIMITATIONS.md', 'NOTICE.md', 'RELEASING.md'];
  for (const name of docs) {
    const path = join(ROOT, name);
    if (!existsSync(path)) {
      problems.push(`U-DOC: ${name} is missing`);
      continue;
    }
    const text = readFileSync(path, 'utf8');
    // Strip fenced code and inline code before hunting for angle-bracket tokens,
    // so a legitimate `<video>` in prose about the DOM is not a false positive.
    const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
    for (const pattern of forbidden) {
      if (pattern.test(prose)) problems.push(`U-DOC: ${name} contains a placeholder matching ${pattern}`);
    }
    for (const url of text.match(/https?:\/\/[^\s'"`)\]]+/g) ?? []) {
      const allowed =
        url.startsWith(URL_UNDER_TEST) ||
        url.includes('github.com/google-ai-edge/mediapipe') ||
        url.includes('storage.googleapis.com/mediapipe-models') ||
        url.includes('conventionalcommits.org');
      if (!allowed) problems.push(`U-DOC: ${name} states a URL that is not canonical: ${url}`);
    }
  }
  if (!problems.some((p) => p.startsWith('U-DOC'))) ok('U-DOC', 'no placeholders, and every URL is canonical');
}

// ── U-DEP ─────────────────────────────────────────────────────────────────
// Every "Built With" tag must be greppable in the repo before it is typed into
// a submission form. The tag list lives in the project's private notes, so this
// check takes it from an environment variable rather than reading the kitchen.
{
  const tags = (process.env.GIMBAL_BUILT_WITH ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tags.length === 0) {
    process.stdout.write(
      '  · U-DEP  skipped — set GIMBAL_BUILT_WITH="typescript,vite,mediapipe,…" to check the tag list\n',
    );
  } else {
    const haystack = [
      readFileSync(join(ROOT, 'package.json'), 'utf8'),
      readFileSync(join(ROOT, 'README.md'), 'utf8'),
      readFileSync(join(ROOT, 'METHODS.md'), 'utf8'),
    ]
      .join('\n')
      .toLowerCase();
    for (const tag of tags) {
      if (!haystack.includes(tag)) problems.push(`U-DEP: "${tag}" is not greppable in this repo`);
    }
    if (!problems.some((p) => p.startsWith('U-DEP'))) ok('U-DEP', `all ${tags.length} Built With tags are greppable`);
  }
}

if (problems.length > 0) {
  process.stderr.write(`\ncheck:deploy failed — ${problems.length} problem(s):\n\n`);
  for (const p of problems) process.stderr.write(`  ${p}\n`);
  process.stderr.write('\n');
  process.exit(1);
}
process.stdout.write('\nDeploy checks passed.\n\n');
