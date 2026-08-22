import type { ProtocolCard } from './card.ts';

/**
 * The symptom stop rule.
 *
 * A pure function over (baseline, current, card). Both magnitudes come from the
 * card — Gimbal supplies neither. The only constant this module contains is
 * ZERO, and zero is not a magnitude: "the rating went up at all" is a direction,
 * not a threshold someone had to choose.
 *
 * Ending on symptom provocation is the clinically correct behaviour, so here the
 * cheap implementation and the correct one coincide. There is no override and no
 * streak to protect.
 */
export type StopRuleOutcome = 'continue' | 'rest' | 'end-session';

export function evaluateStopRule(baseline: number, current: number, card: ProtocolCard): StopRuleOutcome {
  const rise = current - baseline;
  if (current >= card.symptomStopRule.absoluteCeiling.value) return 'end-session';
  if (rise >= card.symptomStopRule.baselineRise.value) return 'end-session';
  if (rise > 0) return 'rest';
  return 'continue';
}

/** The sentence printed beside the ruling, with the card's own numbers in it. */
export function stopRuleSentence(outcome: StopRuleOutcome, baseline: number, current: number, card: ProtocolCard): string {
  const rise = current - baseline;
  const riseThreshold = card.symptomStopRule.baselineRise.value;
  const ceiling = card.symptomStopRule.absoluteCeiling.value;
  switch (outcome) {
    case 'end-session':
      if (current >= ceiling) {
        return `Your rating of ${current} reached the absolute ceiling of ${ceiling} your clinician wrote down. Session ended. Tell your PT about this.`;
      }
      return `Your rating rose ${rise} point${rise === 1 ? '' : 's'} above your baseline of ${baseline}, reaching the rise limit of ${riseThreshold} your clinician wrote down. Session ended. Tell your PT about this.`;
    case 'rest':
      return `Your rating rose ${rise} point${rise === 1 ? '' : 's'} above your baseline of ${baseline}, below the rise limit of ${riseThreshold}. Rest before the next block.`;
    case 'continue':
      return `Your rating is at or below your baseline of ${baseline}. Next block.`;
  }
}

export function stopRuleHeading(outcome: StopRuleOutcome): string {
  switch (outcome) {
    case 'continue':
      return 'Next block';
    case 'rest':
      return 'Rest before the next block';
    case 'end-session':
      return 'Session ended';
  }
}
