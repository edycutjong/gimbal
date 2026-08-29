import { describe, it, expect, vi, afterEach } from 'vitest';
import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import {
  BlockRunner,
  type BlockCallbacks,
  type BlockFrameState,
  type BlockResult,
} from '../src/session/blockRunner.ts';
import { matrixForUserYaw } from '../src/capture/pose.ts';
import { FFT_SIZE } from '../src/dsp/fft.ts';
import { minSampleRateHz } from '../src/dsp/limits.ts';
import type { ScoredCycle } from '../src/dsp/types.ts';
import type { GapOrientation } from '../src/optotype/trials.ts';
import type { ProtocolCard } from '../src/protocol/card.ts';
import { testCard } from './helpers.ts';

/**
 * The 30 Hz block loop, driven frame by frame.
 *
 * The loop is not driven by a timer: it is driven by `requestVideoFrameCallback`,
 * so the test supplies the frames itself and no clock has to be faked. That is
 * the whole reason `FrameClock` reads the camera's own timestamp rather than
 * `Date.now()` — the same property that makes the cadence term honest in the
 * browser makes the loop deterministic here.
 */

// ── The two collaborators the loop reaches out to ─────────────────────────

type VideoFrameCallback = (now: number, meta: { mediaTime: number }) => void;

/**
 * A stand-in for the `<video>` element, modelling the one contract the loop
 * depends on: `requestVideoFrameCallback` is ONE-SHOT, so a callback that wants
 * another frame has to re-register, and a cancelled handle never fires.
 */
class ScriptedVideo {
  private readonly pending = new Map<number, VideoFrameCallback>();
  private nextHandle = 1;
  readonly cancelled: number[] = [];

  requestVideoFrameCallback(cb: VideoFrameCallback): number {
    const handle = this.nextHandle++;
    this.pending.set(handle, cb);
    return handle;
  }

  cancelVideoFrameCallback(handle: number): void {
    this.cancelled.push(handle);
    this.pending.delete(handle);
  }

  /** Delivers one decoded frame at camera time `tMs` to everything registered. */
  deliver(tMs: number): void {
    const due = [...this.pending.values()];
    this.pending.clear();
    for (const cb of due) cb(tMs, { mediaTime: tMs / 1000 });
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  asElement(): HTMLVideoElement {
    return this as unknown as HTMLVideoElement;
  }
}

interface Detection {
  faceLandmarks?: unknown[];
  facialTransformationMatrixes?: { data: number[] }[];
}

/** What the landmarker returns for a head yawed `yawDeg` to the user's right. */
const face = (yawDeg: number): Detection => ({
  faceLandmarks: [[{ x: 0.5, y: 0.5, z: 0 }]],
  facialTransformationMatrixes: [{ data: matrixForUserYaw(yawDeg) }],
});

/** No face in frame: MediaPipe emits nothing, and that absence IS the signal. */
const NO_FACE: Detection = { faceLandmarks: [], facialTransformationMatrixes: [] };

/** A face whose transform payload is too short to be a 4×4 — present, unusable. */
const TRUNCATED_MATRIX: Detection = {
  faceLandmarks: [[{ x: 0.5, y: 0.5, z: 0 }]],
  facialTransformationMatrixes: [{ data: [1, 0, 0, 1] }],
};

// ── The prescribed motion ─────────────────────────────────────────────────

const FPS = 30;
const FRAME_MS = 1000 / FPS;
const OSC_HZ = 2; // the centre of the test card's 1.7–2.3 Hz band
/** ω_peak = 2πfA = 2π·2·20 = 251 °/s — inside the card's 150–350 °/s band. */
const AMPLITUDE_DEG = 20;

const yawAt = (tMs: number): number => AMPLITUDE_DEG * Math.sin(2 * Math.PI * OSC_HZ * (tMs / 1000));

/** The interval the card's own sampling floor implies: 1000 / ceil(2π·2.3/0.5519). */
const TARGET_INTERVAL_MS = 1000 / minSampleRateHz(2.3);

// ── Harness ───────────────────────────────────────────────────────────────

interface Harness {
  video: ScriptedVideo;
  runner: BlockRunner;
  frames: BlockFrameState[];
  cycles: ScoredCycle[];
  optotypes: { event: 'present' | 'timeout'; shown: GapOrientation | null }[];
  pauses: boolean[];
  results: BlockResult[];
  detectTimestamps: number[];
  setDetection: (d: Detection) => void;
  /** One camera frame: sets what the landmarker will see, then delivers it. */
  step: (tMs: number, yawDeg?: number) => void;
}

function makeHarness(
  opts: {
    card?: ProtocolCard;
    silent?: boolean;
    rand?: () => number;
    /** Runs inside the block's own `onFrame` callback, re-entrantly. */
    onFrameHook?: (s: BlockFrameState, runner: BlockRunner) => void;
  } = {},
): Harness {
  const video = new ScriptedVideo();
  let detection: Detection = face(0);
  const detectTimestamps: number[] = [];
  const landmarker = {
    detectForVideo: (_video: unknown, timestampMs: number): Detection => {
      detectTimestamps.push(timestampMs);
      return detection;
    },
  } as unknown as FaceLandmarker;

  const frames: BlockFrameState[] = [];
  const cycles: ScoredCycle[] = [];
  const optotypes: { event: 'present' | 'timeout'; shown: GapOrientation | null }[] = [];
  const pauses: boolean[] = [];
  const results: BlockResult[] = [];

  const recording: BlockCallbacks = {
    onFrame: (s) => {
      frames.push(s);
      opts.onFrameHook?.(s, runner);
    },
    onCycle: (c) => cycles.push(c),
    onOptotype: (event, shown) => optotypes.push({ event, shown }),
    onPause: (p) => pauses.push(p),
    onFinish: (r) => results.push(r),
  };

  const runner = new BlockRunner({
    index: 1,
    video: video.asElement(),
    landmarker,
    card: opts.card ?? testCard({ blockSeconds: 120 }),
    // `silent` builds the runner with NO callbacks at all: every `?.` call site
    // in the loop has to survive the absence of its listener.
    callbacks: opts.silent ? {} : recording,
    rand: opts.rand ?? (() => 0),
  });

  return {
    video,
    runner,
    frames,
    cycles,
    optotypes,
    pauses,
    results,
    detectTimestamps,
    setDetection: (d) => {
      detection = d;
    },
    step: (tMs, yawDeg) => {
      if (yawDeg !== undefined) detection = face(yawDeg);
      video.deliver(tMs);
    },
  };
}

/** Runs `count` frames of the prescribed oscillation, starting at frame `from`. */
function oscillate(h: Harness, count: number, from = 0): number {
  let i = from;
  for (; i < from + count; i++) {
    const tMs = i * FRAME_MS;
    h.step(tMs, yawAt(tMs));
  }
  return i;
}

/** Runs the oscillation until the block finishes, or gives up after `limit` frames. */
function oscillateUntilFinished(h: Harness, limit: number): number {
  let i = 0;
  for (; i < limit && h.results.length === 0; i++) {
    const tMs = i * FRAME_MS;
    h.step(tMs, yawAt(tMs));
  }
  return i;
}

/**
 * White-box handle on the loop body.
 *
 * `onFrame`'s first line guards against being called when the runner is not
 * running. Through the public API that guard cannot fire: `FrameClock` stops
 * itself inside `finish()`, and its own `running` flag rejects the callback one
 * level earlier — so the guard is exercised by invoking the loop body directly
 * rather than left as an unchecked claim. See the note in the test that uses it.
 */
interface LoopBody {
  onFrame(tMs: number, intervalMs: number): void;
}
const loopBody = (r: BlockRunner): LoopBody => r as unknown as LoopBody;

afterEach(() => {
  vi.restoreAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────

describe('BlockRunner — lifecycle', () => {
  it('start is idempotent: a second call registers no second frame callback', () => {
    const h = makeHarness();
    expect(h.video.pendingCount).toBe(0);

    h.runner.start();
    expect(h.video.pendingCount).toBe(1);

    h.runner.start();
    expect(h.video.pendingCount).toBe(1);

    h.step(0, 0);
    expect(h.frames).toHaveLength(1);
  });

  it('pause, resume and interrupt are inert before the block starts', () => {
    const h = makeHarness();

    h.runner.pause();
    expect(h.runner.isPaused).toBe(false);
    expect(h.pauses).toEqual([]);

    h.runner.resume();
    expect(h.pauses).toEqual([]);

    h.runner.interrupt();
    expect(h.results).toEqual([]);

    // Nothing was scheduled, so no frame can arrive.
    expect(h.video.pendingCount).toBe(0);
  });

  it('pause is idempotent, paused frames are ignored, and resume records the gap', () => {
    const h = makeHarness();
    h.runner.start();
    const next = oscillate(h, 12);
    const framesBefore = h.frames.length;
    const elapsedBefore = h.frames[framesBefore - 1]!.elapsedMs;

    h.runner.pause();
    h.runner.pause(); // already paused — one event, not two
    expect(h.runner.isPaused).toBe(true);
    expect(h.pauses).toEqual([true]);

    // Frames keep arriving while paused; the loop returns before doing anything.
    oscillate(h, 5, next);
    expect(h.frames).toHaveLength(framesBefore);

    h.runner.resume();
    h.runner.resume(); // not paused any more — inert
    expect(h.runner.isPaused).toBe(false);
    expect(h.pauses).toEqual([true, false]);

    // The paused gap is excluded by construction: the first frame after a resume
    // has no previous timestamp to subtract, so the gap is never in the sum.
    const resumedAt = 40 * FRAME_MS;
    h.step(resumedAt, yawAt(resumedAt));
    expect(h.frames.at(-1)!.elapsedMs).toBeCloseTo(elapsedBefore, 6);

    h.step(resumedAt + FRAME_MS, yawAt(resumedAt + FRAME_MS));
    expect(h.frames.at(-1)!.elapsedMs).toBeCloseTo(elapsedBefore + FRAME_MS, 6);
  });
});

describe('BlockRunner — the per-frame path', () => {
  it('reports NaN velocity until the smoothing window fills, then a real ω', () => {
    const h = makeHarness();
    h.runner.start();
    oscillate(h, 8);

    // 5-point Savitzky–Golay + a 3-point central difference: the first sample
    // can only exist once 5 raw and 3 smoothed values are in hand.
    const warmup = h.frames.slice(0, 6);
    expect(warmup).toHaveLength(6);
    for (const f of warmup) {
      expect(Number.isNaN(f.omega)).toBe(true);
      expect(f.quality).toBe(0);
      expect(f.facePresent).toBe(true);
    }

    const first = h.frames[6]!;
    expect(Number.isFinite(first.omega)).toBe(true);
    expect(first.quality).toBe(1);
    expect(first.optotypeShown).toBe(null);
    expect(first.optotypeWindowOpen).toBe(false);
  });

  it('passes a monotonic wall-clock timestamp to the landmarker, once per frame', () => {
    const h = makeHarness();
    h.runner.start();
    oscillate(h, 5);

    expect(h.detectTimestamps).toHaveLength(5);
    for (const t of h.detectTimestamps) expect(Number.isFinite(t)).toBe(true);
    for (let i = 1; i < h.detectTimestamps.length; i++) {
      expect(h.detectTimestamps[i]!).toBeGreaterThanOrEqual(h.detectTimestamps[i - 1]!);
    }
  });

  it('scores q = 0 for a face whose transform payload is not a 4×4', () => {
    const h = makeHarness();
    h.runner.start();
    oscillate(h, 10);
    expect(h.frames.at(-1)!.quality).toBe(1);

    h.setDetection(TRUNCATED_MATRIX);
    for (let i = 10; i < 14; i++) h.step(i * FRAME_MS);

    const last = h.frames.at(-1)!;
    // The face IS present — it is the measurement that is unusable, and the two
    // are reported separately rather than collapsed into one flag.
    expect(last.facePresent).toBe(true);
    expect(last.quality).toBe(0);
    expect(Number.isNaN(last.omega)).toBe(true);
  });

  it('pauses the block after 3 s out of frame, and re-arms once the face returns', () => {
    const h = makeHarness();
    h.runner.start();
    oscillate(h, 8);

    // 100 ms frames: the same 3 s of loss, a tenth of the iterations.
    const lossStart = 8 * FRAME_MS;
    h.setDetection(NO_FACE);
    for (let i = 0; i <= 29; i++) h.step(lossStart + i * 100);
    // 2.9 s of loss is not yet a pause.
    expect(h.runner.isPaused).toBe(false);
    expect(h.frames.at(-1)!.facePresent).toBe(false);
    expect(h.frames.at(-1)!.quality).toBe(0);

    h.step(lossStart + 3100);
    expect(h.runner.isPaused).toBe(true);
    expect(h.pauses).toEqual([true]);

    h.runner.resume();
    const returnedAt = lossStart + 3300;
    h.step(returnedAt, yawAt(returnedAt));
    expect(h.frames.at(-1)!.facePresent).toBe(true);

    // The face-loss timer restarts from the new loss, not from the old one.
    h.setDetection(NO_FACE);
    for (let i = 1; i <= 20; i++) h.step(returnedAt + i * 100);
    expect(h.runner.isPaused).toBe(false);
  });

  it('accumulates elapsed time only from forward deltas under a second', () => {
    const h = makeHarness();
    h.runner.start();

    h.step(1000, yawAt(1000)); // first frame: no previous timestamp to subtract
    expect(h.frames.at(-1)!.elapsedMs).toBe(0);

    h.step(1100, yawAt(1100));
    expect(h.frames.at(-1)!.elapsedMs).toBeCloseTo(100, 6);

    h.step(1100, yawAt(1100)); // repeated timestamp: delta 0, credits nothing
    expect(h.frames.at(-1)!.elapsedMs).toBeCloseTo(100, 6);

    h.step(1050, yawAt(1050)); // backwards: credits nothing
    expect(h.frames.at(-1)!.elapsedMs).toBeCloseTo(100, 6);

    h.step(4050, yawAt(4050)); // a 3 s stall is a gap, not therapy time
    expect(h.frames.at(-1)!.elapsedMs).toBeCloseTo(100, 6);

    h.step(4150, yawAt(4150));
    expect(h.frames.at(-1)!.elapsedMs).toBeCloseTo(200, 6);
  });
});

describe('BlockRunner — a whole block', () => {
  it('credits cycles, estimates f̂ twice, runs the trials, and finishes complete', () => {
    // 14 s at 30 fps is 420 frames: long enough for the FFT to fire at sample
    // 256 and again at 384 (50 % overlap), which is what puts two estimates in
    // the median and makes the median a median rather than a single value.
    const h = makeHarness({ card: testCard({ blockSeconds: 14 }) });
    h.runner.start();
    const framesRun = oscillateUntilFinished(h, 600);

    expect(h.results).toHaveLength(1);
    const r = h.results[0]!;
    expect(framesRun).toBeGreaterThan(FFT_SIZE + 128);
    expect(r.index).toBe(1);
    expect(r.prescribedSeconds).toBe(14);
    expect(r.interrupted).toBe(false);
    expect(r.effectiveFpsMedian).toBeCloseTo(30, 6);

    // f̂ recovers the 2 Hz oscillation to well inside one 0.117 Hz bin.
    expect(r.fHatMedian).toBeGreaterThan(1.9);
    expect(r.fHatMedian).toBeLessThan(2.1);

    // ~2 cycles per second for 14 s, essentially all of them credited: the
    // measured peak is 251 °/s inside a 150–350 °/s band at 2 Hz inside a
    // 1.7–2.3 Hz band.
    expect(h.cycles.length).toBeGreaterThan(20);
    expect(r.dose.credited).toBeGreaterThan(20);
    expect(r.dose.refused).toBe(0);
    expect(r.dose.deliveredSeconds).toBeGreaterThan(10);
    expect(h.cycles.every((c) => c.credited && c.reason === 'ok')).toBe(true);
    expect(h.cycles.at(-1)!.peakOmega).toBeGreaterThan(240);
    expect(h.cycles.at(-1)!.peakOmega).toBeLessThan(260);

    // rand === 0 pins the schedule: first C at 2.5 s, unanswered, so the window
    // closes at 5.0 s and the next presentation follows 2.5 s after that.
    expect(h.optotypes.length).toBeGreaterThanOrEqual(4);
    expect(h.optotypes[0]).toEqual({ event: 'present', shown: 0 });
    expect(h.optotypes[1]!.event).toBe('timeout');
    expect(r.trials.tally()).toEqual({ correct: 0, total: 2, chance: 0.25 });

    // The last frame is the one that crossed the prescription. `finish` stops
    // the clock from inside that frame's own callback, and `FrameClock.step`
    // re-checks `running` AFTER `onFrame` returns — so the stop leaves NOTHING
    // outstanding. This used to be 1: the callback re-armed unconditionally,
    // and a stopped clock kept one live request. Harmless on its own, but the
    // same unconditional re-arm meant `interrupt()` followed by `start()` left
    // two live `step` chains on one video, running `detectForVideo` twice per
    // camera frame. Zero here is what proves that cannot happen.
    expect(h.frames.at(-1)!.elapsedMs).toBeGreaterThanOrEqual(14000);
    expect(h.video.cancelled.length).toBeGreaterThan(0);
    expect(h.video.pendingCount).toBe(0);
    const framesAfterFinish = h.frames.length;
    h.step(framesRun * FRAME_MS, 0);
    expect(h.frames).toHaveLength(framesAfterFinish);
    expect(h.video.pendingCount).toBe(0);

    // A finished block absorbs everything: no second result, ever.
    h.runner.interrupt();
    expect(h.results).toHaveLength(1);
  });

  it('runs the same block with no callbacks attached at all', () => {
    const h = makeHarness({ card: testCard({ blockSeconds: 4 }), silent: true });
    h.runner.start();

    oscillate(h, 40);
    h.runner.pause();
    oscillate(h, 3, 40);
    h.runner.resume();
    expect(h.runner.isPaused).toBe(false);

    let i = 43;
    for (; i < 300 && h.video.pendingCount > 0; i++) {
      const tMs = i * FRAME_MS;
      h.step(tMs, yawAt(tMs));
    }

    // Nothing observed the block, so the only witness that it ended is the
    // frame callback the finish cancelled.
    expect(h.video.pendingCount).toBe(0);
    expect(i).toBeLessThan(300);
    expect(h.runner.answer(0)).toBe(false);
  });
});

describe('BlockRunner — degenerate clocks', () => {
  it('reports no f̂ and no fps when the camera timestamps freeze', () => {
    // Every frame carries the same media time. No interval is ever positive, so
    // the measured frame rate does not exist — and an FFT with no sample rate
    // is refused rather than being run against an assumed 30 fps.
    const h = makeHarness();
    h.runner.start();
    for (let i = 0; i < FFT_SIZE + 10; i++) h.step(5000, yawAt(i * FRAME_MS));

    expect(h.frames.length).toBe(FFT_SIZE + 10);
    expect(h.frames.every((f) => f.elapsedMs === 0)).toBe(true);
    expect(h.frames.every((f) => f.deliveredSeconds === 0)).toBe(true);

    h.runner.interrupt();
    const r = h.results[0]!;
    expect(Number.isNaN(r.effectiveFpsMedian)).toBe(true);
    expect(Number.isNaN(r.fHatMedian)).toBe(true);
    expect(r.interrupted).toBe(true);
    expect(r.dose.interruptions).toEqual([{ kind: 'interrupt', atSeconds: 0, durationMs: 0 }]);
  });

  it('reports no f̂ when the measured frame rate puts the search band below bin 1', () => {
    // 0.25 ms frames measure as 4000 fps, so a 256-point window is 15.6 Hz per
    // bin and the whole 0.4–5 Hz search band falls inside the DC bin. The
    // estimator says "no dominant frequency" rather than returning bin 1.
    const h = makeHarness();
    h.runner.start();
    for (let i = 0; i < FFT_SIZE + 10; i++) h.step(i * 0.25, yawAt(i * 0.25));

    h.runner.interrupt();
    const r = h.results[0]!;
    expect(r.effectiveFpsMedian).toBeCloseTo(4000, 6);
    expect(Number.isNaN(r.fHatMedian)).toBe(true);
    // 266 frames × 0.25 ms is 66 ms of block: nothing near the prescription.
    expect(h.frames.at(-1)!.elapsedMs).toBeCloseTo((FFT_SIZE + 9) * 0.25, 6);
  });
});

describe('BlockRunner — interruption', () => {
  it('an interrupt raised from the frame callback wins over the completing frame', () => {
    // The stop rule fires on the same frame that crosses the prescription. The
    // block is interrupted, and the completion check that runs immediately
    // afterwards must not deliver a second, contradictory result.
    const h = makeHarness({
      card: testCard({ blockSeconds: 2 }),
      onFrameHook: (s, runner) => {
        if (s.elapsedMs >= 2000) runner.interrupt();
      },
    });

    h.runner.start();
    for (let i = 0; i < 200 && h.results.length === 0; i++) {
      const tMs = i * FRAME_MS;
      h.step(tMs, yawAt(tMs));
    }

    expect(h.results).toHaveLength(1);
    expect(h.results[0]!.interrupted).toBe(true);
    expect(h.results[0]!.prescribedSeconds).toBe(2);
    expect(h.frames.at(-1)!.elapsedMs).toBeGreaterThanOrEqual(2000);
    expect(h.results[0]!.dose.interrupted).toBe(true);
    expect(h.results[0]!.dose.deliveredSeconds).toBeGreaterThan(1);
  });

  it('a restarted block sees no interval on its first frame and falls back to the target', () => {
    const h = makeHarness();
    h.runner.start();
    oscillate(h, 12);
    expect(h.frames.at(-1)!.quality).toBe(1);

    h.runner.interrupt();
    expect(h.video.pendingCount).toBe(0); // the outstanding callback was cancelled

    // Restarting reuses the warm velocity stream, so the very first frame after
    // the restart yields a sample even though the frame clock has no interval to
    // report yet. `frameQuality` is fed the prescription's target interval in
    // that case, which is a cadence score of exactly 1 — never a NaN.
    h.runner.start();
    const before = h.frames.length;
    h.step(100_000, yawAt(100_000));

    expect(h.frames).toHaveLength(before + 1);
    const restarted = h.frames.at(-1)!;
    expect(Number.isFinite(restarted.omega)).toBe(true);
    expect(restarted.quality).toBe(1);

    // The next frame does have a measured interval — a very late one, which the
    // cadence term marks down instead of ignoring.
    h.step(100_000 + 4 * TARGET_INTERVAL_MS, yawAt(100_000 + 4 * TARGET_INTERVAL_MS));
    expect(h.frames.at(-1)!.quality).toBeCloseTo(0.25, 6);
  });
});

describe('BlockRunner — answers', () => {
  it('accepts an arrow-key answer only while running, unpaused, and inside a window', () => {
    const h = makeHarness();
    expect(h.runner.answer(0)).toBe(false); // not started

    h.runner.start();
    oscillate(h, 10);
    expect(h.runner.answer(0)).toBe(false); // no C on screen yet

    h.runner.pause();
    expect(h.runner.answer(0)).toBe(false); // paused
    h.runner.resume();

    let i = 10;
    for (; i < 400 && h.optotypes.length === 0; i++) {
      const tMs = i * FRAME_MS;
      h.step(tMs, yawAt(tMs));
    }
    expect(h.optotypes[0]).toEqual({ event: 'present', shown: 0 });
    expect(h.frames.at(-1)!.optotypeWindowOpen).toBe(true);
    expect(h.frames.at(-1)!.optotypeShown).toBe(0);

    expect(h.runner.answer(0)).toBe(true);
    expect(h.runner.answer(0)).toBe(false); // the window closed on the first answer

    h.runner.interrupt();
    expect(h.results[0]!.trials.tally()).toEqual({ correct: 1, total: 1, chance: 0.25 });
  });
});

describe('BlockRunner — guards', () => {
  it('exposes a ring scale from the card, never from the measurement', () => {
    // max(350 × 1.3, 2π × 2.0 × 25) = max(455, 314) = 455.
    const h = makeHarness();
    expect(h.runner.ringMax).toBeCloseTo(455, 6);

    const slow = makeHarness({ card: testCard({ bandLo: 0.9, bandHi: 1.1, ceiling: 100 }) });
    // max(100 × 1.3, 2π × 1.0 × 25) = max(130, 157.08) = 157.08.
    expect(slow.runner.ringMax).toBeCloseTo(2 * Math.PI * 25, 6);
  });

  it('the loop body refuses a frame delivered after the block has stopped', () => {
    // Unreachable through the public API: `finish` stops the FrameClock, whose
    // own `running` flag rejects the callback one level earlier. The guard is
    // the second line of defence, so it is invoked directly.
    const h = makeHarness();
    h.runner.start();
    oscillate(h, 10);
    h.runner.interrupt();

    const framesBefore = h.frames.length;
    const detectionsBefore = h.detectTimestamps.length;
    loopBody(h.runner).onFrame(99_999, FRAME_MS);

    expect(h.frames).toHaveLength(framesBefore);
    expect(h.detectTimestamps).toHaveLength(detectionsBefore);
    expect(h.results).toHaveLength(1);
  });

  it('records no pause when the wall clock cannot say when the pause began', () => {
    // The pause duration is wall-clock, and a pause with no finite start time is
    // not recorded as a zero-length or NaN-length one — it is not recorded.
    const h = makeHarness();
    h.runner.start();
    oscillate(h, 10);

    vi.spyOn(performance, 'now').mockReturnValue(Number.NaN);
    h.runner.pause();
    h.runner.resume();

    expect(h.pauses).toEqual([true, false]);
    h.runner.interrupt();
    expect(h.results[0]!.dose.pauseCount).toBe(0);
    expect(h.results[0]!.dose.interruptions).toHaveLength(1);
  });

  it('records a real pause when the wall clock is available', () => {
    const h = makeHarness();
    h.runner.start();
    oscillate(h, 10);

    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(10_000);
    h.runner.pause();
    now.mockReturnValue(12_500);
    h.runner.resume();

    h.runner.interrupt();
    const dose = h.results[0]!.dose;
    expect(dose.pauseCount).toBe(1);
    expect(dose.pausedMs).toBe(2500);
    expect(dose.interruptions[0]).toEqual({
      kind: 'pause',
      atSeconds: h.frames.at(-1)!.elapsedMs / 1000,
      durationMs: 2500,
    });
  });
});
