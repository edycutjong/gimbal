#!/usr/bin/env node
/**
 * The DSP frame-budget benchmark.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT THIS MEASURES, AND WHAT IT DOES NOT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * MEASURES: how long the shipped signal-processing path takes to execute, in
 * microseconds, against the 33.33 ms budget one camera frame gets at 30 fps.
 * It is a COMPUTE-COST measurement of pure functions.
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
 * runs on a clean clone, offline, with `npm ci` and nothing else. It is kept out
 * of `npm test` only because a timing assertion in CI is a flaky assertion.
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
import { frameQuality } from '../src/dsp/quality.ts';
import { dominantFrequency, FFT_SIZE } from '../src/dsp/fft.ts';
import { peakAccelFor, peakOmegaFor } from '../src/dsp/velocity.ts';
import { INSTRUMENT_LIMITS, deadbandDegPerSec, minSampleRateHz } from '../src/dsp/limits.ts';
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

function driveSignal(amplitudeDeg) {
  const next = lcg(LCG_SEED);
  const frames = [];
  let tMs = 0;
  for (let i = 0; i < FRAME_COUNT; i++) {
    // ±12 % interval jitter, mean-preserving.
    const dt = NOMINAL_DT_MS * (0.88 + 0.24 * next());
    tMs += dt;
    const tSec = tMs / 1000;
    frames.push({
      tMs,
      dtMs: dt,
      yaw: amplitudeDeg * Math.sin(2 * Math.PI * DRIVE_HZ * tSec),
      // A well-conditioned rigid fit. The orthonormality residual of a real
      // MediaPipe rotation block sits far below the 0.05 tolerance.
      fitResidual: 0.004 + 0.002 * next(),
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
const plausibleAccel = peakAccelFor(DRIVE_HZ, AMPLITUDE_DEG);
const analyticPeakOmega = peakOmegaFor(DRIVE_HZ, AMPLITUDE_DEG);

// ── B1: the whole per-frame path ───────────────────────────────────────────
//
// VelocityStream.push → frameQuality → CycleSegmenter.push → scoreCycle.
// One timed region per frame, exactly the work the 30 Hz capture loop does
// after `FaceLandmarker` hands back a rotation matrix.

function runPipeline(frames, { timed, amplitudeDeg }) {
  const stream = new VelocityStream();
  const segmenter = new CycleSegmenter({
    deadbandDegPerSec: deadbandDegPerSec(card.peakVelocityFloor.value),
    fHat: DRIVE_HZ,
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
        facePresent: true,
        frameIntervalMs: f.dtMs,
        targetIntervalMs,
        fitResidual: f.fitResidual,
        angularAccel: v.accel,
        plausibleAccel: peakAccelFor(DRIVE_HZ, amplitudeDeg),
      });
      const cycle = segmenter.push({ tMs: v.tMs, omega: v.omega, quality: q, facePresent: true });
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
function assert(label, condition, detail) {
  if (!condition) failures.push(`${label}: ${detail}`);
}

const frames = driveSignal(AMPLITUDE_DEG);
const lazyFrames = driveSignal(LAZY_AMPLITUDE_DEG);

// Warm-up. Two full passes of each so the JIT has tiered up before anything is
// timed, and so neither path is measured cold against the other.
for (let i = 0; i < 2; i++) {
  runPipeline(frames, { timed: false, amplitudeDeg: AMPLITUDE_DEG });
  runPipeline(lazyFrames, { timed: false, amplitudeDeg: LAZY_AMPLITUDE_DEG });
}

const run = runPipeline(frames, { timed: true, amplitudeDeg: AMPLITUDE_DEG });
const lazy = runPipeline(lazyFrames, { timed: true, amplitudeDeg: LAZY_AMPLITUDE_DEG });

// 60 s of oscillation at 2.0 Hz is 120 full cycles. The stream withholds its
// first samples (5-point smoother + 3-point difference) and the segmenter needs
// a first sign change to open a cycle, so a small deficit at the head is
// correct — a surplus would mean phantom sweeps, which is the failure the
// hysteresis exists to prevent.
const analyticCycles = SECONDS * DRIVE_HZ;
assert(
  'cycle count',
  run.cycles >= analyticCycles - 3 && run.cycles <= analyticCycles,
  `segmented ${run.cycles}; 2.0 Hz for 60 s is ${analyticCycles} cycles, expected ${analyticCycles - 3}..${analyticCycles}`,
);
assert(
  'credit path exercised',
  run.credited > 0,
  `0 cycles credited — the drive signal must reach the credit path, not only the refusal path`,
);
assert(
  'every cycle credited',
  run.credited === run.cycles,
  // The band membership is COMPUTED, never asserted in prose. Hard-coding
  // "is inside" here printed the self-refuting `100.5 °/s is inside [150, 350]`
  // the moment someone changed the drive amplitude — a diagnostic that lies
  // about the thing it was printed to diagnose is worse than no diagnostic.
  `${run.cycles - run.credited} of ${run.cycles} refused (${JSON.stringify(run.outcomes)}); ` +
    `analytic peak 2π·${DRIVE_HZ}·${AMPLITUDE_DEG} = ${analyticPeakOmega.toFixed(1)} °/s is ` +
    `${
      analyticPeakOmega >= card.peakVelocityFloor.value && analyticPeakOmega <= card.peakVelocityCeiling.value
        ? 'inside'
        : 'OUTSIDE'
    } ` +
    `[${card.peakVelocityFloor.value}, ${card.peakVelocityCeiling.value}] and ${DRIVE_HZ} Hz is ` +
    `${DRIVE_HZ >= card.frequencyBand.value[0] && DRIVE_HZ <= card.frequencyBand.value[1] ? 'inside' : 'OUTSIDE'} ` +
    `[${card.frequencyBand.value.join(', ')}]`,
);
assert(
  'dose accumulates',
  Math.abs(run.doseSeconds - run.cycles / DRIVE_HZ) < 1.0,
  `delivered dose ${run.doseSeconds.toFixed(3)} s; ${run.cycles} cycles at ${DRIVE_HZ} Hz is ~${(run.cycles / DRIVE_HZ).toFixed(3)} s`,
);

// ── The refusal path, asserted mechanically ────────────────────────────────
//
// THIS IS THE PRODUCT CLAIM, checked without a camera: the same tempo at a
// visibly smaller sweep must be detected, refused by name, and contribute
// EXACTLY 0.000 s of dose. Not "approximately zero" — zero.
const lazyPeakOmega = peakOmegaFor(DRIVE_HZ, LAZY_AMPLITUDE_DEG);
assert(
  'lazy reps are still detected',
  lazy.cycles >= analyticCycles - 3 && lazy.cycles <= analyticCycles,
  `segmented ${lazy.cycles} lazy cycles; expected ${analyticCycles - 3}..${analyticCycles}. ` +
    `Peak ${lazyPeakOmega.toFixed(1)} °/s must clear the ${deadbandDegPerSec(card.peakVelocityFloor.value).toFixed(1)} °/s deadband`,
);
assert(
  'every lazy rep is refused too-slow',
  lazy.credited === 0 && lazy.outcomes['too-slow'] === lazy.cycles,
  `${lazy.credited} credited, outcomes ${JSON.stringify(lazy.outcomes)}; ` +
    `${lazyPeakOmega.toFixed(1)} °/s is below the card's ${card.peakVelocityFloor.value} °/s floor`,
);
assert(
  'a refused rep contributes exactly zero dose',
  lazy.doseSeconds === 0,
  `delivered dose is ${lazy.doseSeconds}, not exactly 0`,
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

const b1 = summarise('per-frame, credited', 'one camera frame: stream → quality → segmenter → gate', run.perFrameUs);
const b1b = summarise('per-frame, refused', 'same path, every cycle refused too-slow', lazy.perFrameUs);
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
        what: 'compute cost of the shipped DSP pipeline. NOT an accuracy figure and NOT the bench-agreement measurement, which does not exist.',
        drive: {
          seed: LCG_SEED,
          fps: FPS,
          frequency_hz: DRIVE_HZ,
          amplitude_deg: AMPLITUDE_DEG,
          lazy_amplitude_deg: LAZY_AMPLITUDE_DEG,
          seconds: SECONDS,
          frames: FRAME_COUNT,
          interval_jitter_pct: 12,
        },
        correctness: {
          therapeutic: {
            peak_omega_deg_per_s: Number(analyticPeakOmega.toFixed(1)),
            cycles: run.cycles,
            credited: run.credited,
            outcomes: run.outcomes,
            delivered_dose_s: Number(run.doseSeconds.toFixed(3)),
          },
          sub_therapeutic: {
            peak_omega_deg_per_s: Number(lazyPeakOmega.toFixed(1)),
            cycles: lazy.cycles,
            credited: lazy.credited,
            outcomes: lazy.outcomes,
            delivered_dose_s: lazy.doseSeconds,
          },
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

Drive signal   ${DRIVE_HZ.toFixed(1)} Hz yaw, ${SECONDS} s, ${FRAME_COUNT} frames at ${FPS} fps, two amplitudes
               ±12 % frame-interval jitter, LCG seed ${LCG_SEED} (deterministic)
Card           public/cards/demo-vorx1-yaw-seated.json — band ${card.frequencyBand.value.join('–')} Hz,
               velocity ${card.peakVelocityFloor.value}–${card.peakVelocityCeiling.value} °/s

Correctness gate — asserted before any timing was printed, and the reason these
timings mean something. A pipeline returning early would post a beautiful p95.

  THERAPEUTIC  ±${AMPLITUDE_DEG}° → 2π·${DRIVE_HZ}·${AMPLITUDE_DEG} = ${analyticPeakOmega.toFixed(1)} °/s, inside [${card.peakVelocityFloor.value}, ${card.peakVelocityCeiling.value}]
  ✓ ${pad(`${run.cycles} cycles segmented`, 32)} ${DRIVE_HZ} Hz × ${SECONDS} s = ${analyticCycles} analytic
  ✓ ${pad(`${run.credited} credited, 0 refused`, 32)} outcomes ${JSON.stringify(run.outcomes)}
  ✓ ${pad(`${run.doseSeconds.toFixed(3)} s delivered dose`, 32)} ${run.cycles} cycles ÷ ${DRIVE_HZ} Hz

  SUB-THERAPEUTIC  ±${LAZY_AMPLITUDE_DEG}° → ${lazyPeakOmega.toFixed(1)} °/s, below the ${card.peakVelocityFloor.value} °/s floor
  ✓ ${pad(`${lazy.cycles} cycles segmented`, 32)} detected, not lost — deadband is ${deadbandDegPerSec(card.peakVelocityFloor.value).toFixed(1)} °/s
  ✓ ${pad(`0 credited, ${lazy.cycles} refused too-slow`, 32)} outcomes ${JSON.stringify(lazy.outcomes)}
  ✓ ${pad(`${lazy.doseSeconds.toFixed(3)} s delivered dose`, 32)} exactly zero, not approximately

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
