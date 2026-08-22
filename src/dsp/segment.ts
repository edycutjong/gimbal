import type { Cycle } from './types.ts';
import { INSTRUMENT_LIMITS, type InstrumentLimits } from './limits.ts';
import { correctPeak, median } from './velocity.ts';

/**
 * Cycle segmentation.
 *
 * A SWEEP is the interval between two consecutive sign changes of ω — one head
 * turn. A CYCLE is two sweeps: one full oscillation. The cycle is the credit
 * unit, because the prescription is written in frequency (oscillations per
 * second) and crediting half-oscillations would let a patient bank credit for a
 * one-way turn they never returned from.
 *
 * Zero-crossing detection is HYSTERETIC: a sign change only registers once |ω|
 * has exceeded a deadband expressed as a fraction of the card's peak-velocity
 * floor. Without hysteresis, near-zero jitter at the turnaround manufactures
 * dozens of phantom sweeps per second and inflates the dose — which attacks the
 * one number the whole product is about.
 */

export interface SegmenterSample {
  tMs: number;
  omega: number;
  quality: number;
  facePresent: boolean;
}

export interface SegmenterOptions {
  /** °/s. Scaled from the card by `deadbandDegPerSec`, never an absolute magic number. */
  deadbandDegPerSec: number;
  /** Hz — the current dominant-frequency estimate, used for the bias correction. */
  fHat: number;
  /** A gap this long with no qualifying motion abandons the in-progress cycle. */
  stallMs?: number;
  limits?: InstrumentLimits;
}

export const DEFAULT_STALL_MS = 1000;

interface Boundary {
  tMs: number;
  index: number;
}

/**
 * Streaming segmenter. Fed one frame at a time by the capture loop; emits a
 * `Cycle` at the moment the second sweep closes.
 */
export class CycleSegmenter {
  private samples: SegmenterSample[] = [];
  /** The boundary the in-progress cycle started at, or `null` before the first sign change. */
  private cycleStart: Boundary | null = null;
  /** Sweeps closed since `cycleStart`. Two sweeps make one cycle. */
  private sweepsSinceStart = 0;
  private lastSign: -1 | 0 | 1 = 0;
  private lastQualifyingTMs = NaN;

  constructor(private opts: SegmenterOptions) {}

  /** The dominant-frequency estimate can move between windows; the correction follows it. */
  setFHat(fHat: number): void {
    this.opts.fHat = fHat;
  }

  setDeadband(deadbandDegPerSec: number): void {
    this.opts.deadbandDegPerSec = deadbandDegPerSec;
  }

  reset(): void {
    this.dropInProgress();
  }

  /** Returns a completed cycle, or `null` if this frame did not close one. */
  push(sample: SegmenterSample): Cycle | null {
    const stallMs = this.opts.stallMs ?? DEFAULT_STALL_MS;
    this.samples.push(sample);

    const magnitude = Math.abs(sample.omega);
    const qualifies = magnitude > this.opts.deadbandDegPerSec && Number.isFinite(sample.omega);

    // A stall — the head stopped, or tracking dropped out — ends the in-progress
    // cycle rather than producing one long cycle spanning the gap.
    if (Number.isFinite(this.lastQualifyingTMs) && sample.tMs - this.lastQualifyingTMs > stallMs) {
      this.dropInProgress();
    }

    if (!qualifies) return null;
    this.lastQualifyingTMs = sample.tMs;

    const sign: -1 | 1 = sample.omega > 0 ? 1 : -1;
    if (this.lastSign === 0) {
      this.lastSign = sign;
      return null;
    }
    if (sign === this.lastSign) return null;

    // A sign change — one sweep just closed.
    this.lastSign = sign;
    const boundary: Boundary = { tMs: sample.tMs, index: this.samples.length - 1 };

    if (this.cycleStart === null) {
      // The first sign change opens the first cycle. Motion before it is a
      // partial sweep of unknown extent and is never credited.
      this.cycleStart = boundary;
      this.sweepsSinceStart = 0;
      this.compact(boundary.index);
      return null;
    }

    this.sweepsSinceStart += 1;
    if (this.sweepsSinceStart < 2) return null;

    // Two sweeps = one full oscillation. Cycles are NON-OVERLAPPING and share
    // their endpoints: the boundary that closes one opens the next.
    const cycle = this.buildCycle(this.cycleStart, boundary);
    this.cycleStart = boundary;
    this.sweepsSinceStart = 0;
    this.compact(boundary.index);
    return cycle;
  }

  private dropInProgress(): void {
    this.cycleStart = null;
    this.sweepsSinceStart = 0;
    this.lastSign = 0;
    this.samples = [];
    this.lastQualifyingTMs = NaN;
  }

  /** Retains only the samples the in-progress cycle can still need. */
  private compact(keepFrom: number): void {
    if (keepFrom <= 0) return;
    this.samples = this.samples.slice(keepFrom);
    if (this.cycleStart) this.cycleStart = { ...this.cycleStart, index: this.cycleStart.index - keepFrom };
  }

  private buildCycle(start: Boundary, end: Boundary): Cycle {
    const limits = this.opts.limits ?? INSTRUMENT_LIMITS;
    const span = this.samples.slice(start.index, end.index + 1);

    let rawPeak = 0;
    let qMin = 1;
    let qSum = 0;
    let faceLost = false;
    const intervals: number[] = [];

    for (let i = 0; i < span.length; i++) {
      const s = span[i] as SegmenterSample;
      const m = Math.abs(s.omega);
      if (Number.isFinite(m) && m > rawPeak) rawPeak = m;
      if (s.quality < qMin) qMin = s.quality;
      qSum += s.quality;
      if (!s.facePresent) faceLost = true;
      if (i > 0) intervals.push(s.tMs - (span[i - 1] as SegmenterSample).tMs);
    }

    const periodMs = end.tMs - start.tMs;
    const medianIntervalSec = intervals.length > 0 ? median(intervals) / 1000 : NaN;
    const fHat = this.opts.fHat;
    const peakOmega =
      Number.isFinite(medianIntervalSec) && fHat > 0 ? correctPeak(rawPeak, fHat, medianIntervalSec) : rawPeak;

    return {
      tStartMs: start.tMs,
      tEndMs: end.tMs,
      periodMs,
      peakOmega,
      rawPeakOmega: rawPeak,
      sampleCount: span.length,
      qMin,
      qMean: span.length > 0 ? qSum / span.length : 0,
      fHat,
      faceLost,
      saturated: peakOmega > limits.quantisationMaxDegPerSec,
    };
  }
}

/** Batch helper — segments a complete series. Used by tests and by the gyro reference path. */
export function segmentSeries(samples: readonly SegmenterSample[], opts: SegmenterOptions): Cycle[] {
  const seg = new CycleSegmenter(opts);
  const out: Cycle[] = [];
  for (const s of samples) {
    const c = seg.push(s);
    if (c) out.push(c);
  }
  return out;
}
