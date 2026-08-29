import { describe, it, expect } from 'vitest';
import {
  centralDifference,
  centralDifferenceGain,
  biasCorrectionFactor,
  correctPeak,
  peakOmegaFor,
  peakAccelFor,
  median,
} from '../src/dsp/velocity.ts';
import { REFUSAL_REASONS, ALL_OUTCOMES } from '../src/dsp/types.ts';
import type { CycleOutcome } from '../src/dsp/types.ts';

const FS = 30;
const T = 1 / FS;

/** The closed form the module claims: sin(2πfT)/(2πfT), computed independently here. */
function analyticGain(fHz: number, tSec: number): number {
  const x = 2 * Math.PI * fHz * tSec;
  return Math.sin(x) / x;
}

describe('centralDifference — measured intervals, and the guard on non-positive dt', () => {
  it('divides the angular change by the MEASURED interval in seconds', () => {
    // 12° over exactly 40 ms is 300 °/s, whatever the nominal frame rate claims.
    expect(centralDifference(12, 0, 140, 100)).toBeCloseTo(300, 12);
    // Sign is carried: a decreasing yaw is a negative ω.
    expect(centralDifference(0, 12, 140, 100)).toBeCloseTo(-300, 12);
  });

  it('returns NaN when dt is zero — two samples stamped at the same instant', () => {
    expect(centralDifference(5, 0, 100, 100)).toBeNaN();
  });

  it('returns NaN when dt is negative — timestamps arriving out of order', () => {
    expect(centralDifference(5, 0, 100, 133.3)).toBeNaN();
  });

  it('returns NaN when a timestamp is itself NaN (the !(dt > 0) guard, not dt < 0)', () => {
    // `dtSec > 0` is false for NaN, so the guard catches it; a bare `dt <= 0`
    // check would not, and the caller would get NaN out of the division anyway.
    expect(centralDifference(5, 0, Number.NaN, 100)).toBeNaN();
  });
});

describe('centralDifferenceGain — the analytic attenuation', () => {
  it('matches sin(x)/x at 1.0, 1.5, 2.0 and 3.0 Hz on a 30 fps clock', () => {
    for (const f of [1.0, 1.5, 2.0, 3.0]) {
      expect(centralDifferenceGain(f, T)).toBeCloseTo(analyticGain(f, T), 12);
    }
  });

  it('reproduces the four gains published in the module header', () => {
    expect(centralDifferenceGain(1.0, T)).toBeCloseTo(0.9927, 4);
    expect(centralDifferenceGain(1.5, T)).toBeCloseTo(0.9836, 4);
    expect(centralDifferenceGain(2.0, T)).toBeCloseTo(0.971, 4);
    expect(centralDifferenceGain(3.0, T)).toBeCloseTo(0.9355, 4);
  });

  it('is exactly 1 at DC (f = 0) — the x === 0 short circuit, since sin(0)/0 is NaN', () => {
    expect(centralDifferenceGain(0, T)).toBe(1);
  });

  it('is exactly 1 for a zero interval — the same short circuit from the other factor', () => {
    expect(centralDifferenceGain(2, 0)).toBe(1);
  });

  it('is blind at Nyquist: f·T = 1/2 puts x at π, where sin(x)/x is numerically zero', () => {
    // 15 Hz on a 30 fps clock. The two samples of a 3-point difference land on
    // identical phase, so the difference — and the gain — collapse.
    const g = centralDifferenceGain(15, T);
    expect(Math.abs(g)).toBeLessThan(1e-9);
  });

  it('goes NEGATIVE past Nyquist, where the difference reports the wrong sign', () => {
    // f·T = 0.75 → x = 3π/2 → sin(x)/x = -1/(3π/2) ≈ -0.2122.
    expect(centralDifferenceGain(0.75, 1)).toBeCloseTo(-2 / (3 * Math.PI), 12);
  });
});

describe('biasCorrectionFactor — the reciprocal, and its singularity', () => {
  it('is 1/gain wherever the gain is usable', () => {
    for (const f of [1.0, 1.5, 2.0, 2.5, 3.0]) {
      expect(biasCorrectionFactor(f, T)).toBeCloseTo(1 / analyticGain(f, T), 10);
    }
  });

  it('reproduces the published factors ×1.0073, ×1.0166, ×1.0299, ×1.0690', () => {
    expect(biasCorrectionFactor(1.0, T)).toBeCloseTo(1.0073, 4);
    expect(biasCorrectionFactor(1.5, T)).toBeCloseTo(1.0166, 4);
    expect(biasCorrectionFactor(2.0, T)).toBeCloseTo(1.0299, 4);
    expect(biasCorrectionFactor(3.0, T)).toBeCloseTo(1.069, 4);
  });

  it('is exactly 1 at DC — nothing to correct when the gain is 1', () => {
    expect(biasCorrectionFactor(0, T)).toBe(1);
  });

  it('refuses (NaN) at Nyquist rather than returning an astronomical multiplier', () => {
    // 1/g at f·T = 1/2 would be ~1e16. Returning NaN makes the caller's own
    // guard fire instead of silently inflating a peak by sixteen orders.
    expect(biasCorrectionFactor(15, T)).toBeNaN();
  });

  it('refuses on the NEGATIVE side of the singularity too — |g|, not g', () => {
    // f·T = 1 → x = 2π → sin(2π)/2π ≈ -3.9e-17: tiny but negative.
    const g = centralDifferenceGain(1, 1);
    expect(g).toBeLessThan(0);
    expect(Math.abs(g)).toBeLessThan(1e-9);
    expect(biasCorrectionFactor(1, 1)).toBeNaN();
  });
});

describe('correctPeak — applied once, and its pass-through at the singularity', () => {
  it('divides the raw peak by the gain', () => {
    expect(correctPeak(100, 2, T)).toBeCloseTo(100 / analyticGain(2, T), 10);
    expect(correctPeak(100, 2, T)).toBeCloseTo(102.99, 2);
  });

  it('recovers ω = 2πfA from a sampled sinusoid to within 0.01 % at 1.5 Hz', () => {
    const f = 1.5;
    const amp = 20;
    const y = (i: number) => amp * Math.sin((2 * Math.PI * f * i) / FS);
    const t = (i: number) => (i * 1000) / FS;
    let rawPeak = 0;
    // Four full cycles: the sample grid straddles the true peak closely enough
    // that the residual grid error is far below the 1.66 % bias being corrected.
    for (let i = 2; i <= Math.ceil((FS * 4) / f); i++) {
      const w = Math.abs(centralDifference(y(i), y(i - 2), t(i), t(i - 2)));
      if (w > rawPeak) rawPeak = w;
    }
    const truePeak = peakOmegaFor(f, amp);
    expect(1 - rawPeak / truePeak).toBeCloseTo(1 - analyticGain(f, T), 3);
    expect(Math.abs(correctPeak(rawPeak, f, T) - truePeak) / truePeak).toBeLessThan(1e-4);
  });

  it('is the identity at DC, where the gain is exactly 1', () => {
    expect(correctPeak(87.5, 0, T)).toBe(87.5);
  });

  it('returns the RAW peak unchanged at the singularity, never a divide-by-zero blowup', () => {
    // Contrast with biasCorrectionFactor, which returns NaN: correctPeak is on
    // the scoring path, so it degrades to the uncorrected measurement.
    expect(correctPeak(42, 15, T)).toBe(42);
    expect(Number.isFinite(correctPeak(42, 15, T))).toBe(true);
  });

  it('returns the raw peak on the negative side of the singularity as well', () => {
    expect(correctPeak(42, 1, 1)).toBe(42);
  });
});

describe('peakOmegaFor / peakAccelFor — the sinusoidal kinematics', () => {
  it('gives ω = 2πfA', () => {
    expect(peakOmegaFor(2, 20)).toBeCloseTo(2 * Math.PI * 2 * 20, 12);
    expect(peakOmegaFor(2, 20)).toBeCloseTo(251.327412287, 8);
    expect(peakOmegaFor(0, 20)).toBe(0);
  });

  it('gives α = (2πf)²A', () => {
    expect(peakAccelFor(2, 20)).toBeCloseTo((2 * Math.PI * 2) ** 2 * 20, 9);
    expect(peakAccelFor(2, 20)).toBeCloseTo(3158.2734, 4);
    expect(peakAccelFor(1, 10)).toBeCloseTo(4 * Math.PI * Math.PI * 10, 10);
  });

  it('relates the two exactly: α = 2πf · ω, the derivative taken twice', () => {
    for (const f of [0.5, 1.0, 1.5, 2.0, 3.0]) {
      const amp = 17.5;
      expect(peakAccelFor(f, amp)).toBeCloseTo(2 * Math.PI * f * peakOmegaFor(f, amp), 8);
    }
  });

  it('scales quadratically in frequency and linearly in amplitude', () => {
    expect(peakAccelFor(4, 20) / peakAccelFor(2, 20)).toBeCloseTo(4, 10);
    expect(peakAccelFor(2, 40) / peakAccelFor(2, 20)).toBeCloseTo(2, 10);
    expect(peakAccelFor(0, 20)).toBe(0);
  });
});

describe('median — the per-cycle frame interval', () => {
  it('returns NaN for an empty series', () => {
    expect(median([])).toBeNaN();
    expect(median(new Float64Array(0))).toBeNaN();
  });

  it('returns the middle element for an odd count, regardless of input order', () => {
    expect(median([33.4, 33.3, 33.2])).toBe(33.3);
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5, 3, 7])).toBe(5);
  });

  it('averages the two middle elements for an even count', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([33.3, 66.6])).toBeCloseTo(49.95, 10);
  });

  it('sorts NUMERICALLY, not lexicographically — the default sort would give 100', () => {
    // ['9','10','100'].sort() puts 100 in the middle. The comparator prevents it.
    expect(median([9, 10, 100])).toBe(10);
  });

  it('accepts a Float64Array and does not mutate the caller series', () => {
    const raw = new Float64Array([50, 16.7, 33.3, 33.4, 33.2]);
    expect(median(raw)).toBeCloseTo(33.3, 10);
    expect(Array.from(raw)).toEqual([50, 16.7, 33.3, 33.4, 33.2]);
  });

  it('is robust to a dropped-frame outlier that would wreck the mean', () => {
    // Nine nominal 30 fps intervals plus one 500 ms stall. Mean ≈ 80 ms
    // (12.5 fps); the median still reports the real 33.3 ms cadence.
    const intervals = [33.3, 33.3, 33.4, 33.3, 33.2, 33.3, 33.4, 33.3, 33.3, 500];
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    expect(mean).toBeGreaterThan(79);
    expect(median(intervals)).toBeCloseTo(33.3, 10);
  });

  it('feeds correctPeak: a stalled camera changes the correction it produces', () => {
    const nominal = median([33.3, 33.3, 33.4]) / 1000;
    const stalled = median([66.6, 66.7, 66.6]) / 1000;
    expect(nominal).toBeCloseTo(0.0333, 10);
    expect(biasCorrectionFactor(2, nominal)).toBeCloseTo(1 / analyticGain(2, nominal), 12);
    expect(biasCorrectionFactor(2, nominal)).toBeCloseTo(1.0299, 3);
    // Half the frame rate quadruples the shortfall to leading order, since
    // 1 − sin(x)/x = x²/6 − x⁴/120 + … . The quartic term pulls the measured
    // ratio just under 4; assert the analytic value, not the leading term.
    const nominalShortfall = 1 - centralDifferenceGain(2, nominal);
    const stalledShortfall = 1 - centralDifferenceGain(2, stalled);
    const ratio = stalledShortfall / nominalShortfall;
    expect(ratio).toBeCloseTo((1 - analyticGain(2, stalled)) / (1 - analyticGain(2, nominal)), 12);
    expect(ratio).toBeLessThan(4);
    expect(ratio).toBeGreaterThan(3.85);
  });
});

describe('CycleOutcome runtime tables', () => {
  it('lists exactly the five refusal reasons', () => {
    expect(REFUSAL_REASONS).toEqual(['too-slow', 'too-fast', 'off-cadence', 'low-confidence', 'face-lost']);
    expect(REFUSAL_REASONS).toHaveLength(5);
  });

  it('makes ALL_OUTCOMES the six outcomes, with `ok` first and the refusals after', () => {
    expect(ALL_OUTCOMES).toEqual(['ok', 'too-slow', 'too-fast', 'off-cadence', 'low-confidence', 'face-lost']);
    expect(ALL_OUTCOMES).toHaveLength(6);
    expect(ALL_OUTCOMES[0]).toBe('ok');
    expect(ALL_OUTCOMES.slice(1)).toEqual([...REFUSAL_REASONS]);
  });

  it('has no duplicates, so a per-outcome tally can key off it directly', () => {
    expect(new Set(ALL_OUTCOMES).size).toBe(ALL_OUTCOMES.length);
    expect(new Set(REFUSAL_REASONS).size).toBe(REFUSAL_REASONS.length);
  });

  it('treats every non-`ok` outcome as a refusal — the tables partition the type', () => {
    const declared: CycleOutcome[] = [
      'ok',
      'too-slow',
      'too-fast',
      'off-cadence',
      'low-confidence',
      'face-lost',
    ];
    // Both directions: nothing declared is missing from the tables, and nothing
    // in the tables is undeclared.
    expect([...ALL_OUTCOMES].sort()).toEqual([...declared].sort());
    for (const o of declared) {
      expect(REFUSAL_REASONS.includes(o)).toBe(o !== 'ok');
    }
  });

  it('does not put `ok` in the refusal list, and ALL_OUTCOMES is a distinct array', () => {
    expect(REFUSAL_REASONS.includes('ok')).toBe(false);
    expect(ALL_OUTCOMES).not.toBe(REFUSAL_REASONS);
  });
});
