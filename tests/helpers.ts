import type { ProtocolCard } from '../src/protocol/card.ts';
import type { Cycle } from '../src/dsp/types.ts';
import type { SegmenterSample } from '../src/dsp/segment.ts';
import { centralDifference } from '../src/dsp/velocity.ts';

/**
 * A SYNTHETIC card, for testing pure functions only.
 *
 * These numbers are not clinical values and never reach the app: `fixtures/` may
 * not synthesise, `tests/` may. The distinction is enforced by directory, and it
 * is the difference between testing and demo data.
 */
export function testCard(overrides: Partial<Record<string, number>> = {}): ProtocolCard {
  const src = 'synthetic value for a unit test; not a clinical parameter';
  return {
    schemaVersion: 1,
    exercise: 'vorx1-yaw',
    stage: { label: 'seated', selfAttested: true },
    frequencyBand: { value: [overrides.bandLo ?? 1.7, overrides.bandHi ?? 2.3], source: src },
    peakVelocityFloor: { value: overrides.floor ?? 150, source: src },
    peakVelocityCeiling: { value: overrides.ceiling ?? 350, source: src },
    blockSeconds: { value: overrides.blockSeconds ?? 120, source: src },
    blockCount: { value: overrides.blockCount ?? 3, source: src },
    symptomStopRule: {
      baselineRise: { value: overrides.baselineRise ?? 3, source: src },
      absoluteCeiling: { value: overrides.absoluteCeiling ?? 7, source: src },
    },
    enteredBy: 'patient-from-clinician-handout',
  };
}

export function testCycle(overrides: Partial<Cycle> = {}): Cycle {
  return {
    tStartMs: 0,
    tEndMs: 500,
    periodMs: 500,
    peakOmega: 250,
    rawPeakOmega: 243,
    sampleCount: 15,
    qMin: 0.9,
    qMean: 0.95,
    fHat: 2.0,
    faceLost: false,
    saturated: false,
    ...overrides,
  };
}

/**
 * Synthesises a head-oscillation sample series and differentiates it exactly the
 * way the live pipeline does.
 *
 * `durationSec` defaults to `(cycles + 0.5) / freqHz`: the extra half period is
 * what makes the final sign change — and therefore the final complete cycle —
 * fall inside the record. Without it the last oscillation is a partial cycle and
 * the count is one short, which is an artefact of where the recording stops
 * rather than of the segmenter.
 */
export function oscillation(opts: {
  freqHz: number;
  amplitudeDeg: number;
  fs: number;
  cycles?: number;
  durationSec?: number;
  quality?: number;
  facePresent?: boolean;
  jitterMs?: (i: number) => number;
  dropoutRange?: [number, number];
}): SegmenterSample[] {
  const { freqHz, amplitudeDeg, fs } = opts;
  const cycles = opts.cycles ?? 20;
  const durationSec = opts.durationSec ?? (cycles + 0.5) / freqHz;
  const n = Math.round(durationSec * fs);

  const times: number[] = [];
  const angles: number[] = [];
  for (let i = 0; i <= n; i++) {
    const jitter = opts.jitterMs ? opts.jitterMs(i) : 0;
    times.push((i * 1000) / fs + jitter);
    angles.push(amplitudeDeg * Math.sin((2 * Math.PI * freqHz * (i / fs))));
  }

  const out: SegmenterSample[] = [];
  for (let i = 2; i <= n; i++) {
    const tMs = times[i - 1] as number;
    const omega = centralDifference(
      angles[i] as number,
      angles[i - 2] as number,
      times[i] as number,
      times[i - 2] as number,
    );
    const inDropout =
      opts.dropoutRange !== undefined && tMs >= opts.dropoutRange[0] && tMs <= opts.dropoutRange[1];
    if (inDropout) continue;
    out.push({
      tMs,
      omega,
      quality: opts.quality ?? 0.95,
      facePresent: opts.facePresent ?? true,
    });
  }
  return out;
}
