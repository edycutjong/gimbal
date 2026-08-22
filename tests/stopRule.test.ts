import { describe, it, expect } from 'vitest';
import stopRuleSource from '../src/protocol/stopRule.ts?raw';
import { evaluateStopRule, type StopRuleOutcome } from '../src/protocol/stopRule.ts';
import { testCard } from './helpers.ts';

const card = testCard({ baselineRise: 3, absoluteCeiling: 7 });
const GRID = Array.from({ length: 11 }, (_, i) => i);

describe('evaluateStopRule — exhaustive over the 0–10 × 0–10 integer grid', () => {
  it('returns exactly one of the three outcomes for every cell', () => {
    const seen = new Set<StopRuleOutcome>();
    for (const baseline of GRID) {
      for (const current of GRID) {
        const out = evaluateStopRule(baseline, current, card);
        expect(['continue', 'rest', 'end-session']).toContain(out);
        seen.add(out);
      }
    }
    expect(seen.size).toBe(3);
  });

  it('partitions the grid with no gap and no overlap', () => {
    for (const baseline of GRID) {
      for (const current of GRID) {
        const rise = current - baseline;
        const isEnd = current >= 7 || rise >= 3;
        const isRest = !isEnd && rise > 0;
        const isContinue = !isEnd && rise <= 0;
        expect(Number(isEnd) + Number(isRest) + Number(isContinue)).toBe(1);
        const expected: StopRuleOutcome = isEnd ? 'end-session' : isRest ? 'rest' : 'continue';
        expect(evaluateStopRule(baseline, current, card)).toBe(expected);
      }
    }
  });

  it('ends the session at the absolute ceiling', () => {
    expect(evaluateStopRule(6, 7, card)).toBe('end-session');
    expect(evaluateStopRule(0, 7, card)).toBe('end-session');
  });

  it('ends the session at the baseline-rise limit', () => {
    expect(evaluateStopRule(2, 5, card)).toBe('end-session');
    expect(evaluateStopRule(2, 4, card)).toBe('rest');
  });

  it('rests on any rise below the limit', () => {
    expect(evaluateStopRule(2, 3, card)).toBe('rest');
  });

  it('continues when the rating is at or below baseline', () => {
    expect(evaluateStopRule(4, 4, card)).toBe('continue');
    expect(evaluateStopRule(4, 1, card)).toBe('continue');
  });

  it('reads both thresholds from the card — a different card changes the outcome', () => {
    const lenient = testCard({ baselineRise: 6, absoluteCeiling: 10 });
    expect(evaluateStopRule(2, 5, card)).toBe('end-session');
    expect(evaluateStopRule(2, 5, lenient)).toBe('rest');
  });

  it('contains no magnitude of its own — the only constant in the module is zero', () => {
    const fn = stopRuleSource.slice(
      stopRuleSource.indexOf('export function evaluateStopRule'),
      stopRuleSource.indexOf('/** The sentence printed'),
    );
    const numerals = fn.match(/(?<![\w.])\d+(?:\.\d+)?/g) ?? [];
    for (const n of numerals) expect(n).toBe('0');
  });
});
