import { describe, it, expect } from 'vitest';
import {
  centralDifference,
  centralDifferenceGain,
  biasCorrectionFactor,
  correctPeak,
  peakOmegaFor,
} from '../src/dsp/velocity.ts';

const FS = 30;
const T = 1 / FS;

/** Peak |ω| a 3-point central difference reports for an analytic sine, sampled at fs. */
function measuredPeak(freqHz: number, amplitudeDeg: number, fs: number): number {
  const n = Math.ceil((fs * 4) / freqHz);
  const t = (i: number) => (i * 1000) / fs;
  const y = (i: number) => amplitudeDeg * Math.sin((2 * Math.PI * freqHz * i) / fs);
  let peak = 0;
  for (let i = 2; i < n; i++) {
    const w = Math.abs(centralDifference(y(i), y(i - 2), t(i), t(i - 2)));
    if (w > peak) peak = w;
  }
  return peak;
}

describe('3-point central difference and the published bias correction', () => {
  it('under-reports the peak by exactly 1 − sin(2πfT)/(2πfT) = 2.90 % at 2 Hz / 30 fps', () => {
    const truePeak = peakOmegaFor(2, 20);
    const measured = measuredPeak(2, 20, FS);
    const shortfall = 1 - measured / truePeak;
    expect(shortfall).toBeCloseTo(0.029, 3);
    expect(1 - centralDifferenceGain(2, T)).toBeCloseTo(0.029, 4);
  });

  it('has a correction factor of 1.0299 at 2 Hz / 30 fps', () => {
    expect(biasCorrectionFactor(2, T)).toBeCloseTo(1.0299, 4);
  });

  it('holds the same identity at 1.0 Hz (×1.0073), 1.5 Hz (×1.0166) and 2.5 Hz', () => {
    expect(biasCorrectionFactor(1.0, T)).toBeCloseTo(1.0073, 4);
    expect(biasCorrectionFactor(1.5, T)).toBeCloseTo(1.0166, 4);
    // 2.5 Hz: gain = sin(2π·2.5/30)/(2π·2.5/30)
    const x = (2 * Math.PI * 2.5) / 30;
    expect(biasCorrectionFactor(2.5, T)).toBeCloseTo(1 / (Math.sin(x) / x), 8);
  });

  it('recovers the true peak to within 1 % once corrected, at 1.0 / 1.5 / 2.0 Hz', () => {
    for (const f of [1.0, 1.5, 2.0]) {
      const truePeak = peakOmegaFor(f, 20);
      const corrected = correctPeak(measuredPeak(f, 20, FS), f, T);
      expect(Math.abs(corrected - truePeak) / truePeak).toBeLessThan(0.01);
    }
  });

  it('uses dt AS MEASURED, not assumed 33.3 ms — a doubled interval does not double ω', () => {
    // Two samples 66.7 ms apart spanning the same angular change must yield the
    // SAME ω as an evenly-sampled pair spanning that change, not twice it.
    const evenly = centralDifference(10, 0, 66.7, 0);
    const doubled = centralDifference(10, 0, 133.4, 0);
    expect(evenly).toBeCloseTo(10 / 0.0667, 6);
    expect(doubled).toBeCloseTo(evenly / 2, 6);
  });

  it('applies the correction once, not twice', () => {
    const once = correctPeak(100, 2, T);
    const twice = correctPeak(once, 2, T);
    expect(once).toBeCloseTo(100 * 1.0299, 2);
    expect(twice).not.toBeCloseTo(once, 2);
  });
});
