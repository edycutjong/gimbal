import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const FIXTURE_DIR = join(ROOT, 'fixtures');

/**
 * The eight evaluation numbers, identical to the table in README.md.
 *
 * They live here so the harness types what a judge types — through the real
 * form, with no shortcut into the card. There is no code path in the
 * application that would accept them any other way.
 */
export const EVALUATION_CARD: Record<string, string> = {
  frequencyBandLow: '1.7',
  frequencyBandHigh: '2.3',
  peakVelocityFloor: '150',
  peakVelocityCeiling: '350',
  blockSeconds: '60',
  blockCount: '1',
  stopRuleBaselineRise: '3',
  stopRuleAbsoluteCeiling: '7',
};

export interface Fixture {
  /** Absolute path to the committed recording. */
  path: string;
  present: boolean;
  /** Why the spec is skipped, when it is. Named, never silent. */
  reason: string;
}

/**
 * Fixtures are REAL RECORDINGS and cannot be generated. A missing fixture SKIPS
 * its spec with a named reason — it never passes vacuously, because a green tick
 * standing in for evidence is worse than a visible gap.
 */
export function fixture(name: string): Fixture {
  const path = join(FIXTURE_DIR, name);
  const present = existsSync(path);
  return {
    path,
    present,
    reason: `fixture ${name} has not been recorded yet — see fixtures/README.md for the recording protocol. It cannot be synthesised: a simulated head would make this a simulated measurement.`,
  };
}

/**
 * Hands the page a REAL `MediaStream` carrying the fixture's decoded frames.
 *
 * `navigator.mediaDevices.getUserMedia` is overridden before any application
 * code runs, and returns `videoEl.captureStream()` from a `<video>` element
 * decoding the committed recording. Every frame then travels the SAME
 * `requestVideoFrameCallback` → `FaceLandmarker.detectForVideo()` → DSP →
 * `scoreCycle` path as a live camera. Nothing in the application knows the
 * difference, and nothing in the application had to be modified to allow it —
 * which is why there is no dev route to strip from the production bundle.
 */
export async function injectRecordedCamera(page: Page, fixturePath: string, loop = false): Promise<void> {
  const bytes = readFileSync(fixturePath);
  const dataUrl = `data:video/mp4;base64,${bytes.toString('base64')}`;

  await page.addInitScript(
    ({ src, shouldLoop }) => {
      const makeStream = async (): Promise<MediaStream> => {
        const video = document.createElement('video');
        video.src = src;
        video.muted = true;
        video.loop = shouldLoop;
        video.playsInline = true;
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error('fixture failed to decode'));
        });
        await video.play();
        // A real MediaStream, from real decoded pixels.
        return (video as HTMLVideoElement & { captureStream(): MediaStream }).captureStream();
      };

      const devices = navigator.mediaDevices ?? ({} as MediaDevices);
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: Object.assign(Object.create(Object.getPrototypeOf(devices)), devices, {
          getUserMedia: () => makeStream(),
          enumerateDevices: async () => [
            { deviceId: 'fixture', kind: 'videoinput', label: 'committed recording', groupId: 'fixture' },
          ],
        }),
      });
    },
    { src: dataUrl, shouldLoop: loop },
  );
}

/** Fills the Prescribe form exactly as a judge would, then continues. */
export async function completePrescribe(page: Page, overrides: Partial<Record<string, string>> = {}): Promise<void> {
  const values = { ...EVALUATION_CARD, ...overrides };
  await page.check('#gate-ack');
  for (const [id, value] of Object.entries(values)) {
    await page.fill(`#f-${id}`, value);
  }
  await page.check('input[name="stage"][value="seated"]');
  await page.click('#continue');
}

/** Runs the setup screen through to a started block. */
export async function startBlock(page: Page): Promise<void> {
  await page.click('#allow-camera');
  await page.waitForSelector('#start:not([disabled])', { timeout: 60_000 });
  await page.click('#start');
  // The baseline symptom rating comes first — the stop rule needs a reference.
  await page.waitForSelector('#scale');
  await page.check('input[name="rating"][value="2"]');
  await page.click('#gate-continue');
  await page.waitForSelector('#dose-readout');
}

/** Reads the delivered dose off the block screen, in seconds. */
export async function deliveredSeconds(page: Page): Promise<number> {
  const text = (await page.textContent('#dose-readout')) ?? '';
  const m = text.match(/([\d.]+)\s*\/\s*([\d.]+)\s*min/);
  return m ? Number(m[1]) * 60 : NaN;
}
