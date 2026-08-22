import type { Cycle, CycleOutcome } from './types.ts';
import { INSTRUMENT_LIMITS, type InstrumentLimits } from './limits.ts';
import type { ProtocolCard } from '../protocol/card.ts';

/**
 * The credit / refusal gate. THIS IS THE PRODUCT.
 *
 * A dose meter that credits everything is a stopwatch. Refused cycles contribute
 * ZERO seconds to dose and paint a labelled gap in the cycle strip.
 *
 * This module embeds no constants. Every CLINICAL threshold reaches it from the
 * card; every INSTRUMENT limit reaches it from `INSTRUMENT_LIMITS`. That is the
 * property `grep -n 'deg/s\|Hz' src/dsp/score.ts` is meant to demonstrate, and
 * it is checked by a unit test rather than believed.
 */

export interface ScoreResult {
  credited: boolean;
  reason: CycleOutcome;
  /** Seconds this cycle contributes to delivered dose. Exactly 0 for every refusal. */
  doseSeconds: number;
}

/**
 * Reason precedence, deterministic when two conditions hold at once:
 *
 *   face-lost > low-confidence > velocity (too-slow / too-fast) > cadence (off-cadence)
 *
 * The order runs from "the instrument could not see" through "the instrument
 * does not trust itself" to "the measurement is good and the motion missed the
 * prescription". Reporting an instrument failure as a patient failure would be
 * the wrong way round, and half of all refusals in practice are instrument
 * conditions.
 */
export const REASON_PRECEDENCE: readonly CycleOutcome[] = [
  'face-lost',
  'low-confidence',
  'too-slow',
  'too-fast',
  'off-cadence',
] as const;

export function scoreCycle(
  cycle: Cycle,
  card: ProtocolCard,
  limits: InstrumentLimits = INSTRUMENT_LIMITS,
): ScoreResult {
  const refuse = (reason: CycleOutcome): ScoreResult => ({ credited: false, reason, doseSeconds: 0 });

  // 1. The instrument could not see.
  if (cycle.faceLost) return refuse('face-lost');

  // 2. The instrument does not trust itself. A saturated cycle is refused, never
  //    clipped — a clipped velocity is a wrong number, and a wrong number is
  //    worse than no number.
  if (cycle.saturated) return refuse('low-confidence');
  if (cycle.qMin < limits.qFloor) return refuse('low-confidence');
  if (cycle.sampleCount < limits.nMin) return refuse('low-confidence');
  if (!Number.isFinite(cycle.peakOmega) || !Number.isFinite(cycle.periodMs) || cycle.periodMs <= 0) {
    return refuse('low-confidence');
  }

  // 3. The measurement is trustworthy; does the motion match the prescription?
  //    Boundary equality at both band edges is CREDITED — a documented
  //    convention, not an accident.
  if (cycle.peakOmega < card.peakVelocityFloor.value) return refuse('too-slow');
  if (cycle.peakOmega > card.peakVelocityCeiling.value) return refuse('too-fast');

  // The instrument's own measurement-validity ceiling. Not clinical, and the
  // report labels it as an instrument limit.
  if (cycle.fHat > limits.maxCycleHz) return refuse('too-fast');

  // 4. Cadence, last: a cycle at the right velocity but the wrong tempo.
  const cycleHz = 1000 / cycle.periodMs;
  const [bandLo, bandHi] = card.frequencyBand.value;
  if (cycleHz < bandLo || cycleHz > bandHi) return refuse('off-cadence');

  return { credited: true, reason: 'ok', doseSeconds: cycle.periodMs / 1000 };
}
