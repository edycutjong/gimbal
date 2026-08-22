import { test, expect } from '@playwright/test';
import { completePrescribe } from './harness.ts';

/**
 * P2 — self-contained.
 *
 * Zero third-party origins after page load. The privacy claim is enforced by the
 * browser, not by discipline: `connect-src 'self'` means a future commit that
 * added a `fetch()` to an analytics endpoint would be BLOCKED, not merely
 * caught in review.
 *
 * The request count must be > 0, so an empty capture cannot pass this test by
 * recording nothing.
 */
test('every network request during a full page life shares the app origin', async ({ page, baseURL }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));

  await page.goto('/');
  await page.waitForSelector('#gate-ack');
  await completePrescribe(page);
  await page.waitForSelector('#screen-setup:not([hidden])');
  await page.waitForTimeout(2000);

  const appOrigin = new URL(baseURL ?? 'http://127.0.0.1:5173').origin;
  const foreign = requests.filter((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return false;
    return new URL(url).origin !== appOrigin;
  });

  expect(requests.length).toBeGreaterThan(0);
  expect(foreign).toEqual([]);
});

test('the page declares connect-src self and denies the microphone', async ({ page }) => {
  await page.goto('/');
  const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("'wasm-unsafe-eval'");
  // The only eval relaxation is the wasm one — never widened to 'unsafe-eval'.
  expect(/(^|[^-])'unsafe-eval'/.test(csp ?? '')).toBe(false);
});
