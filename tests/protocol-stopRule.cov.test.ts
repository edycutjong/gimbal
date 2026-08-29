import { describe, it, expect } from 'vitest';
import { evaluateStopRule, stopRuleSentence, stopRuleHeading } from '../src/protocol/stopRule.ts';
import { testCard } from './helpers.ts';

const card = testCard({ baselineRise: 3, absoluteCeiling: 7 });

describe('stopRuleSentence — the printed ruling carries the card’s own numbers', () => {
  it('names the absolute ceiling when the rating reached it', () => {
    expect(evaluateStopRule(6, 7, card)).toBe('end-session');
    expect(stopRuleSentence('end-session', 6, 7, card)).toBe(
      'Your rating of 7 reached the absolute ceiling of 7 your clinician wrote down. Session ended. Tell your PT about this.',
    );
  });

  it('prefers the ceiling sentence when the rating is above the ceiling and the rise limit too', () => {
    expect(evaluateStopRule(2, 10, card)).toBe('end-session');
    expect(stopRuleSentence('end-session', 2, 10, card)).toBe(
      'Your rating of 10 reached the absolute ceiling of 7 your clinician wrote down. Session ended. Tell your PT about this.',
    );
  });

  it('names the rise limit when the session ended below the ceiling', () => {
    expect(evaluateStopRule(2, 5, card)).toBe('end-session');
    expect(stopRuleSentence('end-session', 2, 5, card)).toBe(
      'Your rating rose 3 points above your baseline of 2, reaching the rise limit of 3 your clinician wrote down. Session ended. Tell your PT about this.',
    );
  });

  it('writes "point" singular when a one-point rise is itself the rise limit', () => {
    const strict = testCard({ baselineRise: 1, absoluteCeiling: 10 });
    expect(evaluateStopRule(3, 4, strict)).toBe('end-session');
    expect(stopRuleSentence('end-session', 3, 4, strict)).toBe(
      'Your rating rose 1 point above your baseline of 3, reaching the rise limit of 1 your clinician wrote down. Session ended. Tell your PT about this.',
    );
  });

  it('writes "point" singular for a one-point rest', () => {
    expect(evaluateStopRule(2, 3, card)).toBe('rest');
    expect(stopRuleSentence('rest', 2, 3, card)).toBe(
      'Your rating rose 1 point above your baseline of 2, below the rise limit of 3. Rest before the next block.',
    );
  });

  it('writes "points" plural for a two-point rest', () => {
    expect(evaluateStopRule(2, 4, card)).toBe('rest');
    expect(stopRuleSentence('rest', 2, 4, card)).toBe(
      'Your rating rose 2 points above your baseline of 2, below the rise limit of 3. Rest before the next block.',
    );
  });

  it('names only the baseline when continuing', () => {
    expect(evaluateStopRule(4, 4, card)).toBe('continue');
    expect(stopRuleSentence('continue', 4, 4, card)).toBe(
      'Your rating is at or below your baseline of 4. Next block.',
    );
    expect(stopRuleSentence('continue', 4, 1, card)).toBe(
      'Your rating is at or below your baseline of 4. Next block.',
    );
  });

  it('reads the thresholds from the card, not from the module', () => {
    const lenient = testCard({ baselineRise: 6, absoluteCeiling: 9 });
    expect(stopRuleSentence('end-session', 0, 9, lenient)).toContain('absolute ceiling of 9');
    expect(stopRuleSentence('end-session', 2, 8, lenient)).toContain('rise limit of 6');
    expect(stopRuleSentence('rest', 2, 4, lenient)).toContain('below the rise limit of 6');
  });

  it('states the rise limit sentence for every rise-triggered end across the grid', () => {
    for (let baseline = 0; baseline <= 10; baseline++) {
      for (let current = 0; current <= 10; current++) {
        if (evaluateStopRule(baseline, current, card) !== 'end-session') continue;
        const sentence = stopRuleSentence('end-session', baseline, current, card);
        if (current >= 7) {
          expect(sentence).toContain('absolute ceiling of 7');
        } else {
          expect(sentence).toContain('rise limit of 3');
        }
        expect(sentence.endsWith('Session ended. Tell your PT about this.')).toBe(true);
      }
    }
  });
});

describe('stopRuleHeading', () => {
  it('gives one short heading per outcome', () => {
    expect(stopRuleHeading('continue')).toBe('Next block');
    expect(stopRuleHeading('rest')).toBe('Rest before the next block');
    expect(stopRuleHeading('end-session')).toBe('Session ended');
  });

  it('never returns an empty heading for any outcome reachable from the grid', () => {
    const headings = new Set<string>();
    for (let baseline = 0; baseline <= 10; baseline++) {
      for (let current = 0; current <= 10; current++) {
        const heading = stopRuleHeading(evaluateStopRule(baseline, current, card));
        expect(heading.length).toBeGreaterThan(0);
        headings.add(heading);
      }
    }
    expect(headings.size).toBe(3);
  });
});
