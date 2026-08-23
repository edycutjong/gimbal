import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fixture, injectRecordedCamera, completePrescribe, startBlock, FIXTURE_DIR, ROOT } from './harness.ts';
import { segmentSeries, type SegmenterSample } from '../src/dsp/segment.ts';
import { scoreCycle } from '../src/dsp/score.ts';
import { deadbandDegPerSec, INSTRUMENT_LIMITS } from '../src/dsp/limits.ts';
import { parseCard } from '../src/protocol/card.ts';
import { SESSION_SCHEMA, dequantiseVelocities, type PersistedSession } from '../src/store/session.ts';

/**
 * THE R11 GATE — the judged capability, executed for real.
 *
 * The judged capability, named: **Gimbal converts webcam pixels of a moving head
 * into a delivered-dose number in seconds, and that number is correct — it
 * credits motion that met the prescribed angular-velocity band and it credits
 * exactly zero for motion that did not.**
 *
 * The test that does NOT count, and which this project would have shipped
 * without that lesson:
 *
 *     expect(scoreCycle({ peakVelocity: 40, ... }, card))
 *       .toEqual({ credited: false, reason: 'too-slow' })
 *
 * That assertion is true, useful, and in the unit suite. It would STILL PASS if
 * `decomposeYaw` returned a constant, if the central difference divided by a
 * hardcoded 33.3 ms, if the bias correction were deleted, if `FaceLandmarker`
 * were never instantiated, or if the camera were unplugged. Coverage is not the
 * gate.
 *
 * The gate is: **does the number match the physical world, measured by an
 * instrument Gimbal does not control?**
 *
 * ── Status of the nine assertions ────────────────────────────────────────
 * A1–A5 are scored against a gyroscope recording; V1–V4 against the frozen
 * example ledger. Neither fixture exists yet. **An assertion whose fixture does
 * not exist is ABSENT, not passing** — it skips with a named reason, and this
 * file will not report a green tick standing in for evidence.
 */

const GYRO_DIR = join(FIXTURE_DIR, 'bench');
const gyroCsv = join(GYRO_DIR, 'gyro.csv');
const benchVideo = join(GYRO_DIR, 'webcam.mp4');
const exampleLedger = join(ROOT, 'public', 'fixtures', 'example-ledger.json');
const checksums = join(FIXTURE_DIR, 'CHECKSUMS.txt');

/**
 * A1's tolerance, chosen BEFORE the measurement exists.
 *
 * At 2 Hz and ±20° amplitude, peak angular velocity is ω = 2πfA ≈ 251 °/s, and
 * the central-difference bias correction is worth 2.90 % of that ≈ 7.3 °/s. The
 * gate is set at 6.0 °/s specifically so that **deleting the bias correction
 * makes the gate fail**. The correction is therefore load-bearing in the test,
 * not decoration in METHODS.md.
 *
 * If the recording measures worse than 6.0 °/s, the response is to publish the
 * measured number and lower the prescribed band — never to raise the tolerance
 * to fit.
 */
export const A1_TOLERANCE_DEG_PER_SEC = 6.0;

/** Scores a gyroscope trace through the SAME pure DSP modules the optical path uses. */
export function scoreGyroCsv(csv: string, card: ReturnType<typeof parseCard>): {
  cycles: ReturnType<typeof segmentSeries>;
  creditedSeconds: number;
} {
  const rows = csv
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.split(',').map(Number));

  // The strap is at the temple, so yaw rate is the axis normal to the sagittal
  // plane. The reference uses |ω| per cycle, exactly as the optical path does.
  const samples: SegmenterSample[] = rows.map(([tMs, , wy]) => ({
    tMs: tMs as number,
    omega: (wy as number) * (180 / Math.PI),
    quality: 1,
    facePresent: true,
  }));

  const cycles = segmentSeries(samples, {
    deadbandDegPerSec: deadbandDegPerSec(card.peakVelocityFloor.value),
    fHat: (card.frequencyBand.value[0] + card.frequencyBand.value[1]) / 2,
    limits: INSTRUMENT_LIMITS,
  });

  let creditedSeconds = 0;
  for (const c of cycles) creditedSeconds += scoreCycle(c, card, INSTRUMENT_LIMITS).doseSeconds;
  return { cycles, creditedSeconds };
}

const benchPresent = existsSync(gyroCsv) && existsSync(benchVideo);
const benchReason =
  'the bench fixture (fixtures/bench/gyro.csv + webcam.mp4) has not been recorded yet. ' +
  'It requires a phone gyroscope held rigidly at the temple while the webcam runs Gimbal — ' +
  'see fixtures/README.md. It cannot be synthesised: the whole point is a sensor Gimbal does not control.';

test.describe('A1–A5 — the measurement against an independent sensor', () => {
  test.skip(!benchPresent, benchReason);

  test('A1 · webcam peak |omega| agrees with the gyroscope within the pre-set tolerance', async ({ page }) => {
    const card = parseCard(JSON.parse(readFileSync(join(ROOT, 'public/cards/demo-vorx1-yaw-seated.json'), 'utf8')));
    const reference = scoreGyroCsv(readFileSync(gyroCsv, 'utf8'), card);

    await injectRecordedCamera(page, benchVideo);
    await page.goto('/app');
    await completePrescribe(page);
    await startBlock(page);
    await page.waitForSelector('#screen-gate:not([hidden])', { timeout: 150_000 });

    // Read the optical per-cycle peaks back through the REAL persistence path —
    // the same bytes the export button downloads — rather than through a test
    // hook wired into production code for the benefit of this assertion.
    const stored = await page.evaluate(() => globalThis.localStorage.getItem('gimbal.v1.sessions'));
    const sessions = JSON.parse(stored ?? '[]') as PersistedSession[];
    const optical = sessions.flatMap((s) => s.blocks.flatMap((b) => dequantiseVelocities(b.peakVelocitiesQ)));
    expect(optical.length).toBeGreaterThan(0);

    const n = Math.min(optical.length, reference.cycles.length);
    const errors = Array.from({ length: n }, (_, i) =>
      Math.abs((optical[i] as number) - (reference.cycles[i]?.peakOmega ?? 0)),
    ).sort((a, b) => a - b);
    const medianAbsError = errors[n >> 1] as number;

    // Published as: "webcam-derived peak head velocity agrees with a phone
    // gyroscope to within X deg/s median absolute error over N credited cycles —
    // single subject, one camera, stated lighting." Never called a study.
    expect(medianAbsError).toBeLessThanOrEqual(A1_TOLERANCE_DEG_PER_SEC);
  });

  test('A3 · the deliberately sub-therapeutic segment credits EXACTLY 0.000 s', async ({ page }) => {
    // This is the product. If the band is widened, the floor bypassed, or
    // refusal silently degrades to crediting, this assertion is what fails.
    const clip = fixture('bench/sub-therapeutic.mp4');
    test.skip(!clip.present, clip.reason);

    await injectRecordedCamera(page, clip.path);
    await page.goto('/app');
    await completePrescribe(page, { blockSeconds: '25', blockCount: '1' });
    await startBlock(page);
    await page.waitForSelector('#screen-gate:not([hidden])', { timeout: 120_000 });
    await page.check('input[name="rating"][value="2"]');
    await page.click('#gate-continue');
    await page.waitForSelector('.report');

    expect(await page.textContent('.dose-total')).toMatch(/delivered 0\.0 of the prescribed/);
    const tooSlow = await page.textContent('.histogram-row:has-text("Too slow") td.num');
    expect(Number(tooSlow)).toBeGreaterThan(0);
  });
});

test.describe('V1–V4 — the example-ledger disclosure', () => {
  const ledgerPresent = existsSync(exampleLedger);
  test.skip(
    !ledgerPresent,
    'public/fixtures/example-ledger.json has not been frozen yet. It is built by ' +
      '`npm run build:example-ledger` from real sessions exported through the app\'s own download ' +
      'button — it is never generated, and there is no synthetic session seeder in this repo.',
  );

  test('V1 · the frozen fixture matches its committed checksum', () => {
    expect(existsSync(checksums), 'fixtures/CHECKSUMS.txt is missing').toBe(true);
    const expected = readFileSync(checksums, 'utf8').match(/([0-9a-f]{64})\s+example-ledger\.json/)?.[1];
    expect(expected, 'no example-ledger.json entry in CHECKSUMS.txt').toBeTruthy();
    // A hand-edited fixture — i.e. a fabricated measurement — cannot ship silently.
    const actual = createHash('sha256').update(readFileSync(exampleLedger)).digest('hex');
    expect(actual).toBe(expected);
  });

  test('V2 · every record is labelled example and captured by the developer', () => {
    const rows = JSON.parse(readFileSync(exampleLedger, 'utf8'));
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.schema).toBe(SESSION_SCHEMA);
      expect(row.provenance).toBe('example');
      expect(row.capturedBy).toBe('developer');
    }
  });

  test('V3 · all records share one device signature and one card hash', () => {
    const rows = JSON.parse(readFileSync(exampleLedger, 'utf8'));
    expect(new Set(rows.map((r: { device: { sigHash: string } }) => r.device.sigHash)).size).toBe(1);
    expect(new Set(rows.map((r: { cardHash: string }) => r.cardHash)).size).toBe(1);
  });

  test('V4 · the rendered ledger shows the banner and one EXAMPLE chip per row', async ({ page }) => {
    // V4 asserts the DISCLOSURE, not the data — which is why it is in the gate
    // at all. The label silently disappearing after a refactor is the single
    // most likely way this project would accidentally mislabel example history.
    await page.goto('/app');
    await page.waitForSelector('#gate-ack');
    await page.click('#example-report');
    await page.waitForSelector('.report', { timeout: 30_000 });
    await page.click('#session-history');
    await page.waitForSelector('#screen-ledger:not([hidden])');

    const banner = await page.textContent('.example-banner');
    expect(banner).toContain('recorded by the developer');
    expect(banner).toContain('not patient data');

    const rows = await page.$$eval('tr[data-provenance="example"]', (n) => n.length);
    const chips = await page.$$eval('tr[data-provenance="example"] .chip', (n) => n.length);
    expect(rows).toBeGreaterThan(0);
    expect(chips).toBe(rows);
  });
});
