/**
 * Landolt C 4AFC trials — proving gaze WITHOUT measuring gaze.
 *
 * This is the key design move of the project, and it is a deliberate refusal of
 * a measurement. Webcam iris tracking at the accuracy needed to verify fixation
 * during ~250 °/s head motion is not a solved problem on commodity hardware: the
 * iris subtends a few pixels at 640×480, motion blur smears it across several,
 * and any error is confounded with the head rotation being measured.
 *
 * So Gimbal asks a BEHAVIOURAL question whose correct answer is only obtainable
 * if the eyes were on the target: a visual discrimination the patient cannot
 * perform unless they were fixating.
 *
 * What is NOT claimed: no logMAR, no dynamic-visual-acuity score, no acuity
 * figure of any kind. That would require a measured viewing distance and a known
 * display pixel pitch, and the browser reliably supplies neither. The task FORM
 * is borrowed from the dynamic-visual-acuity test used in vestibular
 * rehabilitation; the SCORE is not, and the report says so in print.
 */

/** Gap orientation. Index maps spatially to the arrow key that answers it. */
export type GapOrientation = 0 | 1 | 2 | 3;

/** 0 = right, 1 = down, 2 = left, 3 = up — the order the arrow keys map onto. */
export const ORIENTATIONS: readonly GapOrientation[] = [0, 1, 2, 3];

export const ORIENTATION_KEYS: Record<string, GapOrientation> = {
  ArrowRight: 0,
  ArrowDown: 1,
  ArrowLeft: 2,
  ArrowUp: 3,
};

/** Deliberately incommensurate with the ~0.5 s cycle period, so no presentation can be phase-locked. */
export const MIN_INTERVAL_MS = 2500;
export const MAX_INTERVAL_MS = 5000;

/** Spans ~5 cycles at 2 Hz. The task is "were you fixating during this stretch of motion". */
export const RESPONSE_WINDOW_MS = 2500;

/** Chance rate of a 4-alternative forced choice. */
export const CHANCE = 0.25;

export interface GazeTrial {
  tMs: number;
  shown: GapOrientation;
  answered: GapOrientation | null;
  correct: boolean;
}

/**
 * Uniform over the four orientations, with ONE constraint: the same orientation
 * never repeats consecutively.
 *
 * Without it, "hold the last answer" is a viable cheat that would drift the
 * tally upward with zero fixation. The constraint costs one comparison and
 * closes the loophole.
 */
export function nextOrientation(previous: GapOrientation | null, rand: () => number = Math.random): GapOrientation {
  if (previous === null) return Math.floor(rand() * 4) as GapOrientation;
  const choices = ORIENTATIONS.filter((o) => o !== previous);
  return choices[Math.floor(rand() * choices.length)] as GapOrientation;
}

/** Uniform in [2.5, 5.0] s. */
export function nextIntervalMs(rand: () => number = Math.random): number {
  return MIN_INTERVAL_MS + rand() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
}

/**
 * Streaming trial scheduler. The block loop calls `tick` once per frame; the
 * scheduler decides when a new C is shown and when a response window closes.
 */
export class TrialScheduler {
  readonly trials: GazeTrial[] = [];
  private current: GapOrientation | null = null;
  private shownAtMs = -Infinity;
  private nextAtMs: number;
  private awaitingResponse = false;

  constructor(
    startMs: number,
    private readonly rand: () => number = Math.random,
  ) {
    this.nextAtMs = startMs + nextIntervalMs(rand);
  }

  /** The orientation currently rendered, or `null` before the first presentation. */
  get shown(): GapOrientation | null {
    return this.current;
  }

  /** True while the 2.5 s response window is open — the C is drawn at full contrast. */
  get windowOpen(): boolean {
    return this.awaitingResponse;
  }

  /** Returns `'present'` on the frame a new C appears, `'timeout'` when a window closes unanswered. */
  tick(nowMs: number): 'present' | 'timeout' | null {
    if (this.awaitingResponse && nowMs - this.shownAtMs >= RESPONSE_WINDOW_MS) {
      // A response after 2.5 s is scored a MISS, not discarded.
      this.trials.push({ tMs: this.shownAtMs, shown: this.current as GapOrientation, answered: null, correct: false });
      this.awaitingResponse = false;
      return 'timeout';
    }
    if (!this.awaitingResponse && nowMs >= this.nextAtMs) {
      this.current = nextOrientation(this.current, this.rand);
      this.shownAtMs = nowMs;
      this.awaitingResponse = true;
      this.nextAtMs = nowMs + RESPONSE_WINDOW_MS + nextIntervalMs(this.rand);
      return 'present';
    }
    return null;
  }

  /** Records an arrow-key answer. Returns whether it was accepted (a window was open). */
  answer(orientation: GapOrientation, nowMs: number): boolean {
    if (!this.awaitingResponse) return false;
    if (nowMs - this.shownAtMs > RESPONSE_WINDOW_MS) return false;
    const shown = this.current as GapOrientation;
    this.trials.push({ tMs: this.shownAtMs, shown, answered: orientation, correct: orientation === shown });
    this.awaitingResponse = false;
    return true;
  }

  tally(): { correct: number; total: number; chance: number } {
    return {
      correct: this.trials.filter((t) => t.correct).length,
      total: this.trials.length,
      chance: CHANCE,
    };
  }
}

/**
 * One-sided exact binomial test against p = 0.25 — P(X ≥ k | n, p).
 *
 * A tally is reported as a count, and the report annotates a block
 * "gaze verification not demonstrated for this block" when the tally is not
 * distinguishable from guessing. The dose STANDS either way: a wrong or missed
 * response refuses no cycle and reduces no dose. The tally is strictly
 * block-level, because a 2.5 s window spans ~5 cycles and there is no defensible
 * mapping from one response to one cycle.
 */
export function binomialTailP(correct: number, total: number, p = CHANCE): number {
  if (total <= 0) return 1;
  const k = Math.max(0, Math.min(total, correct));
  let acc = 0;
  for (let i = k; i <= total; i++) acc += Math.exp(logChoose(total, i) + i * Math.log(p) + (total - i) * Math.log(1 - p));
  return Math.min(1, Math.max(0, acc));
}

function logChoose(n: number, k: number): number {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/** Lanczos approximation — accurate well past the block sizes this ever sees. */
function logGamma(z: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  const x = z - 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < g.length; i++) a += (g[i] as number) / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** The conventional 0.05 cut. Stated as the cut it is, not dressed up as a clinical threshold. */
export const ALPHA = 0.05;

export function gazeDemonstrated(correct: number, total: number): boolean {
  return total > 0 && binomialTailP(correct, total) < ALPHA;
}
