import { describe, it, expect } from 'vitest';
import { DoseAccumulator, emptyRefusalTally, elapsedExcludingPauses } from '../src/session/dose.ts';
import { scoreCycle } from '../src/dsp/score.ts';
import { ALL_OUTCOMES, REFUSAL_REASONS, type CycleOutcome, type ScoredCycle } from '../src/dsp/types.ts';
import { testCard, testCycle } from './helpers.ts';

const card = testCard();

function scored(overrides: Parameters<typeof testCycle>[0] = {}): ScoredCycle {
  const c = testCycle(overrides);
  const r = scoreCycle(c, card);
  return { ...c, credited: r.credited, reason: r.reason };
}

describe('outcome tally', () => {
  it('starts every one of the six outcomes at zero', () => {
    expect(emptyRefusalTally()).toEqual({
      ok: 0,
      'too-slow': 0,
      'too-fast': 0,
      'off-cadence': 0,
      'low-confidence': 0,
      'face-lost': 0,
    });
    expect(new DoseAccumulator().outcomes()).toEqual(emptyRefusalTally());
  });

  it('counts ok alongside the five refusals, so outcomes sum to attempted', () => {
    const acc = new DoseAccumulator();
    acc.add(scored());
    acc.add(scored());
    acc.add(scored({ peakOmega: 80 })); // below floor 150
    acc.add(scored({ peakOmega: 999 })); // above ceiling 350
    acc.add(scored({ periodMs: 900 })); // 1.11 Hz, below band 1.7
    acc.add(scored({ qMin: 0 })); // below quality floor
    acc.add(scored({ faceLost: true }));

    expect(acc.outcomes()).toEqual({
      ok: 2,
      'too-slow': 1,
      'too-fast': 1,
      'off-cadence': 1,
      'low-confidence': 1,
      'face-lost': 1,
    });
    expect(Object.keys(acc.outcomes()).sort()).toEqual([...ALL_OUTCOMES].sort());
    const total = Object.values(acc.outcomes()).reduce((a, b) => a + b, 0);
    expect(total).toBe(acc.attempted);
    expect(acc.outcomes().ok).toBe(acc.credited);
  });

  it('hands out a copy, so a caller cannot rewrite the tally it was shown', () => {
    const acc = new DoseAccumulator();
    acc.add(scored());
    const snapshot = acc.outcomes();
    snapshot.ok = 999;
    snapshot['face-lost'] = 42;
    expect(acc.outcomes()).toEqual({ ...emptyRefusalTally(), ok: 1 });
    expect(acc.credited).toBe(1);
  });

  it('keeps refusals() consistent with outcomes() minus ok', () => {
    const acc = new DoseAccumulator();
    acc.add(scored());
    acc.add(scored({ faceLost: true }));
    acc.add(scored({ faceLost: true }));
    const outcomes = acc.outcomes();
    const refusals = acc.refusals();
    expect(refusals['face-lost']).toBe(2);
    expect(refusals).toEqual({
      'too-slow': outcomes['too-slow'],
      'too-fast': outcomes['too-fast'],
      'off-cadence': outcomes['off-cadence'],
      'low-confidence': outcomes['low-confidence'],
      'face-lost': outcomes['face-lost'],
    });
    expect('ok' in refusals).toBe(false);
  });

  it('skips ok even when it appears in the reason list it iterates', () => {
    // `refusals()` guards against `ok` reaching its output. REFUSAL_REASONS never
    // carries `ok` today, so the guard is exercised by widening the list the
    // accumulator reads and restoring it immediately afterwards.
    const reasons = REFUSAL_REASONS as CycleOutcome[];
    reasons.unshift('ok');
    try {
      const acc = new DoseAccumulator();
      acc.add(scored());
      acc.add(scored());
      acc.add(scored({ faceLost: true }));
      const refusals = acc.refusals();
      expect('ok' in refusals).toBe(false);
      expect(Object.keys(refusals)).toHaveLength(5);
      expect(refusals['face-lost']).toBe(1);
      expect(Object.values(refusals).reduce((a, b) => a + b, 0)).toBe(acc.attempted - acc.credited);
    } finally {
      reasons.shift();
    }
    expect(REFUSAL_REASONS).not.toContain('ok');
    expect(Object.keys(new DoseAccumulator().refusals())).toHaveLength(5);
  });
});

describe('interruption bookkeeping', () => {
  it('reports zero paused time and no pauses on an untouched block', () => {
    const acc = new DoseAccumulator();
    expect(acc.pausedMs).toBe(0);
    expect(acc.pauseCount).toBe(0);
    expect(acc.interrupted).toBe(false);
  });

  it('sums only pause durations and ignores interrupts entirely', () => {
    const acc = new DoseAccumulator();
    acc.recordPause(10, 4_000);
    acc.recordInterrupt(25);
    acc.recordPause(40, 6_500);
    acc.recordInterrupt(60);

    expect(acc.pauseCount).toBe(2);
    expect(acc.pausedMs).toBe(10_500);
    expect(acc.interrupted).toBe(true);
    expect(acc.interruptions).toHaveLength(4);
    expect(acc.interruptions[1]).toEqual({ kind: 'interrupt', atSeconds: 25, durationMs: 0 });
    expect(acc.interruptions[2]).toEqual({ kind: 'pause', atSeconds: 40, durationMs: 6_500 });
  });

  it('agrees with elapsedExcludingPauses on the same interruption list', () => {
    const acc = new DoseAccumulator();
    acc.recordPause(5, 3_000);
    acc.recordInterrupt(9);
    acc.recordPause(30, 7_000);
    expect(elapsedExcludingPauses(120_000, acc.interruptions)).toBe(120_000 - acc.pausedMs);
  });

  it('leaves pause counters untouched when only an interrupt is recorded', () => {
    const acc = new DoseAccumulator();
    acc.recordInterrupt(12);
    expect(acc.pauseCount).toBe(0);
    expect(acc.pausedMs).toBe(0);
    expect(acc.interrupted).toBe(true);
  });
});

describe('per-cycle readouts', () => {
  it('counts saturated cycles, which are refused rather than clipped', () => {
    const acc = new DoseAccumulator();
    expect(acc.saturatedCycles).toBe(0);

    acc.add(scored());
    acc.add(scored({ saturated: true, peakOmega: 4_000 }));
    acc.add(scored({ saturated: false }));
    acc.add(scored({ saturated: true, peakOmega: 5_000 }));

    expect(acc.saturatedCycles).toBe(2);
    expect(acc.outcomes()['low-confidence']).toBe(2);
    expect(acc.credited).toBe(2);
    // Saturated cycles contribute exactly nothing to dose.
    expect(acc.deliveredSeconds).toBeCloseTo(1.0, 9);
  });

  it('lists peak velocities in insertion order, refused cycles included', () => {
    const acc = new DoseAccumulator();
    expect(acc.peakVelocities()).toEqual([]);

    acc.add(scored({ peakOmega: 250 }));
    acc.add(scored({ peakOmega: 80 }));
    acc.add(scored({ peakOmega: 999 }));
    acc.add(scored({ peakOmega: 300 }));

    expect(acc.peakVelocities()).toEqual([250, 80, 999, 300]);
    expect(acc.peakVelocities()).toHaveLength(acc.attempted);
    expect(acc.credited).toBe(2);
  });
});
