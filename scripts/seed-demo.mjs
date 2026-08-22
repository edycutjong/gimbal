#!/usr/bin/env node
/**
 * `npm run seed:demo` — demo-machine preparation only.
 *
 * It opens the app in the recording browser profile and CLICKS THE SAME BUTTON A
 * HUMAN WOULD. It does not poke `localStorage` directly, because a seeding path
 * that bypasses the import validation is a path that can install a record the
 * app would have rejected.
 *
 * It exists so a recording session starts from a known state instead of from
 * whatever the browser accumulated. **It is dev-only and appears in no reproduce
 * command, no video, and no submission field. The judge's path is the button.**
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LEDGER = join(ROOT, 'public', 'fixtures', 'example-ledger.json');

if (!existsSync(LEDGER)) {
  process.stderr.write(
    '\npublic/fixtures/example-ledger.json does not exist yet.\n\n' +
      'Freeze it first with `npm run build:example-ledger`, from real sessions exported\n' +
      "through the app's own Download JSON button. There is no generator.\n\n",
  );
  process.exit(1);
}

const script = `
import { test } from '@playwright/test';
test('seed the example ledger through the real import path', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#gate-ack');
  await page.click('#example-report');
  await page.waitForSelector('.report', { timeout: 30000 });
  await page.click('#session-history');
  await page.waitForSelector('#screen-ledger:not([hidden])');
  const rows = await page.$$eval('tr[data-provenance="example"]', (n) => n.length);
  console.log('seeded example sessions:', rows);
});
`;

const tmp = join(ROOT, 'e2e', '.seed-demo.spec.ts');
const { writeFileSync, rmSync } = await import('node:fs');
writeFileSync(tmp, script);
try {
  const run = spawnSync('npx', ['playwright', 'test', '.seed-demo.spec.ts'], { cwd: ROOT, stdio: 'inherit' });
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(tmp, { force: true });
}
