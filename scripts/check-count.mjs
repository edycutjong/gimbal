#!/usr/bin/env node
//
// U-COUNT — the published test count is the count the RUNNER reports.
//
// This check used to live in `checks.mjs` and counted source lines matching
// `^\s*it\(` under `tests/`. That is not a count of tests: it is a count of
// call sites. `tests/screens-setup.cov.test.ts` has one `it(` inside a loop
// over a five-case table, so the static count read 1,057 while `vitest`
// reported 1,062 — and the check went green the whole time, because it was
// comparing its own static count against the README rather than against the
// thing a reader actually runs.
//
// A check that cannot observe the quantity it guards is a green tick standing
// in for evidence. So the count now comes from the runner's own JSON report,
// which is the number a judge sees when they follow the README's instruction
// to run `npm test`.
//
// WHY THIS IS A SEPARATE SCRIPT rather than a ninth id in `checks.mjs`:
// `checks.mjs` runs BEFORE the suite and is air-gapped by construction — every
// file it reads is committed. This one reads an artifact the suite produces, so
// it must run AFTER it, and it is honest about being build-dependent rather
// than pretending to be static. That is the same partition rule that keeps
// U-DIST, U-CFG, U-DOC and U-DEP out of `npm test`.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = join(root, '.vitest-report.json');
const read = (f) => readFileSync(join(root, f), 'utf8');

if (!existsSync(REPORT)) {
  console.error(
    'U-COUNT: no runner report at .vitest-report.json.\n' +
      '  This check reads the suite\'s own output, so the suite has to have run.\n' +
      '  Use `npm test` (or `npm run test:coverage`), not a bare `vitest run`.',
  );
  process.exit(1);
}

const report = JSON.parse(readFileSync(REPORT, 'utf8'));
const actual = report.numTotalTests;
const files = report.testResults?.length ?? 0;

if (!Number.isInteger(actual) || actual <= 0) {
  console.error(`U-COUNT: the runner report carries no usable test count (${actual}).`);
  process.exit(1);
}

const problems = [];

// README.md — "**N** automated tests"
const printed = read('README.md').match(/\*\*(\d+)\*\* automated (?:checks|tests)/);
if (!printed) problems.push('README.md does not print a test count');
else if (Number(printed[1]) !== actual) {
  problems.push(`README.md says ${printed[1]}; the runner reports ${actual}`);
}

// The landing page publishes it twice, and both are asserted: a visible copy
// that no check reads is a copy that drifts, and this one sits on the most-read
// surface in the project.
const html = read('index.html');

const stat = html.match(
  /<span class="lp-fact-n tnum">(\d+)<\/span>\s*<span class="lp-fact-l">automated tests/,
);
if (!stat) problems.push('index.html does not print the headline test count');
else if (Number(stat[1]) !== actual) {
  problems.push(`index.html headline stat says ${stat[1]}; the runner reports ${actual}`);
}

const spec = html.match(/Automated tests[\s\S]{0,220}?<dd class="lp-spec-v tnum">(\d+)<\/dd>/);
if (!spec) problems.push('index.html does not print the datasheet test count');
else if (Number(spec[1]) !== actual) {
  problems.push(`index.html datasheet row says ${spec[1]}; the runner reports ${actual}`);
}

if (problems.length) {
  console.error(`\nU-COUNT failed — the runner reports ${actual} tests across ${files} files:\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('\nPublish the runner\'s number, not a hand count.\n');
  process.exit(1);
}

console.log(`  ✓ U-COUNT  ${actual} tests across ${files} files, and every published copy agrees`);
