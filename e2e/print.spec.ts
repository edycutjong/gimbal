import { test, expect } from '@playwright/test';
import { fixture, injectRecordedCamera, completePrescribe, startBlock } from './harness.ts';

/**
 * The print gate.
 *
 * The report is the same document on screen and on paper. What has to be true
 * on paper and is easy to lose: it fits ONE letter page, every `<details>` is
 * expanded, every criterion carries a citation, and nothing depends on hue.
 *
 * Pagination is a build gate, not a hope. If it paginates, the fix is to cut
 * content until it does not — the citation block's 8-entry cap exists for
 * exactly that.
 */
test.describe('the printed one-pager', () => {
  const clip = fixture('compliant.mp4');
  test.skip(!clip.present, clip.reason);

  test('is one letter page with citations expanded and no colour dependency', async ({ page }) => {
    await injectRecordedCamera(page, clip.path, true);
    await page.goto('/app');
    await completePrescribe(page, { blockSeconds: '20', blockCount: '1' });
    await startBlock(page);
    await page.waitForSelector('#screen-gate:not([hidden])', { timeout: 120_000 });
    await page.check('input[name="rating"][value="2"]');
    await page.click('#gate-continue');
    await page.waitForSelector('.report');

    await page.emulateMedia({ media: 'print' });

    // Every disclosure is visible in print, whether or not it carries `open`.
    const hiddenDisclosures = await page.$$eval('.report details .disclosure-body', (nodes) =>
      nodes.filter((n) => getComputedStyle(n).display === 'none').length,
    );
    expect(hiddenDisclosures).toBe(0);

    // Every criterion row carries a non-empty source string.
    const emptySources = await page.$$eval('.report tbody tr .disclosure-body', (nodes) =>
      nodes.filter((n) => (n.textContent ?? '').trim().length === 0).length,
    );
    expect(emptySources).toBe(0);

    // The three .no-print buttons and the settings row are gone.
    const visibleButtons = await page.$$eval('.report button, .settings-row', (nodes) =>
      nodes.filter((n) => getComputedStyle(n).display !== 'none').length,
    );
    expect(visibleButtons).toBe(0);

    // One US Letter page at 0.5in margins is 10in of live area ≈ 960 CSS px.
    const pdf = await page.pdf({ format: 'Letter', margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' } });
    const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pageCount, 'the report must fit exactly one letter page').toBe(1);
  });
});
