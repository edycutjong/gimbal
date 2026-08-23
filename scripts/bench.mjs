#!/usr/bin/env node
/**
 * The DSP frame-budget benchmark.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT THIS MEASURES, AND WHAT IT DOES NOT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * MEASURES: two things, in this order.
 *
 *  1. CORRECTNESS — all SIX outcomes of the credit/refusal gate (`ok`,
 *     `too-slow`, `too-fast`, `off-cadence`, `low-confidence`, `face-lost`),
 *     each driven END-TO-END from an analytic signal through the shipped
 *     stream, quality score, segmenter and gate. Not a `Cycle` literal handed
 *     to `scoreCycle` — that proves the gate branches; this proves the pipeline
 *     can produce the cycle the branch is for.
 *  2. COMPUTE COST — how long the shipped signal-processing path takes to
 *     execute, in microseconds, against the 33.33 ms budget one camera frame
 *     gets at 30 fps. A measurement of pure functions.
 *
 * (1) gates (2): if any assertion fails, no timing is printed at all.
 *
 * DOES **NOT** MEASURE: accuracy, agreement with any reference sensor, or
 * anything clinical. **The bench-agreement figure this project owes — webcam
 * against a temple-mounted gyroscope — is NOT this number and is not produced
 * here.** That one needs a physical recording (`fixtures/README.md`), it does
 * not exist, and no figure from this file may ever be quoted as though it were.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHY A SYNTHESISED DRIVE SIGNAL IS LEGITIMATE HERE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `fixtures/README.md` states the rule this repository runs on: **`fixtures/`
 * may not synthesise; `tests/` may.** The distinction is between a synthetic
 * *session* — a fabricated measurement — and a synthetic *input to a pure
 * function under test*, which is how you test at all.
 *
 * This benchmark is squarely the second kind. It feeds an analytic sinusoid,
 * whose properties are known in closed form, to functions whose cost is being
 * timed. Nothing it produces is a session, a dose, or a patient record, and
 * `--json` writes timings and counts only. A benchmark that timed a recorded
 * clip would be measuring the H.264 decoder, not the DSP.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DETERMINISM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The INPUT is fully deterministic: an analytic yaw series plus frame-interval
 * jitter from a stated linear congruential generator with a fixed seed. No
 * `Date.now()`, no `Math.random()`, no environment reaches the signal. The
 * derived COUNTS — frames, cycles, credited, refused, f̂ — are therefore
 * byte-stable on every machine, and the run asserts them before it prints a
 * single timing. If those assertions ever pass while the pipeline is broken,
 * the benchmark is timing a no-op, which is the failure mode this guards.
 *
 * The TIMINGS are, correctly, machine-dependent. That is what a benchmark is.
 * Every reported figure carries the machine it was measured on.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These are the SHIPPED modules, imported from `src/`. There is no copy of the
 * pipeline in this file — a benchmark against a re-implementation measures the
 * re-implementation.
 *
 * It also honours `scripts/checks.mjs`'s partition rule: every file this script
 * reads is committed in this repository, and it makes zero network requests. It
 * runs on a clean clone, offline, with `npm ci` and nothing else.
 *
 * It runs in CI as its own step rather than inside `npm test`, because the two
 * halves want different treatment: the COUNTS are asserted and are
 * byte-deterministic across machines, while the TIMINGS are printed and never
 * asserted — a timing assertion on a shared runner is a flaky assertion, and a
 * flaky gate teaches everyone to ignore it.
 *
 * Usage:  npm run bench            human-readable table
 *         npm run bench -- --json  machine-readable, to stdout
 *
 * REQUIRES NODE >= 22.7 — pinned in `package.json`'s `engines`. The `src/`
 * modules use TypeScript parameter properties, which Node's *strip-only* mode
 * (22.6) refuses; `--experimental-transform-types` landed in **22.7.0** and is
 * what the `bench` script passes. This is deliberately NOT worked around by
 * rewriting `src/` — the shipped code does not get reshaped to suit a benchmark,
 * and importing the real modules is the entire point of the file. It is also not
 * a flag on the reproduce path in the sense `U-FLAG` guards: it selects a
 * language mode, it does not select what the code does.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { arch, cpus, platform, totalmem } from 'node:os';

import { VelocityStream } from '../src/dsp/stream.ts';
import { CycleSegmenter } from '../src/dsp/segment.ts';
import { scoreCycle } from '../src/dsp/score.ts';
import { FIT_RESIDUAL_TOLERANCE, frameQuality } from '../src/dsp/quality.ts';
import { dominantFrequency, FFT_SIZE } from '../src/dsp/fft.ts';
import { peakAccelFor, peakOmegaFor } from '../src/dsp/velocity.ts';
import { INSTRUMENT_LIMITS, deadbandDegPerSec, minSampleRateHz } from '../src/dsp/limits.ts';
import { ALL_OUTCOMES } from '../src/dsp/types.ts';
import { parseCard } from '../src/protocol/card.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const JSON_OUT = process.argv.includes('--json');

// ── The drive signal ───────────────────────────────────────────────────────
//
// A patient oscillating in yaw at the centre of the demo card's prescribed
// band. Amplitude is chosen so the analytic peak velocity 2πfA sits inside the
// card's [floor, ceiling] window — the benchmark must exercise the CREDIT path,
// not only the refusal path, or it times half the gate.

const FPS = 30;
const NOMINAL_DT_MS = 1000 / FPS;
const FRAME_BUDGET_MS = NOMINAL_DT_MS;
const DRIVE_HZ = 2.0;
const AMPLITUDE_DEG = 20; // 2π·2.0·20 = 251.3 °/s — inside [150, 350]
/**
 * The lazy rep, benchmarked. Same tempo, visibly smaller sweep:
 * 2π·2.0·8 = 100.5 °/s, below the card's 150 °/s floor and well above the
 * 22.5 °/s hysteresis deadband — so the sweeps are still DETECTED and then
 * REFUSED, which is the distinction the whole product turns on. A benchmark
 * that only ever exercised the credit path would time half the gate and miss
 * the half that is the product.
 */
const LAZY_AMPLITUDE_DEG = 8;
const SECONDS = 60;
const FRAME_COUNT = SECONDS * FPS;

// ── The other four outcomes ────────────────────────────────────────────────
//
// The gate has SIX outcomes. Two of them — `ok` and `too-slow` — are the pair
// the product's pitch turns on, and they were the only two this benchmark ever
// drove end-to-end; the remaining four were covered by a unit test that handed
// `scoreCycle` a hand-built `Cycle` literal. That proves the gate BRANCHES. It
// does not prove the PIPELINE CAN PRODUCE those cycles from a signal, which is
// a different and stronger claim, and it is the one a reader of a "dose meter"
// should want checked.
//
// `low-confidence` matters most of the four. It is the answer to the largest
// technical risk in the project — head-pose fidelity at 2 Hz on a commodity
// webcam — and the answer is that the instrument REFUSES TO EMIT rather than
// smoothing. `too-slow` alone reads as a bug; `too-slow` and `low-confidence`
// together read as a policy. Driving only the first published the easy half.
//
// Every constant below is DERIVED from a shipped one, never re-stated as a
// literal. `qFloor` is one of the two `PROVISIONAL_FROM_SPIKE` values in
// `src/dsp/limits.ts`, so a literal `0.55` here would silently stop testing
// anything on the day that threshold is calibrated.

/** 2π·2.0·30 = 377.0 °/s — above the card's 350 °/s ceiling, below the 655.34 °/s quantisation limit. */
const FAST_AMPLITUDE_DEG = 30;

/**
 * The right velocity at the wrong tempo. At ±30° and 1.2 Hz the peak is
 * 2π·1.2·30 = 226.2 °/s, comfortably INSIDE [150, 350] — so velocity cannot be
 * the cause — while 1.2 Hz is outside the card's [1.7, 2.3] band. `off-cadence`
 * is last in `REASON_PRECEDENCE`, so it is only reachable when every check
 * above it passes, which is exactly what this drive arranges.
 */
const OFF_CADENCE_HZ = 1.2;

/**
 * A degenerate rigid fit, sized against the constants rather than guessed.
 *
 *   q_fit = 1 − fitResidual / FIT_RESIDUAL_TOLERANCE      (src/dsp/quality.ts)
 *
 * Solve it for a target q at three-quarters of the floor, and the cycle's `qMin`
 * lands below `qFloor` with margin on both sides — far enough under to be
 * unambiguous, far enough above zero that it is a degraded measurement rather
 * than an absent one. `q = min(q_presence, q_cadence, q_fit, q_kinematic)`, and
 * at ±20°/2 Hz the other three terms are 1, so q_fit is the binding one.
 */
const LOW_CONFIDENCE_TARGET_Q = INSTRUMENT_LIMITS.qFloor * 0.75;
const LOW_CONFIDENCE_FIT_RESIDUAL = FIT_RESIDUAL_TOLERANCE * (1 - LOW_CONFIDENCE_TARGET_Q);

/**
 * THE APPROXIMATION IN THE `face-lost` DRIVE, STATED.
 *
 * In the live capture loop a face-absent frame means `FaceLandmarker` emitted
 * nothing at all, and THAT ABSENCE IS THE SIGNAL (`src/dsp/quality.ts`). This
 * drive instead feeds `facePresent: false` alongside a yaw series that keeps
 * going, which exercises **the gate's handling of a face-absent frame** — the
 * segmenter carrying `faceLost` onto the cycle, `frameQuality` returning 0, and
 * `REASON_PRECEDENCE` reporting `face-lost` ahead of the `low-confidence` that
 * q = 0 would otherwise produce. It is NOT a claim about what the capture loop
 * does when the model goes quiet. An unstated approximation in a benchmark is
 * how a benchmark starts lying, so it is stated.
 */
const FACE_LOST_PRESENT = false;

/**
 * Frame-interval jitter. A real camera does not deliver a constant 33.3 ms, and
 * a pipeline that assumed it would would be measured here as faster than it is
 * — `median()` over the cycle and the `q_cadence` term both do real work only
 * when the intervals actually vary.
 *
 * Numerical Recipes' LCG, seed stated, period 2^32. This is a drive signal, not
 * a measurement: it decides WHEN a frame arrives, never WHAT it reports.
 */
const LCG_SEED = 20260823;
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function driveSignal(amplitudeDeg, { hz = DRIVE_HZ, fitResidual = null, facePresent = true } = {}) {
  const next = lcg(LCG_SEED);
  const frames = [];
  let tMs = 0;
  for (let i = 0; i < FRAME_COUNT; i++) {
    // ±12 % interval jitter, mean-preserving.
    const dt = NOMINAL_DT_MS * (0.88 + 0.24 * next());
    tMs += dt;
    const tSec = tMs / 1000;
    // Drawn UNCONDITIONALLY, even when the residual is being overridden, so that
    // pinning it cannot shift the interval sequence behind it. Every drive then
    // shares one frame clock and the six runs stay comparable — and the two
    // drives that predate this change produce byte-identical frames to before.
    const wellConditioned = 0.004 + 0.002 * next();
    frames.push({
      tMs,
      dtMs: dt,
      yaw: amplitudeDeg * Math.sin(2 * Math.PI * hz * tSec),
      // A well-conditioned rigid fit. The orthonormality residual of a real
      // MediaPipe rotation block sits far below the 0.05 tolerance.
      fitResidual: fitResidual ?? wellConditioned,
      facePresent,
    });
  }
  return frames;
}

// ── Statistics ─────────────────────────────────────────────────────────────

function percentile(sortedUs, p) {
  if (sortedUs.length === 0) return NaN;
  const rank = (p / 100) * (sortedUs.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedUs[lo];
  return sortedUs[lo] + (sortedUs[hi] - sortedUs[lo]) * (rank - lo);
}

function summarise(name, unit, samplesUs) {
  const sorted = [...samplesUs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    name,
    unit,
    n: sorted.length,
    mean_us: sum / sorted.length,
    p50_us: percentile(sorted, 50),
    p95_us: percentile(sorted, 95),
    p99_us: percentile(sorted, 99),
    max_us: sorted[sorted.length - 1],
  };
}

// ── The card, read from the file the app actually ships ────────────────────

const card = parseCard(JSON.parse(readFileSync(`${ROOT}public/cards/demo-vorx1-yaw-seated.json`, 'utf8')));
const [, bandHi] = card.frequencyBand.value;
const targetIntervalMs = 1000 / minSampleRateHz(bandHi);
const analyticPeakOmega = peakOmegaFor(DRIVE_HZ, AMPLITUDE_DEG);

// ── B1: the whole per-frame path ───────────────────────────────────────────
//
// VelocityStream.push → frameQuality → CycleSegmenter.push → scoreCycle.
// One timed region per frame, exactly the work the 30 Hz capture loop does
// after `FaceLandmarker` hands back a rotation matrix.

function runPipeline(frames, { timed, amplitudeDeg, hz = DRIVE_HZ }) {
  const stream = new VelocityStream();
  const segmenter = new CycleSegmenter({
    // `fHat` follows the drive, exactly as it follows the FFT estimate in the
    // live loop. Pinning it at 2.0 Hz for a 1.2 Hz drive would mis-scale the
    // central-difference correction and make the off-cadence run measure the
    // wrong velocity for the right reason.
    deadbandDegPerSec: deadbandDegPerSec(card.peakVelocityFloor.value),
    fHat: hz,
    limits: INSTRUMENT_LIMITS,
  });

  const perFrameUs = [];
  const outcomes = Object.create(null);
  let cycles = 0;
  let credited = 0;
  let doseSeconds = 0;

  for (const f of frames) {
    const t0 = timed ? process.hrtime.bigint() : 0n;

    const v = stream.push(f.tMs, f.yaw);
    if (v) {
      const q = frameQuality({
        facePresent: f.facePresent,
        frameIntervalMs: f.dtMs,
        targetIntervalMs,
        fitResidual: f.fitResidual,
        angularAccel: v.accel,
        plausibleAccel: peakAccelFor(hz, amplitudeDeg),
      });
      const cycle = segmenter.push({ tMs: v.tMs, omega: v.omega, quality: q, facePresent: f.facePresent });
      if (cycle) {
        cycles++;
        const result = scoreCycle(cycle, card);
        outcomes[result.reason] = (outcomes[result.reason] ?? 0) + 1;
        if (result.credited) credited++;
        doseSeconds += result.doseSeconds;
      }
    }

    if (timed) perFrameUs.push(Number(process.hrtime.bigint() - t0) / 1000);
  }

  return { perFrameUs, cycles, credited, outcomes, doseSeconds };
}

// ── B2: the FFT window ─────────────────────────────────────────────────────
//
// 256-point Hann-windowed real FFT with parabolic peak interpolation, run at
// 50 % overlap — so in the live loop this cost lands once every 128 frames
// (4.27 s at 30 fps), not once per frame.

function runFft(omegaSeries, iterations) {
  const window = omegaSeries.slice(0, FFT_SIZE);
  const samplesUs = [];
  let last = null;
  for (let i = 0; i < 500; i++) dominantFrequency(window, FPS, { minHz: 0.5, maxHz: INSTRUMENT_LIMITS.maxCycleHz });
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    last = dominantFrequency(window, FPS, { minHz: 0.5, maxHz: INSTRUMENT_LIMITS.maxCycleHz });
    samplesUs.push(Number(process.hrtime.bigint() - t0) / 1000);
  }
  return { samplesUs, estimate: last };
}

// ── B3: the credit / refusal gate alone ────────────────────────────────────

function runGate(cycle, iterations) {
  const samplesUs = [];
  let sink = 0;
  for (let i = 0; i < 20000; i++) scoreCycle(cycle, card);
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    const r = scoreCycle(cycle, card);
    samplesUs.push(Number(process.hrtime.bigint() - t0) / 1000);
    sink += r.doseSeconds;
  }
  return { samplesUs, sink };
}

// ── Correctness gate — asserted BEFORE any timing is printed ───────────────
//
// A benchmark whose pipeline silently returns early would report a beautiful
// p95. These assertions are what make the timings mean something.

const failures = [];
let assertionCount = 0;
function assert(label, condition, detail) {
  assertionCount += 1;
  if (!condition) failures.push(`${label}: ${detail}`);
}

// ── The six drives, one per gate outcome ───────────────────────────────────
//
// `ALL_OUTCOMES` is imported from `src/dsp/types.ts` rather than restated, so a
// seventh outcome added to the gate FAILS THIS BENCHMARK on the partition
// assertion below rather than quietly going unmeasured.

const DRIVES = [
  {
    outcome: 'ok',
    amplitudeDeg: AMPLITUDE_DEG,
    hz: DRIVE_HZ,
    timed: 'per-frame, credited',
    why: 'inside the velocity window, on cadence, well tracked',
  },
  {
    outcome: 'too-slow',
    amplitudeDeg: LAZY_AMPLITUDE_DEG,
    hz: DRIVE_HZ,
    timed: 'per-frame, refused',
    why: 'the same tempo, a smaller sweep — detected, then refused',
  },
  {
    outcome: 'too-fast',
    amplitudeDeg: FAST_AMPLITUDE_DEG,
    hz: DRIVE_HZ,
    why: 'above the ceiling; faster is not better, and the card says so',
  },
  {
    outcome: 'off-cadence',
    amplitudeDeg: FAST_AMPLITUDE_DEG,
    hz: OFF_CADENCE_HZ,
    why: 'right velocity, wrong tempo — last in precedence, so all else passed',
  },
  {
    outcome: 'low-confidence',
    amplitudeDeg: AMPLITUDE_DEG,
    hz: DRIVE_HZ,
    fitResidual: LOW_CONFIDENCE_FIT_RESIDUAL,
    why: 'a creditable sweep the instrument will not vouch for',
  },
  {
    outcome: 'face-lost',
    amplitudeDeg: AMPLITUDE_DEG,
    hz: DRIVE_HZ,
    facePresent: FACE_LOST_PRESENT,
    why: 'the instrument could not see — reported ahead of low-confidence',
  },
];

for (const d of DRIVES) {
  d.frames = driveSignal(d.amplitudeDeg, {
    hz: d.hz,
    fitResidual: d.fitResidual ?? null,
    facePresent: d.facePresent ?? true,
  });
  d.opts = { amplitudeDeg: d.amplitudeDeg, hz: d.hz };
  d.analyticPeakOmega = peakOmegaFor(d.hz, d.amplitudeDeg);
  d.analyticCycles = SECONDS * d.hz;
}

// Warm-up. Two full untimed passes of each drive that will be timed, so the JIT
// has tiered up before anything is measured and neither path is measured cold
// against the other.
for (let i = 0; i < 2; i++) {
  for (const d of DRIVES) if (d.timed) runPipeline(d.frames, { timed: false, ...d.opts });
}

for (const d of DRIVES) d.run = runPipeline(d.frames, { timed: Boolean(d.timed), ...d.opts });

const byOutcome = Object.fromEntries(DRIVES.map((d) => [d.outcome, d]));
const frames = byOutcome.ok.frames;
const run = byOutcome.ok.run;
const lazy = byOutcome['too-slow'].run;
const lazyPeakOmega = byOutcome['too-slow'].analyticPeakOmega;

/**
 * 60 s of oscillation at f Hz is 60f full cycles. The stream withholds its first
 * samples (5-point smoother + 3-point difference) and the segmenter needs a
 * first sign change to open a cycle, so a small deficit at the head is correct.
 * A SURPLUS would mean phantom sweeps, which is the failure the hysteresis
 * exists to prevent and which would inflate the one number the product is about.
 */
const CYCLE_DEFICIT_TOLERANCE = 3;

for (const d of DRIVES) {
  const r = d.run;
  const inWindow =
    d.analyticPeakOmega >= card.peakVelocityFloor.value && d.analyticPeakOmega <= card.peakVelocityCeiling.value;
  const onCadence = d.hz >= card.frequencyBand.value[0] && d.hz <= card.frequencyBand.value[1];
  // Band membership is COMPUTED for the diagnostic, never asserted in prose.
  // Hard-coding "is inside" once printed the self-refuting
  // `100.5 °/s is inside [150, 350]` the moment a drive amplitude changed — a
  // diagnostic that lies about the thing it was printed to diagnose is worse
  // than no diagnostic.
  const where =
    `±${d.amplitudeDeg}° at ${d.hz} Hz → 2π·${d.hz}·${d.amplitudeDeg} = ${d.analyticPeakOmega.toFixed(1)} °/s, ` +
    `${inWindow ? 'inside' : 'OUTSIDE'} [${card.peakVelocityFloor.value}, ${card.peakVelocityCeiling.value}]; ` +
    `${d.hz} Hz is ${onCadence ? 'inside' : 'OUTSIDE'} [${card.frequencyBand.value.join(', ')}]`;

  assert(
    `${d.outcome} — the sweeps are detected, not lost`,
    r.cycles >= d.analyticCycles - CYCLE_DEFICIT_TOLERANCE && r.cycles <= d.analyticCycles,
    `segmented ${r.cycles}; ${d.hz} Hz for ${SECONDS} s is ${d.analyticCycles} analytic cycles, expected ` +
      `${d.analyticCycles - CYCLE_DEFICIT_TOLERANCE}..${d.analyticCycles}. Peak ` +
      `${d.analyticPeakOmega.toFixed(1)} °/s must clear the ` +
      `${deadbandDegPerSec(card.peakVelocityFloor.value).toFixed(1)} °/s hysteresis deadband. ${where}`,
  );
  assert(
    `${d.outcome} — every cycle reaches this outcome and no other`,
    r.outcomes[d.outcome] === r.cycles && Object.keys(r.outcomes).length === 1,
    `outcomes ${JSON.stringify(r.outcomes)} over ${r.cycles} cycles; every one should be ${d.outcome}. ${where}`,
  );
  if (d.outcome === 'ok') {
    // THE CREDIT PATH. A benchmark that only exercised refusals would time half
    // the gate and miss the half that pays.
    assert(
      'ok — dose accumulates one period per credited cycle',
      r.credited === r.cycles && r.credited > 0 && Math.abs(r.doseSeconds - r.cycles / d.hz) < 1.0,
      `${r.credited} of ${r.cycles} credited, delivered dose ${r.doseSeconds.toFixed(3)} s; ` +
        `${r.cycles} cycles at ${d.hz} Hz is ~${(r.cycles / d.hz).toFixed(3)} s. ${where}`,
    );
  } else {
    // THE PRODUCT CLAIM, checked five ways without a camera: a refusal
    // contributes EXACTLY 0.000 s. Not approximately zero — zero, from the one
    // `refuse()` helper every refusal path in `scoreCycle` returns through.
    assert(
      `${d.outcome} — a refused rep contributes exactly zero dose`,
      r.credited === 0 && r.doseSeconds === 0,
      `${r.credited} credited, delivered dose ${r.doseSeconds}; a refusal must be exactly 0, not approximately`,
    );
  }
}

// The partition itself: six drives, six outcomes, none unreached and none
// reached twice. This is the assertion the old two-row gate could not make.
const reached = DRIVES.map((d) => d.outcome);
assert(
  'the drives partition the gate — all six outcomes, each exactly once',
  reached.length === ALL_OUTCOMES.length && ALL_OUTCOMES.every((o) => reached.filter((x) => x === o).length === 1),
  `drives reach [${reached.join(', ')}]; the gate declares [${ALL_OUTCOMES.join(', ')}]`,
);

// The omega series the FFT bench runs on comes out of the same shipped stream.
const omegaSeries = [];
{
  const s = new VelocityStream();
  for (const f of frames) {
    const v = s.push(f.tMs, f.yaw);
    if (v) omegaSeries.push(v.omega);
  }
}
const fft = runFft(omegaSeries, 2000);
const binWidth = FPS / FFT_SIZE;
assert(
  'f̂ recovers the drive frequency',
  fft.estimate.frequencyHz !== null && Math.abs(fft.estimate.frequencyHz - DRIVE_HZ) <= binWidth,
  `f̂ = ${fft.estimate.frequencyHz}; drive is ${DRIVE_HZ} Hz and one bin is ${binWidth.toFixed(4)} Hz`,
);

// A representative credited cycle for the gate bench.
const gateCycle = {
  tStartMs: 0,
  tEndMs: 500,
  periodMs: 500,
  peakOmega: analyticPeakOmega,
  rawPeakOmega: analyticPeakOmega * 0.971,
  sampleCount: 15,
  qMin: 0.92,
  qMean: 0.96,
  fHat: DRIVE_HZ,
  faceLost: false,
  saturated: false,
};
const gate = runGate(gateCycle, 200000);
assert('gate bench credits its cycle', scoreCycle(gateCycle, card).credited, 'the gate bench cycle was refused');

if (failures.length > 0) {
  process.stderr.write('\nBENCH CORRECTNESS GATE FAILED — no timing is reported.\n\n');
  for (const f of failures) process.stderr.write(`  ✗ ${f}\n`);
  process.stderr.write('\n');
  process.exit(1);
}

// ── Results ────────────────────────────────────────────────────────────────

const b1 = summarise(
  byOutcome.ok.timed,
  'one camera frame: stream → quality → segmenter → gate',
  run.perFrameUs,
);
const b1b = summarise(byOutcome['too-slow'].timed, 'same path, every cycle refused too-slow', lazy.perFrameUs);
const b2 = summarise('256-point Hann FFT', 'one window: dominantFrequency, once per 128 frames', fft.samplesUs);
const b3 = summarise('credit / refusal gate', 'one completed cycle: scoreCycle', gate.samplesUs);
const TABLE = [b1, b1b, b2, b3];

const cpu = cpus()[0]?.model ?? 'unknown';
const machine = {
  cpu,
  cores: cpus().length,
  platform: platform(),
  arch: arch(),
  memory_gb: Math.round(totalmem() / 1024 ** 3),
  node: process.version,
};

const budgetShareP95 = (b1.p95_us / 1000 / FRAME_BUDGET_MS) * 100;
const headroom = FRAME_BUDGET_MS / (b1.p95_us / 1000);

if (JSON_OUT) {
  process.stdout.write(
    `${JSON.stringify(
      {
        what: 'all six credit/refusal gate outcomes driven end-to-end, then the compute cost of the shipped DSP pipeline. NOT an accuracy figure and NOT the bench-agreement measurement, which does not exist.',
        drive: {
          seed: LCG_SEED,
          fps: FPS,
          seconds: SECONDS,
          frames: FRAME_COUNT,
          interval_jitter_pct: 12,
        },
        correctness: {
          assertions: assertionCount,
          gate_outcomes_declared: ALL_OUTCOMES,
          // One drive per declared outcome. The partition is asserted, not
          // described: a seventh outcome without a seventh drive exits 1.
          drives: DRIVES.map((d) => ({
            outcome: d.outcome,
            amplitude_deg: d.amplitudeDeg,
            frequency_hz: d.hz,
            fit_residual: d.fitResidual ?? null,
            face_present: d.facePresent ?? true,
            peak_omega_deg_per_s: Number(d.analyticPeakOmega.toFixed(1)),
            analytic_cycles: d.analyticCycles,
            cycles: d.run.cycles,
            credited: d.run.credited,
            outcomes: d.run.outcomes,
            delivered_dose_s: Number(d.run.doseSeconds.toFixed(3)),
            why: d.why,
          })),
          f_hat_hz: Number(fft.estimate.frequencyHz.toFixed(4)),
          bin_width_hz: Number(binWidth.toFixed(4)),
        },
        frame_budget_ms: FRAME_BUDGET_MS,
        results: TABLE,
        p95_frame_budget_pct: Number(budgetShareP95.toFixed(3)),
        headroom_x: Number(headroom.toFixed(1)),
        machine,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

const us = (v) => `${v.toFixed(2)} µs`;
const pad = (s, n) => String(s).padEnd(n);

process.stdout.write(`
DSP frame-budget benchmark
──────────────────────────────────────────────────────────────────────────────
COMPUTE COST ONLY. This says nothing about measurement accuracy, and it is NOT
the webcam-vs-gyroscope agreement figure — that needs a physical recording,
it does not exist, and nothing here may be quoted as though it did.

Drive signal   ${DRIVES.length} analytic yaw drives, ${SECONDS} s each, ${FRAME_COUNT} frames at ${FPS} fps
               ±12 % frame-interval jitter, LCG seed ${LCG_SEED} (deterministic)
Card           public/cards/demo-vorx1-yaw-seated.json — band ${card.frequencyBand.value.join('–')} Hz,
               velocity ${card.peakVelocityFloor.value}–${card.peakVelocityCeiling.value} °/s

Correctness gate — asserted before any timing was printed, and the reason these
timings mean something. A pipeline returning early would post a beautiful p95.

ALL SIX GATE OUTCOMES, each driven end-to-end from an analytic signal through the
shipped stream, quality score, segmenter and gate — not from a hand-built Cycle
handed to scoreCycle. ${assertionCount} assertions; any one of them exits 1 before the table.

  ${pad('outcome', 17)}${pad('drive', 19)}${pad('peak |ω|', 13)}${pad('cycles', 10)}${pad('credited', 10)}dose
  ${'─'.repeat(76)}
${DRIVES.map(
  (d) =>
    `  ${pad(d.outcome, 17)}${pad(`±${d.amplitudeDeg}° @ ${d.hz.toFixed(1)} Hz`, 19)}` +
    `${pad(`${d.analyticPeakOmega.toFixed(1)} °/s`, 13)}` +
    `${pad(`${d.run.cycles}/${d.analyticCycles}`, 10)}${pad(String(d.run.credited), 10)}` +
    `${d.run.doseSeconds.toFixed(3)} s\n      ${d.why}`,
).join('\n')}

  Every refusal above is EXACTLY 0.000 s, not approximately zero — one refuse()
  helper, one code path, asserted with ===.
  The sub-therapeutic sweeps are DETECTED and then refused, not lost: ${lazyPeakOmega.toFixed(1)} °/s
  clears the ${deadbandDegPerSec(card.peakVelocityFloor.value).toFixed(1)} °/s hysteresis deadband. That distinction is the difference
  between a policy and a dropout, and it is what the ${byOutcome['too-slow'].run.cycles} segmented cycles show.
  The face-lost drive feeds facePresent: false alongside a continuing yaw series.
  It exercises the GATE's handling of an absent face; it is not a claim about what
  the capture loop does when the model goes quiet.

  ✓ ${pad(`f̂ = ${fft.estimate.frequencyHz.toFixed(4)} Hz`, 32)} bin width ${binWidth.toFixed(4)} Hz

${pad('', 26)}${pad('p50', 12)}${pad('p95', 12)}${pad('p99', 12)}max
${'─'.repeat(78)}
`);

for (const r of TABLE) {
  process.stdout.write(
    `${pad(r.name, 26)}${pad(us(r.p50_us), 12)}${pad(us(r.p95_us), 12)}${pad(us(r.p99_us), 12)}${us(r.max_us)}\n` +
      `  n = ${r.n}, ${r.unit}\n\n`,
  );
}

process.stdout.write(`
Frame budget at ${FPS} fps: ${FRAME_BUDGET_MS.toFixed(2)} ms.
The per-frame DSP path at p95 uses ${budgetShareP95.toFixed(2)} % of it — ${headroom.toFixed(0)}× headroom.
That headroom is the whole reason the DSP is not the constraint: the cost of a
frame is \`FaceLandmarker\` inference, and everything measured above is noise
beside it.

Machine  ${machine.cpu}, ${machine.cores} cores, ${machine.platform}/${machine.arch}, node ${machine.node}
         Timings are machine-dependent by definition. The counts above are not.
`);
