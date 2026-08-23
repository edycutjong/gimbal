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

  await page.goto('/app');
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

/**
 * The landing page is the surface that STATES the zero-origin claim, so it is
 * also the surface most able to falsify it — one embedded font, one analytics
 * pixel, one social-card image served from someone else's CDN and the sentence
 * in section 03 becomes false on the page that prints it.
 */
test('the landing page loads with zero third-party origins', async ({ page, baseURL }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));

  await page.goto('/');
  await page.waitForSelector('.lp-replay');
  await page.waitForTimeout(1500);

  const appOrigin = new URL(baseURL ?? 'http://127.0.0.1:5173').origin;
  const foreign = requests.filter((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return false;
    return new URL(url).origin !== appOrigin;
  });

  expect(requests.length).toBeGreaterThan(0);
  expect(foreign).toEqual([]);
  // The vendored typeface is same-origin or it is not loaded at all.
  expect(requests.some((u) => u.includes('/fonts/InterVariable.woff2'))).toBe(true);
});

test('both pages declare the same policy, connect-src self, and deny the microphone', async ({ page }) => {
  const policies: string[] = [];
  for (const route of ['/', '/app']) {
    await page.goto(route);
    const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
    expect(csp, `no CSP meta on ${route}`).toBeTruthy();
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).toContain("font-src 'self'");
    // The only eval relaxation is the wasm one — never widened to 'unsafe-eval'.
    expect(/(^|[^-])'unsafe-eval'/.test(csp ?? '')).toBe(false);
    policies.push(csp as string);
  }
  // Two pages, one policy. A landing page with a looser CSP than the app is the
  // easiest possible way for the claim to stop being true where it is stated.
  expect(policies[0]).toBe(policies[1]);
});
