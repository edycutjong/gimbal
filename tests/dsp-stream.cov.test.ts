import { describe, it, expect } from 'vitest';
import { VelocityStream } from '../src/dsp/stream.ts';
import type { VelocitySample } from '../src/dsp/stream.ts';

const FS = 30;
/** Frame timestamp in ms for frame `i` at `FS` fps. */
const tAt = (i: number): number => (i * 1000) / FS;

/**
 * Drives a stream over `n` frames of an analytic yaw(t) and returns every
 * emission together with the frame index that produced it — the index is what
 * makes the LATENCY claim checkable rather than merely stated.
 */
function run(
  stream: VelocityStream,
  n: number,
  yaw: (tSec: number, i: number) => number,
): { i: number; s: VelocitySample }[] {
  const out: { i: number; s: VelocitySample }[] = [];
  for (let i = 0; i < n; i++) {
    const s = stream.push(tAt(i), yaw(i / FS, i));
    if (s !== null) out.push({ i, s });
  }
  return out;
}

describe('VelocityStream — latency is computed from the window, not asserted', () => {
  it('costs (window-1)/2 smoothing frames + 1 differentiation frame', () => {
    expect(new VelocityStream().latencyFrames).toBe(3);
    expect(new VelocityStream(5).latencyFrames).toBe(3);
    expect(new VelocityStream(7).latencyFrames).toBe(4);
    expect(new VelocityStream(9).latencyFrames).toBe(5);
  });

  it('reports the default window when constructed with no argument', () => {
    // The default is DEFAULT_SG_WINDOW = 5, so first emission lands on push 7.
    const stream = new VelocityStream();
    const emissions = run(stream, 7, (t) => 10 * t);
    expect(emissions).toHaveLength(1);
    expect(emissions[0]?.i).toBe(6);
  });

  it('the emitted tMs really is latencyFrames behind the frame that produced it', () => {
    for (const window of [5, 7, 9]) {
      const stream = new VelocityStream(window);
      const emissions = run(stream, 30, (t) => 20 * t);
      const expectedLag = ((window - 1) >> 1) + 1;
      expect(stream.latencyFrames).toBe(expectedLag);
      expect(emissions.length).toBeGreaterThan(0);
      for (const { i, s } of emissions) {
        expect(s.tMs).toBeCloseTo(tAt(i - expectedLag), 9);
      }
      // First emission arrives exactly when the pipeline can no longer stall.
      expect(emissions[0]?.i).toBe(window + 1);
    }
  });
});

describe('VelocityStream — warm-up returns null, and only null', () => {
  it('withholds every frame until both buffers are full (window 5 → 7 frames)', () => {
    const stream = new VelocityStream(5);
    const results: (VelocitySample | null)[] = [];
    for (let i = 0; i < 8; i++) results.push(stream.push(tAt(i), i));
    // Frames 0..3: raw buffer short. Frames 4..5: smooth buffer short.
    expect(results.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(results[6]).not.toBeNull();
    expect(results[7]).not.toBeNull();
  });

  it('withholds 9 frames at window 7 and 11 at window 9', () => {
    for (const window of [7, 9]) {
      const stream = new VelocityStream(window);
      const nulls: number[] = [];
      let firstEmission = -1;
      for (let i = 0; i < window + 4; i++) {
        const s = stream.push(tAt(i), i);
        if (s === null) nulls.push(i);
        else if (firstEmission < 0) firstEmission = i;
      }
      expect(nulls).toHaveLength(window + 1);
      expect(firstEmission).toBe(window + 1);
    }
  });
});

describe('VelocityStream — the smooth→differentiate path is exact on polynomials', () => {
  it('recovers a constant slope exactly: quadratic SG preserves a linear ramp', () => {
    const slope = 240; // °/s
    const emissions = run(new VelocityStream(5), 40, (t) => slope * t);
    expect(emissions.length).toBe(34);
    for (const { s } of emissions) {
      expect(s.omega).toBeCloseTo(slope, 6);
      expect(s.smoothedYaw).toBeCloseTo(slope * (s.tMs / 1000), 6);
      // Constant ω ⇒ zero acceleration, including the very first sample where
      // there is no previous ω to difference against.
      expect(s.accel).toBeCloseTo(0, 4);
    }
  });

  it('recovers a constant acceleration exactly: ω = a·t and dω/dt = a', () => {
    const a = 100; // °/s²
    const emissions = run(new VelocityStream(5), 40, (t) => 0.5 * a * t * t);
    expect(emissions.length).toBe(34);

    const first = emissions[0]?.s as VelocitySample;
    expect(first.omega).toBeCloseTo(a * (first.tMs / 1000), 6);
    // No previous ω yet, so accel is reported as 0 rather than as NaN.
    expect(first.accel).toBe(0);

    for (const { s } of emissions.slice(1)) {
      expect(s.omega).toBeCloseTo(a * (s.tMs / 1000), 6);
      expect(s.accel).toBeCloseTo(a, 4);
      expect(s.smoothedYaw).toBeCloseTo(0.5 * a * (s.tMs / 1000) ** 2, 6);
    }
  });

  it('holds the same exactness at window 7 and 9', () => {
    const a = 60;
    for (const window of [7, 9]) {
      const emissions = run(new VelocityStream(window), 40, (t) => 0.5 * a * t * t);
      for (const { s } of emissions.slice(1)) {
        expect(s.omega).toBeCloseTo(a * (s.tMs / 1000), 6);
        expect(s.accel).toBeCloseTo(a, 4);
      }
    }
  });
});

describe('VelocityStream — buffers stay bounded, so a long run does not drift', () => {
  it('emits one sample per frame forever after warm-up, with stable values', () => {
    const slope = 180;
    const stream = new VelocityStream(5);
    const emissions = run(stream, 600, (t) => slope * t);
    expect(emissions).toHaveLength(600 - 6);
    const last = emissions[emissions.length - 1]?.s as VelocitySample;
    expect(last.omega).toBeCloseTo(slope, 6);
    expect(last.tMs).toBeCloseTo(tAt(599 - 3), 9);
  });
});

describe('VelocityStream — a non-advancing timestamp cannot manufacture acceleration', () => {
  it('reports accel 0 when the centre timestamp does not move forward', () => {
    // Frame 4 carries the same camera timestamp as frame 3 — a duplicated
    // frame. Two emissions then attribute themselves to the same instant, and
    // dividing by that zero interval would be a divide-by-zero blow-up.
    const times = [0, 10, 20, 30, 30, 50, 60, 70];
    const yaws = [0, 1, 4, 9, 16, 25, 36, 49];
    const stream = new VelocityStream(5);
    const emitted: VelocitySample[] = [];
    for (let i = 0; i < times.length; i++) {
      const s = stream.push(times[i] as number, yaws[i] as number);
      if (s !== null) emitted.push(s);
    }
    expect(emitted).toHaveLength(2);

    const [a, b] = emitted as [VelocitySample, VelocitySample];
    // Quadratic SG reproduces a quadratic exactly, so these are closed form:
    // ω = (16-4)/0.010 s and (25-9)/0.020 s.
    expect(a.tMs).toBe(30);
    expect(a.omega).toBeCloseTo(1200, 6);
    expect(a.accel).toBe(0);

    expect(b.tMs).toBe(30);
    expect(b.omega).toBeCloseTo(800, 6);
    // ω genuinely changed by -400 °/s, so a naive difference would have been
    // non-zero (and infinite once divided by dt = 0). The guard reports 0.
    expect(b.omega).not.toBeCloseTo(a.omega, 6);
    expect(b.accel).toBe(0);
    expect(Number.isFinite(b.accel)).toBe(true);
  });

  it('resumes reporting acceleration once the timestamp advances again', () => {
    const times = [0, 10, 20, 30, 30, 50, 60, 70, 80, 90];
    const stream = new VelocityStream(5);
    const emitted: VelocitySample[] = [];
    for (let i = 0; i < times.length; i++) {
      const s = stream.push(times[i] as number, i * i);
      if (s !== null) emitted.push(s);
    }
    expect(emitted).toHaveLength(4);
    expect(emitted[1]?.accel).toBe(0); // stalled timestamp
    // t moves from 30 → 50 → 60, so the next two carry real acceleration.
    expect(emitted[2]?.tMs).toBe(50);
    expect(emitted[2]?.accel).not.toBe(0);
    expect(Number.isFinite(emitted[2]?.accel as number)).toBe(true);
  });
});

describe('VelocityStream — reset()', () => {
  it('clears both buffers: the stream warms up again from zero', () => {
    const stream = new VelocityStream(5);
    const before = run(stream, 20, (t) => 200 * t);
    expect(before.length).toBeGreaterThan(0);

    stream.reset();

    const results: (VelocitySample | null)[] = [];
    for (let i = 100; i < 107; i++) results.push(stream.push(tAt(i), 200 * (i / FS)));
    expect(results.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(results[6]).not.toBeNull();
  });

  it('clears the ω history too — the first sample after reset has accel 0', () => {
    const a = 300;
    const stream = new VelocityStream(5);
    const before = run(stream, 20, (t) => 0.5 * a * t * t);
    // Before the reset the stream was reporting a real, non-zero acceleration.
    expect((before[before.length - 1]?.s as VelocitySample).accel).toBeCloseTo(a, 4);

    stream.reset();

    // Restart on a ramp with a very different ω. If lastOmega had survived the
    // reset, this first sample would carry a large bogus acceleration.
    const after: VelocitySample[] = [];
    for (let i = 0; i < 7; i++) {
      const s = stream.push(tAt(i), 1000 * (i / FS));
      if (s !== null) after.push(s);
    }
    expect(after).toHaveLength(1);
    expect(after[0]?.omega).toBeCloseTo(1000, 6);
    expect(after[0]?.accel).toBe(0);
  });

  it('is safe to call on a never-pushed stream', () => {
    const stream = new VelocityStream();
    stream.reset();
    stream.reset();
    expect(stream.push(0, 0)).toBeNull();
    expect(stream.latencyFrames).toBe(3);
  });
});

describe('VelocityStream — unsupported windows fail loudly at the first full buffer', () => {
  it('propagates the Savitzky–Golay window error rather than silently mis-smoothing', () => {
    const stream = new VelocityStream(6);
    expect(stream.push(tAt(0), 0)).toBeNull();
    expect(stream.push(tAt(1), 1)).toBeNull();
    expect(stream.push(tAt(2), 2)).toBeNull();
    expect(stream.push(tAt(3), 3)).toBeNull();
    expect(stream.push(tAt(4), 4)).toBeNull();
    expect(() => stream.push(tAt(5), 5)).toThrow(/unsupported Savitzky-Golay window: 6/);
  });
});
