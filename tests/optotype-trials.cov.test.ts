import { describe, it, expect } from 'vitest';
import {
  TrialScheduler,
  binomialTailP,
  gazeDemonstrated,
  CHANCE,
  RESPONSE_WINDOW_MS,
  type GapOrientation,
} from '../src/optotype/trials.ts';

/** Deterministic pseudo-random source — tests must not depend on Math.random. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Advances the scheduler frame by frame until the next C is presented. */
function advanceToPresent(s: TrialScheduler, from: number, stepMs = 50): number {
  let t = from;
  for (let i = 0; i < 10_000; i++) {
    if (s.tick(t) === 'present') return t;
    t += stepMs;
  }
  throw new Error('scheduler never presented');
}

describe('TrialScheduler response window state', () => {
  it('reports the window shut before the first presentation and refuses an answer', () => {
    const s = new TrialScheduler(0, lcg(3));
    expect(s.shown).toBe(null);
    expect(s.windowOpen).toBe(false);
    // No C has been drawn, so there is nothing an arrow key could be answering.
    expect(s.answer(0, 0)).toBe(false);
    expect(s.trials).toEqual([]);
    // Ticking short of the first interval leaves the window shut.
    expect(s.tick(0)).toBe(null);
    expect(s.windowOpen).toBe(false);
  });

  it('opens the window on presentation and shuts it on the accepted answer', () => {
    const s = new TrialScheduler(0, lcg(3));
    const t = advanceToPresent(s, 0);
    expect(s.windowOpen).toBe(true);
    const shown = s.shown as GapOrientation;

    expect(s.answer(shown, t + 10)).toBe(true);
    expect(s.windowOpen).toBe(false);
    // The C stays rendered, but a second key press has no open window to land in.
    expect(s.shown).toBe(shown);
    expect(s.answer(shown, t + 20)).toBe(false);
    expect(s.trials).toEqual([{ tMs: t, shown, answered: shown, correct: true }]);
  });

  it('holds the window open across the full 2.5 s and shuts it on timeout', () => {
    const s = new TrialScheduler(0, lcg(9));
    const t = advanceToPresent(s, 0);
    const shown = s.shown as GapOrientation;

    expect(s.tick(t + RESPONSE_WINDOW_MS - 1)).toBe(null);
    expect(s.windowOpen).toBe(true);
    expect(s.tick(t + RESPONSE_WINDOW_MS)).toBe('timeout');
    expect(s.windowOpen).toBe(false);
    expect(s.trials).toEqual([{ tMs: t, shown, answered: null, correct: false }]);
    expect(s.tally()).toEqual({ correct: 0, total: 1, chance: CHANCE });
  });

  it('accepts an answer landing exactly on the 2.5 s boundary', () => {
    const s = new TrialScheduler(0, lcg(21));
    const t = advanceToPresent(s, 0);
    const shown = s.shown as GapOrientation;
    const wrong = ((shown + 1) % 4) as GapOrientation;

    // `answer` rejects strictly after the window, so the boundary frame counts.
    expect(s.answer(wrong, t + RESPONSE_WINDOW_MS)).toBe(true);
    expect(s.trials).toEqual([{ tMs: t, shown, answered: wrong, correct: false }]);
    // The trial is already recorded, so the timeout branch must not double-count it.
    expect(s.tick(t + RESPONSE_WINDOW_MS + 1)).toBe(null);
    expect(s.tally()).toEqual({ correct: 0, total: 1, chance: CHANCE });
  });
});

describe('binomial tail on degenerate blocks', () => {
  it('returns certainty for a block with no trials', () => {
    // P(X >= k) over an empty block is vacuously 1 — never "demonstrated".
    expect(binomialTailP(0, 0)).toBe(1);
    expect(binomialTailP(4, 0)).toBe(1);
    expect(gazeDemonstrated(0, 0)).toBe(false);
  });

  it('returns certainty rather than NaN for a negative total', () => {
    expect(binomialTailP(0, -1)).toBe(1);
    expect(binomialTailP(3, -7)).toBe(1);
    expect(gazeDemonstrated(3, -7)).toBe(false);
  });

  it('clamps a correct count outside [0, total] before summing the tail', () => {
    // More correct than trials clamps to k = total: P(X >= n) = p^n.
    expect(binomialTailP(50, 4)).toBeCloseTo(CHANCE ** 4, 12);
    expect(binomialTailP(4, 4)).toBeCloseTo(CHANCE ** 4, 12);
    // A negative count clamps to k = 0: P(X >= 0) = 1.
    expect(binomialTailP(-5, 4)).toBeCloseTo(1, 12);
  });

  it('honours an explicit chance rate other than 0.25', () => {
    // P(X >= 1 | n = 1, p = 0.5) = 0.5, and P(X >= 2 | n = 3, p = 0.5) = 0.5.
    expect(binomialTailP(1, 1, 0.5)).toBeCloseTo(0.5, 12);
    expect(binomialTailP(2, 3, 0.5)).toBeCloseTo(0.5, 12);
    // A 2AFC task needs a much bigger tally than a 4AFC one to clear alpha.
    expect(binomialTailP(8, 10, 0.5)).toBeGreaterThan(binomialTailP(8, 10));
  });
});
