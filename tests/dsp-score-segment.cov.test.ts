import { describe, it, expect } from 'vitest';
import { scoreCycle, REASON_PRECEDENCE } from '../src/dsp/score.ts';
import {
  CycleSegmenter,
  segmentSeries,
  DEFAULT_STALL_MS,
  type SegmenterSample,
  type SegmenterOptions,
} from '../src/dsp/segment.ts';
import { INSTRUMENT_LIMITS, deadbandDegPerSec, type InstrumentLimits } from '../src/dsp/limits.ts';
import { correctPeak } from '../src/dsp/velocity.ts';
import type { Cycle } from '../src/dsp/types.ts';
import { testCard, testCycle } from './helpers.ts';

const card = testCard(); // band 1.7–2.3 Hz, floor 150, ceiling 350 °/s
const DEADBAND = deadbandDegPerSec(card.peakVelocityFloor.value); // 0.15 × 150 = 22.5 °/s

/** One frame. Defaults are deliberately well inside every quality gate. */
const frame = (tMs: number, omega: number, quality = 0.95, facePresent = true): SegmenterSample => ({
  tMs,
  omega,
  quality,
  facePresent,
});

/**
 * A hand-built alternating series with analytically known boundaries.
 *
 * With a deadband of 22.5 °/s every |ω| = 200 sample qualifies, so each entry is
 * a sign change and the boundaries fall exactly on the listed timestamps:
 *
 *   frame 0        → arms `lastSign`, never credited (partial sweep)
 *   frame 1        → opens the first cycle at t₁
 *   frame 2        → sweep 1 of 2
 *   frame 3        → sweep 2 of 2 → cycle [t₁, t₃], periodMs = t₃ − t₁
 */
const alternating = (times: readonly number[], magnitude = 200): SegmenterSample[] =>
  times.map((t, i) => frame(t, i % 2 === 0 ? magnitude : -magnitude));

const baseOpts = (over: Partial<SegmenterOptions> = {}): SegmenterOptions => ({
  deadbandDegPerSec: DEADBAND,
  fHat: 2.0,
  ...over,
});

/**
 * White-box handle on the segmenter's two private helpers.
 *
 * `compact` and `buildCycle` each carry a guard that `push` can never falsify:
 * both call sites of `compact` run immediately after `cycleStart` is assigned a
 * boundary, and `buildCycle` only runs once two sweeps have closed, which
 * guarantees a span of at least three frames. The guards are still the thing
 * that keeps a degenerate span from producing a NaN dose, so they are tested by
 * invoking them directly rather than left as unexercised claims.
 */
interface SegmenterInternals {
  samples: SegmenterSample[];
  cycleStart: { tMs: number; index: number } | null;
  compact(keepFrom: number): void;
  buildCycle(start: { tMs: number; index: number }, end: { tMs: number; index: number }): Cycle;
}

const internals = (seg: CycleSegmenter): SegmenterInternals => seg as unknown as SegmenterInternals;

describe('scoreCycle — the low-confidence arithmetic gate (uncredited-by-default)', () => {
  it('refuses a cycle whose peak velocity is not a finite number', () => {
    for (const peakOmega of [NaN, Infinity, -Infinity]) {
      const r = scoreCycle(testCycle({ peakOmega }), card);
      expect(r.reason).toBe('low-confidence');
      expect(r.credited).toBe(false);
      expect(r.doseSeconds).toBe(0);
    }
  });

  it('refuses a cycle whose period is not a finite number', () => {
    for (const periodMs of [NaN, Infinity, -Infinity]) {
      const r = scoreCycle(testCycle({ periodMs }), card);
      expect(r.reason).toBe('low-confidence');
      expect(r.doseSeconds).toBe(0);
    }
  });

  it('refuses a zero or negative period rather than dividing by it', () => {
    // 1000/0 is Infinity and 1000/-500 is negative: both would sail past the
    // cadence comparison as a nonsense frequency. The gate stops them first.
    for (const periodMs of [0, -0.001, -500]) {
      const r = scoreCycle(testCycle({ periodMs }), card);
      expect(r.reason).toBe('low-confidence');
      expect(r.credited).toBe(false);
      expect(r.doseSeconds).toBe(0);
    }
  });

  it('ranks the arithmetic gate BELOW face-lost and saturation, and ABOVE any velocity verdict', () => {
    // peakOmega = NaN is simultaneously "not finite" and "not ≥ the floor".
    // The instrument condition must win, per REASON_PRECEDENCE.
    const nan = testCycle({ peakOmega: NaN });
    expect(scoreCycle(nan, card).reason).toBe('low-confidence');
    expect(scoreCycle({ ...nan, faceLost: true }, card).reason).toBe('face-lost');
    expect(REASON_PRECEDENCE.indexOf('low-confidence')).toBeLessThan(REASON_PRECEDENCE.indexOf('too-slow'));
  });

  it('reads every instrument limit from the limits argument, not from a captured constant', () => {
    const relaxed: InstrumentLimits = { ...INSTRUMENT_LIMITS, qFloor: 0, nMin: 1, maxCycleHz: 10 };
    const strict: InstrumentLimits = { ...INSTRUMENT_LIMITS, qFloor: 0.99, nMin: 100, maxCycleHz: 1 };

    const marginal = testCycle({ qMin: 0.2, sampleCount: 2 });
    expect(scoreCycle(marginal, card, relaxed).credited).toBe(true);
    expect(scoreCycle(marginal, card, strict).reason).toBe('low-confidence');

    // Same cycle, same card: only maxCycleHz differs.
    const fast = testCycle({ fHat: 2.5 });
    expect(scoreCycle(fast, card, relaxed).credited).toBe(true);
    expect(scoreCycle(fast, card, { ...relaxed, maxCycleHz: 2.4 }).reason).toBe('too-fast');
  });
});

describe('CycleSegmenter — live parameter updates', () => {
  it('setFHat moves the bias correction applied to subsequent cycles', () => {
    const times = [0, 100, 200, 300];
    const withDefault = segmentSeries(alternating(times), baseOpts({ fHat: 2.0 }));
    expect(withDefault.length).toBe(1);
    const only = withDefault[0] as { peakOmega: number; rawPeakOmega: number; fHat: number };
    expect(only.rawPeakOmega).toBe(200);
    // median frame interval over the cycle is 100 ms.
    expect(only.peakOmega).toBeCloseTo(correctPeak(200, 2.0, 0.1), 10);
    expect(only.fHat).toBe(2.0);

    const seg = new CycleSegmenter(baseOpts({ fHat: 2.0 }));
    seg.setFHat(1.0);
    let out = null as ReturnType<CycleSegmenter['push']>;
    for (const s of alternating(times)) {
      const c = seg.push(s);
      if (c) out = c;
    }
    expect(out).not.toBeNull();
    const moved = out as NonNullable<typeof out>;
    expect(moved.fHat).toBe(1.0);
    expect(moved.rawPeakOmega).toBe(200);
    expect(moved.peakOmega).toBeCloseTo(correctPeak(200, 1.0, 0.1), 10);
    // A lower f̂ means less central-difference attenuation, so less correction.
    expect(moved.peakOmega).toBeLessThan(only.peakOmega);
  });

  it('setDeadband re-scales hysteresis mid-stream — the same series then yields no cycle', () => {
    const times = [0, 100, 200, 300];
    const seg = new CycleSegmenter(baseOpts());
    seg.setDeadband(500); // above every |ω| in the series: nothing qualifies
    const emitted = alternating(times).map((s) => seg.push(s));
    expect(emitted.every((c) => c === null)).toBe(true);

    // Drop it back below the signal and the very same waveform segments again.
    seg.setDeadband(DEADBAND);
    const after = alternating([400, 500, 600, 700]).map((s) => seg.push(s)).filter((c) => c !== null);
    expect(after.length).toBe(1);
  });

  it('reset abandons the in-progress cycle, so no cycle straddles the reset', () => {
    const seg = new CycleSegmenter(baseOpts());
    // Three frames: the first cycle is open with one of its two sweeps closed.
    expect(seg.push(frame(0, 200))).toBeNull();
    expect(seg.push(frame(100, -200))).toBeNull();
    expect(seg.push(frame(200, 200))).toBeNull();

    seg.reset();

    // Post-reset the segmenter is armed from scratch: the next frame is again a
    // partial sweep of unknown extent, so the first cycle closes at t = 500.
    expect(seg.push(frame(300, -200))).toBeNull();
    expect(seg.push(frame(400, 200))).toBeNull();
    const c = seg.push(frame(500, -200));
    expect(c).toBeNull(); // 400 opened the cycle; 500 is only sweep 1 of 2
    const closed = seg.push(frame(600, 200));
    expect(closed).not.toBeNull();
    expect((closed as { tStartMs: number }).tStartMs).toBe(400);
    expect((closed as { periodMs: number }).periodMs).toBe(200);
  });
});

describe('CycleSegmenter — stall handling', () => {
  it('honours an explicit stallMs in place of DEFAULT_STALL_MS', () => {
    expect(DEFAULT_STALL_MS).toBe(1000);
    // A 200 ms gap: under the 1000 ms default, over an explicit 50 ms stall.
    const times = [0, 100, 200, 400, 500, 600];
    const series = alternating(times);

    const kept = segmentSeries(series, baseOpts());
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.some((c) => c.periodMs > 200)).toBe(true);

    const dropped = segmentSeries(series, baseOpts({ stallMs: 50 }));
    for (const c of dropped) expect(c.periodMs).toBeLessThanOrEqual(200);
  });

  it('re-opens a cycle on the first frame after a stall wiped the buffer', () => {
    // The stall drop clears `samples` AFTER the stalling frame was pushed, so
    // the frame that follows sits at index 0 and the retained-window compaction
    // has nothing to trim. This is the keepFrom <= 0 path.
    const seg = new CycleSegmenter(baseOpts({ stallMs: 100 }));
    expect(seg.push(frame(0, 200))).toBeNull(); // arms lastSign = +1
    expect(seg.push(frame(5000, -200))).toBeNull(); // stall → drop, then re-arms lastSign = -1
    expect(seg.push(frame(5100, 200))).toBeNull(); // sits at index 0; opens the cycle
    expect(seg.push(frame(5200, -200))).toBeNull(); // sweep 1
    const c = seg.push(frame(5300, 200)); // sweep 2 → cycle
    expect(c).not.toBeNull();
    expect((c as { tStartMs: number; tEndMs: number }).tStartMs).toBe(5100);
    expect((c as { tEndMs: number }).tEndMs).toBe(5300);
    expect((c as { sampleCount: number }).sampleCount).toBe(3);
  });
});

describe('CycleSegmenter — cycle statistics', () => {
  it('ignores a non-finite |ω| when tracking the raw peak, and never lets it open a sweep', () => {
    // ±Infinity clears the deadband on magnitude but fails the finiteness test,
    // so it is not a qualifying frame: it lands inside the span without
    // becoming a boundary, and it must not become the reported peak.
    const seg = new CycleSegmenter(baseOpts());
    expect(seg.push(frame(0, 200))).toBeNull();
    expect(seg.push(frame(100, -200))).toBeNull(); // opens the cycle
    expect(seg.push(frame(150, Infinity))).toBeNull(); // not a boundary
    expect(seg.push(frame(160, NaN))).toBeNull(); // magnitude fails the deadband
    expect(seg.push(frame(200, 300))).toBeNull(); // sweep 1
    const c = seg.push(frame(300, -250)) as {
      rawPeakOmega: number;
      peakOmega: number;
      periodMs: number;
      sampleCount: number;
    };
    expect(c).not.toBeNull();
    expect(c.rawPeakOmega).toBe(300);
    expect(Number.isFinite(c.peakOmega)).toBe(true);
    expect(c.periodMs).toBe(200);
    expect(c.sampleCount).toBe(5); // both non-qualifying frames stay in the span
  });

  it('reports qMin as the worst frame and qMean as the arithmetic mean, and flags any face-lost frame', () => {
    const seg = new CycleSegmenter(baseOpts());
    expect(seg.push(frame(0, 200))).toBeNull();
    expect(seg.push(frame(100, -200, 0.9))).toBeNull(); // opens the cycle
    expect(seg.push(frame(200, 200, 0.4, false))).toBeNull(); // worst quality, face lost
    const c = seg.push(frame(300, -200, 0.8)) as {
      qMin: number;
      qMean: number;
      faceLost: boolean;
    };
    expect(c).not.toBeNull();
    expect(c.qMin).toBeCloseTo(0.4, 12);
    expect(c.qMean).toBeCloseTo((0.9 + 0.4 + 0.8) / 3, 12);
    expect(c.faceLost).toBe(true);
  });

  it('leaves qMin at 1 and faceLost false when every frame is perfect', () => {
    const [c] = segmentSeries(
      [frame(0, 200, 1), frame(100, -200, 1), frame(200, 200, 1), frame(300, -200, 1)],
      baseOpts(),
    );
    expect(c).toBeDefined();
    const good = c as { qMin: number; qMean: number; faceLost: boolean };
    expect(good.qMin).toBe(1);
    expect(good.qMean).toBe(1);
    expect(good.faceLost).toBe(false);
  });

  it('skips the bias correction when f̂ is not positive', () => {
    const [c] = segmentSeries(alternating([0, 100, 200, 300]), baseOpts({ fHat: 0 }));
    const raw = c as { peakOmega: number; rawPeakOmega: number; fHat: number };
    expect(raw.fHat).toBe(0);
    // No estimate, no correction: the reported peak is exactly the measured one.
    expect(raw.peakOmega).toBe(200);
    expect(raw.rawPeakOmega).toBe(200);
  });

  it('skips the bias correction when the frame interval is not a finite number', () => {
    // Two frames carrying a NaN timestamp make every intra-cycle interval NaN,
    // so the median interval is NaN and there is no T to correct against.
    const seg = new CycleSegmenter(baseOpts({ fHat: 2.0 }));
    expect(seg.push(frame(0, 200))).toBeNull();
    expect(seg.push(frame(100, -200))).toBeNull(); // opens the cycle
    expect(seg.push(frame(NaN, 200))).toBeNull(); // sweep 1
    const c = seg.push(frame(NaN, -200)) as { peakOmega: number; rawPeakOmega: number };
    expect(c).not.toBeNull();
    expect(c.rawPeakOmega).toBe(200);
    expect(c.peakOmega).toBe(200); // uncorrected, not NaN
  });

  it('flags saturation against the limits it was given, refused rather than clipped downstream', () => {
    const tiny: InstrumentLimits = { ...INSTRUMENT_LIMITS, quantisationMaxDegPerSec: 10 };
    const [hot] = segmentSeries(alternating([0, 100, 200, 300]), baseOpts({ limits: tiny }));
    expect(hot).toBeDefined();
    expect((hot as { saturated: boolean }).saturated).toBe(true);
    expect(scoreCycle(hot as Parameters<typeof scoreCycle>[0], card).reason).toBe('low-confidence');

    const [cool] = segmentSeries(alternating([0, 100, 200, 300]), baseOpts());
    expect((cool as { saturated: boolean }).saturated).toBe(false);
  });

  it('drops a same-sign frame without closing a sweep', () => {
    // Two consecutive positive frames: the second is qualifying but is not a
    // sign change, so it is retained in the span and closes nothing.
    const [c] = segmentSeries(
      [
        frame(0, -200),
        frame(100, 200), // opens the cycle
        frame(150, 180), // same sign — no boundary
        frame(200, -200), // sweep 1
        frame(300, 200), // sweep 2
      ],
      baseOpts(),
    );
    expect(c).toBeDefined();
    const only = c as { tStartMs: number; tEndMs: number; sampleCount: number };
    expect(only.tStartMs).toBe(100);
    expect(only.tEndMs).toBe(300);
    expect(only.sampleCount).toBe(4);
  });
});

describe('CycleSegmenter — defensive guards `push` cannot reach', () => {
  it('compaction trims the retained window without touching a cycle that is not open', () => {
    const seg = new CycleSegmenter(baseOpts());
    const inner = internals(seg);
    inner.samples = [frame(0, 200), frame(100, -200), frame(200, 200)];
    inner.cycleStart = null;

    inner.compact(2);

    expect(inner.samples.length).toBe(1);
    expect((inner.samples[0] as SegmenterSample).tMs).toBe(200);
    // No open cycle means no index to rebase — and none is invented.
    expect(inner.cycleStart).toBeNull();
  });

  it('compaction is a no-op when the window already starts at the boundary', () => {
    const seg = new CycleSegmenter(baseOpts());
    const inner = internals(seg);
    const window = [frame(0, 200), frame(100, -200)];
    inner.samples = window;
    inner.cycleStart = { tMs: 0, index: 0 };

    inner.compact(0);

    expect(inner.samples).toBe(window); // same array: nothing was sliced
    expect(inner.cycleStart).toEqual({ tMs: 0, index: 0 });
  });

  it('an empty span yields a zeroed cycle with no NaN dose, which the gate then refuses', () => {
    const seg = new CycleSegmenter(baseOpts());
    const inner = internals(seg);
    inner.samples = [];

    const degenerate = inner.buildCycle({ tMs: 100, index: 0 }, { tMs: 100, index: -1 });

    expect(degenerate.sampleCount).toBe(0);
    expect(degenerate.periodMs).toBe(0);
    // No frames means no interval, so no bias correction is applied and the
    // means stay finite rather than becoming 0/0.
    expect(degenerate.qMean).toBe(0);
    expect(degenerate.peakOmega).toBe(0);
    expect(degenerate.rawPeakOmega).toBe(0);
    expect(degenerate.qMin).toBe(1);
    expect(degenerate.faceLost).toBe(false);
    expect(degenerate.saturated).toBe(false);
    expect(Number.isNaN(degenerate.qMean)).toBe(false);

    // And it is uncredited: zero samples is below every instrument floor.
    const r = scoreCycle(degenerate, card);
    expect(r.credited).toBe(false);
    expect(r.reason).toBe('low-confidence');
    expect(r.doseSeconds).toBe(0);
  });
});
