#!/usr/bin/env node
/**
 * The freeze step.
 *
 * WHAT IT DOES NOT DO: generate, interpolate, smooth, fill, randomise, or adjust
 * any measurement. **There is no PRNG import in this file, and that is a
 * reviewable property.** It moves bytes; it never invents a number.
 *
 * Input:  fixtures/ledger/*.json — files exported by the app's own Download
 *         JSON button, from real sessions the developer actually performed.
 * Output: public/fixtures/example-ledger.json, plus its SHA-256 in
 *         fixtures/CHECKSUMS.txt.
 *
 * Determinism is total and testable: same inputs → byte-identical output on any
 * machine, any day. No build timestamp, no hostname, no cwd, no node version
 * reaches the output. `--check` re-derives in memory and exits non-zero on any
 * difference, so a hand-edited fixture fails the build.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INPUT_DIR = join(ROOT, 'fixtures', 'ledger');
const OUTPUT = join(ROOT, 'public', 'fixtures', 'example-ledger.json');
const CHECKSUMS = join(ROOT, 'fixtures', 'CHECKSUMS.txt');
const CHECK_ONLY = process.argv.includes('--check');

const SCHEMA = 'gimbal.session/1';
const DEMO_CARD_ID = 'demo-vorx1-yaw-seated';

/** Explicit key order — a stable serialisation is what makes byte-identity possible. */
const KEY_ORDER = [
  'schema', 'id', 'provenance', 'capturedBy', 'startedAt', 'cardId', 'cardHash', 'card',
  'device', 'blocks', 'symptom', 'totals', 'appVersion', 'methodsRev', 'audioOff',
];

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    const known = KEY_ORDER.filter((k) => keys.includes(k));
    const rest = keys.filter((k) => !KEY_ORDER.includes(k)).sort();
    const out = {};
    for (const k of [...known, ...rest]) out[k] = ordered(value[k]);
    return out;
  }
  return value;
}

if (!existsSync(INPUT_DIR)) {
  process.stderr.write(
    `\nfixtures/ledger/ does not exist yet.\n\n` +
      `The example ledger is frozen from REAL sessions, exported through the app's own\n` +
      `Download JSON button. There is no synthetic session seeder in this repository and\n` +
      `there will not be one: synthetic longitudinal data is a fabricated measurement.\n\n` +
      `Run sessions, download each one, drop the files in fixtures/ledger/, and re-run this.\n` +
      `The trend annotation needs six on one device signature before it renders anything.\n\n`,
  );
  process.exit(1);
}

const files = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
  process.stderr.write('fixtures/ledger/ contains no .json exports.\n');
  process.exit(1);
}

const records = [];
for (const file of files) {
  const record = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8'));

  if (record.schema !== SCHEMA) {
    process.stderr.write(`${file}: unknown schema ${record.schema}\n`);
    process.exit(1);
  }
  if (record.provenance !== 'example') {
    process.stderr.write(`${file}: provenance is "${record.provenance}", not "example".\n`);
    process.exit(1);
  }
  if (record.capturedBy !== 'developer') {
    process.stderr.write(`${file}: capturedBy is not "developer".\n`);
    process.exit(1);
  }
  if (record.cardId !== DEMO_CARD_ID) {
    process.stderr.write(`${file}: cardId is "${record.cardId}", not "${DEMO_CARD_ID}".\n`);
    process.exit(1);
  }
  records.push(record);
}

// One device or no trend. A cross-device trend line would contaminate the exact
// property that differentiates this product.
const signatures = new Set(records.map((r) => r.device?.sigHash));
if (signatures.size > 1) {
  process.stderr.write(`records span ${signatures.size} device signatures; the ledger requires exactly one.\n`);
  process.exit(1);
}

// Total order, no ties possible.
records.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));

const serialised = `${JSON.stringify(records.map(ordered), null, 2)}\n`;
const sha = createHash('sha256').update(serialised).digest('hex');

if (CHECK_ONLY) {
  if (!existsSync(OUTPUT)) {
    process.stderr.write('--check: public/fixtures/example-ledger.json does not exist.\n');
    process.exit(1);
  }
  const committed = readFileSync(OUTPUT, 'utf8');
  if (committed !== serialised) {
    process.stderr.write('--check: the committed example ledger differs from what these inputs produce.\n');
    process.exit(1);
  }
  process.stdout.write(`  ✓ example ledger is byte-identical to its inputs (${records.length} sessions)\n`);
  process.exit(0);
}

mkdirSync(join(ROOT, 'public', 'fixtures'), { recursive: true });
writeFileSync(OUTPUT, serialised);

const existing = existsSync(CHECKSUMS)
  ? readFileSync(CHECKSUMS, 'utf8').split('\n').filter((l) => l.trim() && !l.includes('example-ledger.json'))
  : [];
writeFileSync(CHECKSUMS, [...existing, `${sha}  example-ledger.json`].join('\n') + '\n');

process.stdout.write(`\nWrote ${records.length} example sessions.\n  sha256 ${sha}\n\n`);
