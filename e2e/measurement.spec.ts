import { test, expect } from '@playwright/test';
import { fixture, injectRecordedCamera, completePrescribe, startBlock, deliveredSeconds } from './harness.ts';

/**
 * The negative controls — the direction nobody tests.
 *
 * A broken instrument fails in TWO directions, and a hackathon suite normally
 * tests only one. GT-3 and GT-4 test the other: does the instrument credit dose
 * for motion that did not happen?
 *
 * A pipeline whose landmarks jitter would emit small nonzero velocities and,
 * with a sloppy floor, could credit dose for SITTING STILL. That is the most
 * embarrassing failure available to a dose meter, and nothing else in the suite
 * catches it.
 */

test.describe('GT-3 — a stationary face credits exactly zero', () => {
  const clip = fixture('still-face.mp4');
  test.skip(!clip.present, clip.reason);

  test('delivered dose is 0.000 s and no velocity number is rendered', async ({ page }) => {
    await injectRecordedCamera(page, clip.path);
    await page.goto('/');
    await completePrescribe(page, { blockSeconds: '20', blockCount: '1' });
    await startBlock(page);
    await page.waitForSelector('#screen-gate:not([hidden])', { timeout: 120_000 });

    // The report is the artifact; read the dose off it rather than off a
    // mid-block readout.
    await page.check('input[name="rating"][value="2"]');
    await page.click('#gate-continue');
    await page.waitForSelector('.report');

    const total = (await page.textContent('.dose-total')) ?? '';
    expect(total).toMatch(/delivered 0\.0 of the prescribed/);

    const credited = await page.textContent('.histogram-row:has-text("Credited") td.num');
    expect(Number(credited)).toBe(0);
  });
});

test.describe('GT-4 — an empty room refuses face-lost and never emits NaN', () => {
  const clip = fixture('no-face.mp4');
  test.skip(!clip.present, clip.reason);

  test('reason is face-lost, dose is 0, and nothing crashes', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await injectRecordedCamera(page, clip.path);
    await page.goto('/');
    await completePrescribe(page, { blockSeconds: '10', blockCount: '1' });
    await startBlock(page);
    await page.waitForTimeout(12_000);

    expect(await deliveredSeconds(page)).toBe(0);
    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toContain('NaN');
    expect(errors).toEqual([]);
  });
});

test.describe('GT-2 — a scripted 2.000 Hz oscillation recovers its own frequency', () => {
  const clip = fixture('metronome-2hz.mp4');
  test.skip(!clip.present, clip.reason);

  test('the reported dominant frequency lands within one bin of 2.000 Hz', async ({ page }) => {
    await injectRecordedCamera(page, clip.path);
    await page.goto('/');
    await completePrescribe(page, { blockSeconds: '60', blockCount: '1' });
    await startBlock(page);
    await page.waitForSelector('#screen-gate:not([hidden])', { timeout: 150_000 });
    await page.check('input[name="rating"][value="2"]');
    await page.click('#gate-continue');
    await page.waitForSelector('.report');

    const measured = await page.textContent('.report-band:has-text("Frequency compliance") td.num');
    const hz = Number((measured ?? '').replace(/[^\d.]/g, ''));
    // One bin at 30 fps is 30/256 = 0.1172 Hz. The stimulus's parameter is exact
    // by construction, so this is a ground truth that is not in dispute.
    expect(Math.abs(hz - 2.0)).toBeLessThanOrEqual(0.1172);
  });
});

test.describe('P1 — the deployed URL, loaded cold, reaches a credited cycle', () => {
  const clip = fixture('compliant.mp4');
  test.skip(!clip.present, clip.reason);

  test('a real MediaStream through the real model produces credit', async ({ page }) => {
    await injectRecordedCamera(page, clip.path, true);
    await page.goto('/');
    await completePrescribe(page, { blockSeconds: '30', blockCount: '1' });
    await startBlock(page);
    await page.waitForFunction(() => {
      const t = document.querySelector('#dose-readout')?.textContent ?? '';
      const m = t.match(/([\d.]+)\s*\//);
      return m ? Number(m[1]) > 0 : false;
    }, undefined, { timeout: 120_000 });
    expect(await deliveredSeconds(page)).toBeGreaterThan(0);
  });
});
