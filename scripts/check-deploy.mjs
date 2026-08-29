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

/** The deployment being inspected — production, or a per-PR preview. */
const URL_UNDER_TEST = process.env.GIMBAL_URL;

/**
 * The ONE canonical URL (rule: one canonical fact, zero cross-doc
 * contradictions). Deliberately NOT `URL_UNDER_TEST`: a preview deployment has
 * its own throwaway address, and the docs must keep naming the canonical one.
 * U-CFG asks "is this deployment configured correctly"; U-DOC asks "do the docs
 * state only the canonical URL". Conflating the two makes every preview run
 * fail on a README that is correct.
 */
const CANONICAL_URL = process.env.GIMBAL_CANONICAL_URL ?? 'https://gimbal.edycu.dev';

/**
 * URL allowlisting, done on the PARSED url rather than on the string.
 *
 * A substring test is not a URL test: `startsWith(CANONICAL_URL)` says yes to
 * `https://gimbal.edycu.dev.attacker.test/x`, and `includes('github.com/…')`
 * says yes to `https://evil.test/?u=github.com/…`. Both are exactly the
 * non-canonical address U-DOC exists to find.
 */
const parse = (raw) => {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
};

// Exact host, or its `www.` form — and nothing else. `www.example.org` and
// `example.org` are the same site; `example.org.attacker.test` is not, and a
// substring test cannot tell the difference.
const hostMatches = (raw, host) => {
  const h = parse(raw)?.hostname;
  return h === host || h === `www.${host}`;
};

const atHostPath = (raw, host, prefix) => {
  const u = parse(raw);
  return u?.hostname === host && (u.pathname === prefix || u.pathname.startsWith(`${prefix}/`));
};

const onCanonicalOrigin = (raw) => {
  const canonical = parse(CANONICAL_URL);
  return canonical !== null && parse(raw)?.origin === canonical.origin;
};

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
    // The SERVED html, not just the source — a stale deployment could still be
    // handing out a platform address the repo no longer contains.
    const served = await page.text();
    const servedPlatformUrl = served.match(/[\w-]*\.vercel\.app/);
    if (servedPlatformUrl) {
      problems.push(`U-CFG: the served page names ${servedPlatformUrl[0]} — the canonical URL is ${CANONICAL_URL}`);
    }
    if (problems.length === 0) {
      ok('U-CFG', 'wasm MIME, immutable cache, CSP, Permissions-Policy, and no platform URL in the served page');
    }
  }
}

// ── U-DOC ─────────────────────────────────────────────────────────────────
// Rule: nothing states a URL that is not the canonical one, and no placeholder
// token ever reaches the public tree.
{
  const forbidden = [/\bTODO\b/, /\bTBD\b/, /\bxxx\b/i, /\b0x\.\.\./, /<owner>/];

  // `<[a-z-]+>` used to be in the list above, to catch template tokens like
  // `<owner>` or `<your-url>`. It also matched every ATTRIBUTE-LESS HTML TAG,
  // which is a false positive: `<picture>` and `<source>` are the mechanism
  // GitHub documents for a theme-aware diagram, and the README uses them as
  // markup, not as a blank to fill in. Stripping code fences (below) does not
  // help — this markup is not in a fence, it is rendered.
  //
  // So the token hunt now knows the difference. Bare tags that are real HTML
  // elements USED AS MARKUP IN THESE DOCS are allowed; every other `<word>` is
  // still reported. The list is deliberately short — it is not "every HTML
  // element", because a name that is both a tag and a plausible blank (`<data>`,
  // `<output>`, `<address>`) should keep failing.
  const MARKUP_TAGS = new Set([
    'div', 'picture', 'source', 'img', 'br', 'hr', 'em', 'strong', 'p', 'a',
    'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'details', 'sub', 'sup', 'blockquote', 'span', 'kbd', 'code', 'pre',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  ]);
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
    // Angle-bracket tokens that are not markup.
    for (const m of prose.matchAll(/<([a-z][a-z0-9-]*)>/g)) {
      if (!MARKUP_TAGS.has(m[1])) {
        problems.push(`U-DOC: ${name} contains an unfilled placeholder token <${m[1]}>`);
      }
    }
    // One canonical URL, and it is the custom domain. A `*.vercel.app` address
    // is a platform artifact: it changes if the project is renamed, it is not
    // what a judge is handed, and a second live address is how two documents
    // begin to disagree.
    const platformUrl = text.match(/[\w-]*\.vercel\.app/);
    if (platformUrl) {
      problems.push(`U-DOC: ${name} names ${platformUrl[0]} — the canonical URL is ${CANONICAL_URL}`);
    }
    // The allowlist is NOT "URLs we like". It is the exact set of UPSTREAM
    // ATTRIBUTION addresses `NOTICE.md` is obliged to carry, plus the one
    // specification `RELEASING.md` cites. Attribution is the one thing a
    // no-third-party-origins project must still name in prose: `font-src 'self'`
    // stops the browser fetching from an upstream, and says nothing about
    // crediting it.
    //
    // EVERY VENDORED ARTIFACT NEEDS ITS ENTRY HERE. Inter's was missed when the
    // font was vendored on 2026-08-23, which turned `check:deploy` red on a
    // correct `NOTICE.md` — the check accusing the attribution file of being
    // wrong when the omission was the check's own.
    for (const url of text.match(/https?:\/\/[^\s'"`)\]]+/g) ?? []) {
      // HOST-AND-PATH MATCHED, never substring-matched (CodeQL
      // js/incomplete-url-substring-sanitization). `startsWith(CANONICAL_URL)`
      // accepts `https://gimbal.edycu.dev.attacker.test/`, and
      // `includes('conventionalcommits.org')` accepts any host that merely
      // mentions it in a query string. Both are the exact non-canonical URL
      // this check exists to catch.
      const allowed =
        onCanonicalOrigin(url) ||
        atHostPath(url, 'github.com', '/google-ai-edge/mediapipe') ||
        atHostPath(url, 'storage.googleapis.com', '/mediapipe-models') ||
        atHostPath(url, 'github.com', '/rsms/inter') ||
        // The GitHub mark in the landing-page footer, attributed in NOTICE.md.
        // Same category as the three above: the upstream page for a third-party
        // asset this project uses. Attribution REQUIRES naming the source, so an
        // allowlist that forbids it would force the choice between a red check
        // and an unattributed asset. Host-and-path matched like the others.
        atHostPath(url, 'github.com', '/primer/octicons') ||
        hostMatches(url, 'conventionalcommits.org');
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
