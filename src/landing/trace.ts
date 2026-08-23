import { cardFromDraft, type ProtocolCard } from '../protocol/card.ts';
import { exampleDraft } from '../protocol/exampleParameters.ts';
import { scoreCycle } from '../dsp/score.ts';
import { INSTRUMENT_LIMITS } from '../dsp/limits.ts';
import { refusalSentence } from '../ui/copy.ts';
import type { Cycle, CycleOutcome, ScoredCycle } from '../dsp/types.ts';

/**
 * The trace behind the landing page's replay.
 *
 * WHAT IT IS AND IS NOT. It is a scripted series of ten cycles — ten peak
 * velocities and ten tracking-quality values, written by hand — and the page
 * says so in a permanent label beside it. It is NOT a measurement, and nothing
 * on the landing page presents it as one.
 *
 * What makes it a faithful drawing of the mechanism rather than an artist's
 * impression is that THE VERDICTS ARE NOT WRITTEN HERE. Each cycle is handed to
 * `scoreCycle` — the same pure function the 30 Hz loop calls — with the same
 * `INSTRUMENT_LIMITS`, against a card built from the same eight numbers the
 * README publishes. The refusal sentences come from `refusalSentence` in
 * `src/ui/copy.ts`, so the words on this page are the words on the instrument.
 * Change the velocity floor and this illustration changes with it; change the
 * scoring rule and it changes with that too.
 *
 * Everything below is deterministic. There is no randomness anywhere in this
 * module, which is why two people watching the page see the same thing and can
 * talk about "the third rep".
 */

/** Peak |ω| in °/s and the cycle-minimum tracking quality, per cycle. */
interface TraceInput {
  peakOmega: number;
  qMin: number;
}

/**
 * Ten cycles, in the order the page tells the story: three below the floor, four
 * inside the band, one the instrument declines to stand behind, then two more
 * inside the band.
 */
const TRACE_INPUTS: readonly TraceInput[] = [
  { peakOmega: 91, qMin: 0.91 },
  { peakOmega: 88, qMin: 0.93 },
  { peakOmega: 104, qMin: 0.9 },
  { peakOmega: 168, qMin: 0.89 },
  { peakOmega: 214, qMin: 0.92 },
  { peakOmega: 246, qMin: 0.91 },
  { peakOmega: 233, qMin: 0.88 },
  // Below `qFloor` (0.55). The velocity here is squarely inside the band — the
  // point of this cycle is that a good-looking number gets thrown away anyway.
  { peakOmega: 251, qMin: 0.38 },
  { peakOmega: 244, qMin: 0.9 },
  { peakOmega: 229, qMin: 0.9 },
];

/** 2.0 Hz — the centre of the example card's 1.7–2.3 Hz band. */
const PERIOD_MS = 500;

/**
 * How long one cycle takes ON SCREEN. Real cycles last 500 ms; at that speed the
 * refusal sentence would be unreadable, so the replay runs at one third rate and
 * the panel prints the factor rather than hiding it.
 */
export const REPLAY_MS_PER_CYCLE = 1500;
export const REPLAY_SLOWDOWN = REPLAY_MS_PER_CYCLE / PERIOD_MS;

export const ILLUSTRATION_CARD: ProtocolCard = cardFromDraft({
  ...exampleDraft(),
  gateAcknowledged: true,
});

export interface TraceCycle {
  index: number;
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

function buildCycle(input: TraceInput, index: number): TraceCycle {
  const cycle: Cycle = {
    tStartMs: index * PERIOD_MS,
    tEndMs: (index + 1) * PERIOD_MS,
    periodMs: PERIOD_MS,
    peakOmega: input.peakOmega,
    rawPeakOmega: input.peakOmega / 1.0299,
    // 30 fps at 2 Hz is 15 samples per cycle, comfortably over nMin = 10.
    sampleCount: 15,
    qMin: input.qMin,
    qMean: input.qMin,
    fHat: 2.0,
    faceLost: false,
    saturated: false,
  };
  const result = scoreCycle(cycle, ILLUSTRATION_CARD, INSTRUMENT_LIMITS);
  return {
    index,
    peakOmega: input.peakOmega,
    qMin: input.qMin,
    credited: result.credited,
    reason: result.reason,
    doseSeconds: result.doseSeconds,
    sentence: result.credited ? '' : refusalSentence(result.reason, cycle, ILLUSTRATION_CARD),
    scored: { ...cycle, credited: result.credited, reason: result.reason },
  };
}

export const TRACE: readonly TraceCycle[] = TRACE_INPUTS.map(buildCycle);

export const CREDITED_COUNT = TRACE.filter((c) => c.credited).length;
export const PRESCRIBED_SECONDS = ILLUSTRATION_CARD.blockSeconds.value;

/** Delivered seconds after the first `n` cycles have committed. */
export function deliveredAfter(n: number): number {
  let total = 0;
  for (let i = 0; i < n && i < TRACE.length; i++) total += (TRACE[i] as TraceCycle).doseSeconds;
  return total;
}

/**
 * The three chapters. Each names what the viewer is looking at right now, which
 * is the difference between an animation a judge watches and one a judge
 * understands.
 */
export interface Chapter {
  from: number;
  title: string;
  detail: string;
}

export const CHAPTERS: readonly Chapter[] = [
  {
    from: 0,
    title: 'Below the band',
    detail:
      'A lazy, comfortable turn. The marker snaps off the top and goes slate, the strip takes a hatched hole instead of a block, and the dose numeral does not move.',
  },
  {
    from: 3,
    title: 'Inside the band',
    detail:
      'Up to prescribed speed, and nothing happens. The marker holds at the top, the strip grows one solid cell per cycle, one number climbs. There is no celebration, and that is the design.',
  },
  {
    from: 7,
    title: 'The instrument doubts itself',
    detail:
      'Tracking quality fell below the confidence floor. The velocity looked fine — it is refused anyway, because the alternative is publishing a number the instrument cannot stand behind.',
  },
  {
    from: 8,
    title: 'Inside the band',
    detail:
      'Back to prescribed speed. The hole in the ledger stays where it is: a refused rep is never retroactively credited.',
  },
];

export function chapterFor(cycleIndex: number): Chapter {
  let current = CHAPTERS[0] as Chapter;
  for (const c of CHAPTERS) if (cycleIndex >= c.from) current = c;
  return current;
}
