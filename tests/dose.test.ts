import { describe, it, expect } from 'vitest';
import { DoseAccumulator, elapsedExcludingPauses, pauseSummary } from '../src/session/dose.ts';
import { scoreCycle } from '../src/dsp/score.ts';
import type { ScoredCycle } from '../src/dsp/types.ts';
import { testCard, testCycle } from './helpers.ts';

const card = testCard();

function scored(overrides: Parameters<typeof testCycle>[0] = {}): ScoredCycle {
  const c = testCycle(overrides);
  const r = scoreCycle(c, card);
  return { ...c, credited: r.credited, reason: r.reason };
}

describe('dose accumulation', () => {
  it('adds exactly 0.000 s for a refused cycle', () => {
    const acc = new DoseAccumulator();
    acc.add(scored({ peakOmega: 80 }));
    acc.add(scored({ faceLost: true }));
    acc.add(scored({ qMin: 0 }));
    expect(acc.deliveredSeconds).toBe(0);
    expect(acc.refused).toBe(3);
    expect(acc.credited).toBe(0);
  });

  it('credits a cycle its own period, so dose is a count and nothing else', () => {
    const acc = new DoseAccumulator();
    for (let i = 0; i < 10; i++) acc.add(scored());
    expect(acc.deliveredSeconds).toBeCloseTo(5.0, 9);
    expect(acc.credited).toBe(10);
  });

  it('excludes a paused interval from block elapsed time', () => {
    const acc = new DoseAccumulator();
    acc.recordPause(30, 12_000);
    expect(elapsedExcludingPauses(120_000, acc.interruptions)).toBe(108_000);
    expect(pauseSummary(acc.interruptions)).toBe('paused 1× (12 s)');
    expect(pauseSummary([])).toBeNull();
  });

  it('lets an interrupted block keep its credited cycles', () => {
    const acc = new DoseAccumulator();
    for (let i = 0; i < 4; i++) acc.add(scored());
    acc.recordInterrupt(42);
    expect(acc.interrupted).toBe(true);
    expect(acc.deliveredSeconds).toBeCloseTo(2.0, 9);
  });

  it('sums refusals to attempted − credited, over five reasons and never negative', () => {
    const acc = new DoseAccumulator();
    acc.add(scored());
    acc.add(scored({ peakOmega: 80 }));
    acc.add(scored({ peakOmega: 999 }));
    acc.add(scored({ periodMs: 900 }));
    acc.add(scored({ qMin: 0 }));
    acc.add(scored({ faceLost: true }));
    const refusals = acc.refusals();
    expect(Object.keys(refusals).length).toBe(5);
    const total = Object.values(refusals).reduce((a, b) => a + b, 0);
    expect(total).toBe(acc.attempted - acc.credited);
    expect(acc.deliveredSeconds).toBeGreaterThanOrEqual(0);
  });
});
