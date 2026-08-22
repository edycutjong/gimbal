import { describe, it, expect } from 'vitest';
import { segmentSeries, type SegmenterSample } from '../src/dsp/segment.ts';
import { deadbandDegPerSec, INSTRUMENT_LIMITS } from '../src/dsp/limits.ts';
import { oscillation, testCard } from './helpers.ts';

const card = testCard();
const deadband = deadbandDegPerSec(card.peakVelocityFloor.value);
const opts = { deadbandDegPerSec: deadband, fHat: 2.0 };

describe('cycle segmentation', () => {
  it('yields exactly 20 cycles for a synthesised 2 Hz series covering 20 oscillations', () => {
    const s = oscillation({ freqHz: 2, amplitudeDeg: 20, fs: 30, cycles: 20 });
    expect(segmentSeries(s, opts).length).toBe(20);
  });

  it('does not count a single sweep as a cycle', () => {
    // A quarter-second at 2 Hz is one sweep: one sign change, no complete cycle.
    const s = oscillation({ freqHz: 2, amplitudeDeg: 20, fs: 30, durationSec: 0.3 });
    expect(segmentSeries(s, opts).length).toBe(0);
  });

  it('suppresses micro sign-flips below deadbandFraction × card.peakVelocityFloor', () => {
    // Jitter well inside the deadband, riding on a clean 2 Hz oscillation.
    const clean = oscillation({ freqHz: 2, amplitudeDeg: 20, fs: 30, cycles: 20 });
    const noisy: SegmenterSample[] = clean.map((s, i) => ({
      ...s,
      omega: s.omega + (i % 2 === 0 ? 1 : -1) * deadband * 0.9,
    }));
    expect(segmentSeries(noisy, opts).length).toBe(segmentSeries(clean, opts).length);
    // And the deadband really is a fraction of a CARD field, not an absolute figure.
    expect(deadband).toBeCloseTo(INSTRUMENT_LIMITS.deadbandFraction * card.peakVelocityFloor.value, 10);
  });

  it('ends the cycle on a 1 s stall rather than producing one 1.5 s cycle', () => {
    const before = oscillation({ freqHz: 2, amplitudeDeg: 20, fs: 30, cycles: 4 });
    const lastT = (before[before.length - 1] as SegmenterSample).tMs;
    const after = oscillation({ freqHz: 2, amplitudeDeg: 20, fs: 30, cycles: 4 }).map((s) => ({
      ...s,
      tMs: s.tMs + lastT + 1500,
    }));
    const cycles = segmentSeries([...before, ...after], opts);
    for (const c of cycles) expect(c.periodMs).toBeLessThan(1000);
  });

  it('segments asymmetric sweeps', () => {
    const s = oscillation({ freqHz: 2, amplitudeDeg: 20, fs: 30, cycles: 10 }).map((x) => ({
      ...x,
      omega: x.omega > 0 ? x.omega : x.omega * 0.6,
    }));
    expect(segmentSeries(s, opts).length).toBeGreaterThanOrEqual(9);
  });

  it('does not create phantom cycles from dropped frames', () => {
    const clean = oscillation({ freqHz: 2, amplitudeDeg: 20, fs: 30, cycles: 20 });
    const dropped = clean.filter((_, i) => i % 7 !== 0);
    expect(segmentSeries(dropped, opts).length).toBeLessThanOrEqual(segmentSeries(clean, opts).length);
  });

  it('computes cycle period from camera timestamps, not from an assumed frame rate', () => {
    // Same motion, timestamps stretched 10 %: every period must stretch with them.
    const base = oscillation({ freqHz: 2, amplitudeDeg: 20, fs: 30, cycles: 10 });
    const stretched = base.map((s) => ({ ...s, tMs: s.tMs * 1.1 }));
    const a = segmentSeries(base, opts);
    const b = segmentSeries(stretched, opts);
    expect(a.length).toBe(b.length);
    expect((b[0] as { periodMs: number }).periodMs / (a[0] as { periodMs: number }).periodMs).toBeCloseTo(1.1, 5);
  });
});
