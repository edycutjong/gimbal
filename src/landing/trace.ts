import { cardFromDraft, type ProtocolCard } from '../protocol/card.ts';
import { exampleDraft } from '../protocol/exampleParameters.ts';
import { scoreCycle } from '../dsp/score.ts';
import { INSTRUMENT_LIMITS } from '../dsp/limits.ts';
import { FIT_RESIDUAL_TOLERANCE } from '../dsp/quality.ts';
import { centralDifferenceGain, peakOmegaFor } from '../dsp/velocity.ts';
import { refusalSentence } from '../ui/copy.ts';
import { ALL_OUTCOMES, type Cycle, type CycleOutcome, type ScoredCycle } from '../dsp/types.ts';

/**
 * The trace behind the landing page's replay.
 *
 * WHAT IT IS AND IS NOT. It is a scripted series of ten cycles, and the page
 * says so in a permanent label beside it. It is NOT a measurement, and nothing
 * on the landing page presents it as one.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * NOTHING IN THIS FILE IS A NUMBER SOMEBODY CHOSE BY EYE ANY MORE.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * It used to be ten peak velocities and ten quality values written by hand, and
 * that was already the weakest sentence in the module — a page whose whole claim
 * is "the verdicts are not written here" was still writing the inputs here.
 *
 * The ten cycles are now built from THE SIX DRIVES `scripts/bench.mjs` ASSERTS
 * END-TO-END. Same amplitudes, same frequencies, same derivation of the
 * confidence target — `npm run bench` pushes each of them through the real
 * `VelocityStream`, `frameQuality`, `CycleSegmenter` and `scoreCycle` and exits
 * non-zero unless every cycle reaches exactly the outcome its drive is named
 * for. So the illustration on `/` and the benchmark in CI are now provably about
 * the same six inputs, and a reader who does not trust the picture can run the
 * command that checks it.
 *
 * WHAT IS STILL DIFFERENT FROM THE BENCH, STATED RATHER THAN GLOSSED. The bench
 * drives an analytic yaw SERIES through the segmenter, which is what produces a
 * `Cycle`. This module constructs the `Cycle` the drive would produce — its peak
 * from `peakOmegaFor(f, A)`, its central-difference under-read from the shipped
 * `centralDifferenceGain`, its confidence from the same `FIT_RESIDUAL_TOLERANCE`
 * arithmetic — and hands that to `scoreCycle`. It is the same input arriving one
 * stage later, and it is done that way because a landing page cannot ship a
 * 1800-frame drive per outcome to draw a ten-cell strip.
 *
 * THE VERDICTS ARE STILL NOT WRITTEN HERE. Each cycle goes to `scoreCycle` — the
 * same pure function the 30 Hz loop calls — with the same `INSTRUMENT_LIMITS`,
 * against a card built from the same eight numbers the README publishes. The
 * refusal sentences come from `refusalSentence` in `src/ui/copy.ts`, so the words
 * on this page are the words on the instrument. Change the velocity floor and
 * this illustration changes with it; change the scoring rule and it changes with
 * that too.
 *
 * Everything below is deterministic. There is no randomness anywhere in this
 * module, which is why two people watching the page see the same thing and can
 * talk about "the third rep".
 */

/* ── The drive constants, taken from scripts/bench.mjs ────────────────────── */

/** The frame rate every drive in the benchmark is sampled at. */
const FPS = 30;

/** The centre of the example card's 1.7–2.3 Hz band. */
const DRIVE_HZ = 2.0;

/** 2π·2.0·20 = 251.3 °/s — inside the card's [150, 350] window. */
const AMPLITUDE_DEG = 20;

/** 2π·2.0·8 = 100.5 °/s — below the floor, and well above the 22.5 °/s deadband,
 *  so the sweep is DETECTED and then REFUSED rather than lost. */
const LAZY_AMPLITUDE_DEG = 8;

/** 2π·2.0·30 = 377.0 °/s — above the 350 °/s ceiling, below the 655.34 °/s
 *  quantisation limit. */
const FAST_AMPLITUDE_DEG = 30;

/** The right velocity at the wrong tempo: 2π·1.2·30 = 226.2 °/s is comfortably
 *  inside [150, 350], so velocity cannot be the cause, while 1.2 Hz is outside
 *  [1.7, 2.3]. `off-cadence` is last in `REASON_PRECEDENCE`, so it is only
 *  reachable when every check above it passes — which is what this arranges. */
const OFF_CADENCE_HZ = 1.2;

/**
 * A well-conditioned rigid fit, and the confidence it implies.
 *
 *   q_fit = 1 − fitResidual / FIT_RESIDUAL_TOLERANCE      (src/dsp/quality.ts)
 *
 * The bench draws its residual from 0.004–0.006; this is that band's midpoint,
 * so `WELL_CONDITIONED_Q` is 0.9 — DERIVED from the shipped tolerance rather
 * than typed, which is the same discipline the bench applies to its own
 * constants.
 */
const WELL_CONDITIONED_FIT_RESIDUAL = 0.005;
const WELL_CONDITIONED_Q = 1 - WELL_CONDITIONED_FIT_RESIDUAL / FIT_RESIDUAL_TOLERANCE;

/**
 * The doubted cycle, sized against the constants rather than guessed: three
 * quarters of the confidence floor. Far enough under to be unambiguous, far
 * enough above zero that it is a DEGRADED measurement rather than an absent one
 * — which is the distinction between `low-confidence` and `face-lost`.
 *
 * `qFloor` is one of the two `PROVISIONAL_FROM_SPIKE` values in
 * `src/dsp/limits.ts`, so a literal 0.41 here would silently stop illustrating
 * anything on the day that threshold is calibrated.
 */
const LOW_CONFIDENCE_Q = INSTRUMENT_LIMITS.qFloor * 0.75;

/** The instrument saw nothing, so it has no confidence at all — not a low one. */
const FACE_LOST_Q = 0;

/* ── The six drives ───────────────────────────────────────────────────────── */

interface Drive {
  outcome: CycleOutcome;
  amplitudeDeg: number;
  hz: number;
  qMin: number;
  faceLost: boolean;
}

const DRIVES: Record<CycleOutcome, Drive> = {
  ok: { outcome: 'ok', amplitudeDeg: AMPLITUDE_DEG, hz: DRIVE_HZ, qMin: WELL_CONDITIONED_Q, faceLost: false },
  'too-slow': {
    outcome: 'too-slow',
    amplitudeDeg: LAZY_AMPLITUDE_DEG,
    hz: DRIVE_HZ,
    qMin: WELL_CONDITIONED_Q,
    faceLost: false,
  },
  'too-fast': {
    outcome: 'too-fast',
    amplitudeDeg: FAST_AMPLITUDE_DEG,
    hz: DRIVE_HZ,
    qMin: WELL_CONDITIONED_Q,
    faceLost: false,
  },
  'off-cadence': {
    outcome: 'off-cadence',
    amplitudeDeg: FAST_AMPLITUDE_DEG,
    hz: OFF_CADENCE_HZ,
    qMin: WELL_CONDITIONED_Q,
    faceLost: false,
  },
  'low-confidence': {
    outcome: 'low-confidence',
    amplitudeDeg: AMPLITUDE_DEG,
    hz: DRIVE_HZ,
    qMin: LOW_CONFIDENCE_Q,
    faceLost: false,
  },
  'face-lost': {
    outcome: 'face-lost',
    amplitudeDeg: AMPLITUDE_DEG,
    hz: DRIVE_HZ,
    qMin: FACE_LOST_Q,
    faceLost: true,
  },
};

/**
 * TEN CYCLES, IN THE ORDER THE PAGE TELLS THE STORY.
 *
 * Two lazy reps and one over-correction — so THE DOSE NUMERAL DOES NOT MOVE FOR
 * THE FIRST THREE CYCLES, which is the sentence the hero is about and which
 * `tests/landing.test.ts` pins. Then three in the band, where nothing happens
 * and that is the design. Then the three refusals a reader would not think to
 * ask for: wrong tempo at the right speed, a good-looking number the instrument
 * will not vouch for, and the instrument not seeing at all. Then back into the
 * band, with the holes still in the ledger — a refused rep is never
 * retroactively credited.
 *
 * All six outcomes appear, so the selector on `/` can step through the whole
 * gate without a second trace to keep in sync with this one.
 */
const TRACE_ORDER: readonly CycleOutcome[] = [
  'too-slow',
  'too-slow',
  'too-fast',
  'ok',
  'ok',
  'ok',
  'off-cadence',
  'low-confidence',
  'face-lost',
  'ok',
];

export const REPLAY_MS_PER_CYCLE = 1500;

/** 2.0 Hz — the centre of the example card's 1.7–2.3 Hz band. */
const PERIOD_MS = 1000 / DRIVE_HZ;

/**
 * How long one cycle takes ON SCREEN. Real cycles at the band centre last
 * 500 ms; at that speed the refusal sentence would be unreadable, so the replay
 * runs at one third rate and the panel prints the factor rather than hiding it.
 */
export const REPLAY_SLOWDOWN = REPLAY_MS_PER_CYCLE / PERIOD_MS;

export const ILLUSTRATION_CARD: ProtocolCard = cardFromDraft({
  ...exampleDraft(),
  gateAcknowledged: true,
});

export interface TraceCycle {
  index: number;
  /** °/s, exact. Rendered with `peakLabel`; never printed raw. */
  peakOmega: number;
  qMin: number;
  credited: boolean;
  reason: CycleOutcome;
  doseSeconds: number;
  /** Empty for a credited cycle — in-zone is the resting state and says nothing. */
  sentence: string;
  /** Handed straight to `CycleStrip`, the app's own strip renderer. */
  scored: ScoredCycle;
}

/** °/s to the whole degree, exactly as `refusalSentence` rounds it. One rounding
 *  rule, so the strip tooltip, the transcript and the sentence cannot disagree. */
export function peakLabel(degPerSec: number): string {
  return degPerSec.toFixed(0);
}

function buildCycle(drive: Drive, index: number): TraceCycle {
  const peakOmega = peakOmegaFor(drive.hz, drive.amplitudeDeg);
  const periodMs = 1000 / drive.hz;
  const cycle: Cycle = {
    tStartMs: index * PERIOD_MS,
    tEndMs: index * PERIOD_MS + periodMs,
    periodMs,
    peakOmega,
    // What a 3-point central difference would have REPORTED before the shipped
    // bias correction put it back — from `centralDifferenceGain`, not a literal.
    rawPeakOmega: peakOmega * centralDifferenceGain(drive.hz, 1 / FPS),
    // 30 fps at 2 Hz is 15 samples per cycle, comfortably over nMin = 10.
    sampleCount: Math.round(FPS / drive.hz),
    qMin: drive.qMin,
    qMean: drive.qMin,
    fHat: drive.hz,
    faceLost: drive.faceLost,
    saturated: false,
  };
  const result = scoreCycle(cycle, ILLUSTRATION_CARD, INSTRUMENT_LIMITS);
  return {
    index,
    peakOmega,
    qMin: drive.qMin,
    credited: result.credited,
    reason: result.reason,
    doseSeconds: result.doseSeconds,
    sentence: result.credited ? '' : refusalSentence(result.reason, cycle, ILLUSTRATION_CARD),
    scored: { ...cycle, credited: result.credited, reason: result.reason },
  };
}

export const TRACE: readonly TraceCycle[] = TRACE_ORDER.map((outcome, i) =>
  buildCycle(DRIVES[outcome] as Drive, i),
);

export const CREDITED_COUNT = TRACE.filter((c) => c.credited).length;
export const PRESCRIBED_SECONDS = ILLUSTRATION_CARD.blockSeconds.value;

/** Delivered seconds after the first `n` cycles have committed. */
export function deliveredAfter(n: number): number {
  let total = 0;
  for (let i = 0; i < n && i < TRACE.length; i++) total += (TRACE[i] as TraceCycle).doseSeconds;
  return total;
}

/* ── The selector ─────────────────────────────────────────────────────────── */

/**
 * The gate's six outcomes, in the order `src/dsp/types.ts` declares them, each
 * paired with the first cycle in the trace that REACHED it.
 *
 * `ALL_OUTCOMES` is imported rather than restated, exactly as `bench.mjs` does,
 * so a seventh outcome added to the gate fails the unit test below rather than
 * quietly going unillustrated. And the index is FOUND, not written: it is the
 * position where `scoreCycle` actually returned that reason, so a selector
 * button cannot point at a cycle that no longer produces the outcome on it.
 */
export interface OutcomeStop {
  reason: CycleOutcome;
  index: number;
}

export const OUTCOME_STOPS: readonly OutcomeStop[] = ALL_OUTCOMES.map((reason) => ({
  reason,
  index: TRACE.findIndex((c) => c.reason === reason),
}));

/* ── The narration ────────────────────────────────────────────────────────── */

/**
 * One chapter per OUTCOME, not per index range.
 *
 * The chapter used to be keyed on "cycle 0 through 2", which meant the narration
 * and the trace had to be kept in agreement by hand — and they had already
 * drifted once. Keying on the outcome `scoreCycle` returned means the card under
 * the panel describes what is on the dial because it is READ OFF what is on the
 * dial, and reordering the trace cannot desynchronise it.
 *
 * `low-confidence` and `face-lost` get their own copy, and it is not a variation
 * on "refused". They are the two that prove the instrument refuses to EMIT
 * rather than smoothing, which is the answer to the largest technical risk in
 * the project, and collapsing them into a generic refusal would publish the easy
 * half of the argument.
 */
export interface Chapter {
  title: string;
  detail: string;
}

export const CHAPTERS: Record<CycleOutcome, Chapter> = {
  ok: {
    title: 'Inside the band',
    detail:
      'Up to prescribed speed, and nothing happens. The marker holds at the top, the strip grows one solid cell per cycle, one number climbs. There is no celebration, and that is the design.',
  },
  'too-slow': {
    title: 'Below the band',
    detail:
      'A lazy, comfortable turn. The marker snaps off the top and goes slate, the strip takes a hatched hole instead of a block, and the dose numeral does not move.',
  },
  'too-fast': {
    title: 'Above the band',
    detail:
      'Faster is not better. The prescription has a ceiling as well as a floor, and a sweep past it is refused for the same reason a lazy one is: it is not the dose that was written down.',
  },
  'off-cadence': {
    title: 'The right speed, the wrong tempo',
    detail:
      'Peak velocity is squarely inside the band, so velocity cannot be the reason. The oscillation is off the prescribed pacing, and cadence is the last thing checked — everything above it passed.',
  },
  'low-confidence': {
    title: 'The instrument doubts itself',
    detail:
      'Tracking quality fell below the confidence floor. The velocity looked fine — it is refused anyway, because the alternative is publishing a number the instrument cannot stand behind.',
  },
  'face-lost': {
    title: 'The instrument could not see',
    detail:
      'A frame in this cycle returned no face at all, so there is no measurement to judge. Reported ahead of low confidence, and named as an instrument condition rather than as something you did wrong.',
  },
};

export function chapterFor(cycleIndex: number): Chapter {
  const cycle = TRACE[cycleIndex] ?? (TRACE[0] as TraceCycle);
  return CHAPTERS[cycle.reason];
}
