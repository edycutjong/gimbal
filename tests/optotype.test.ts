import { describe, it, expect } from 'vitest';
import {
  nextOrientation,
  nextIntervalMs,
  TrialScheduler,
  binomialTailP,
  gazeDemonstrated,
  ORIENTATION_KEYS,
  MIN_INTERVAL_MS,
  MAX_INTERVAL_MS,
  RESPONSE_WINDOW_MS,
  CHANCE,
} from '../src/optotype/trials.ts';

/** Deterministic pseudo-random source — tests must not depend on Math.random. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('Landolt C 4AFC trials', () => {
  it('draws re-randomisation intervals uniformly in [2.5, 5.0] s over 10⁴ draws', () => {
    const rand = lcg(7);
    const buckets = [0, 0, 0, 0, 0];
    for (let i = 0; i < 10_000; i++) {
      const ms = nextIntervalMs(rand);
      expect(ms).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
      expect(ms).toBeLessThanOrEqual(MAX_INTERVAL_MS);
      buckets[Math.min(4, Math.floor(((ms - MIN_INTERVAL_MS) / (MAX_INTERVAL_MS - MIN_INTERVAL_MS)) * 5))]! += 1;
    }
    for (const b of buckets) expect(Math.abs(b - 2000)).toBeLessThan(300);
  });

  it('never repeats the same orientation consecutively — the hold-one-key cheat is closed', () => {
    const rand = lcg(11);
    let prev = nextOrientation(null, rand);
    for (let i = 0; i < 5000; i++) {
      const next = nextOrientation(prev, rand);
      expect(next).not.toBe(prev);
      expect([0, 1, 2, 3]).toContain(next);
      prev = next;
    }
  });

  it('maps arrow-key direction to gap orientation spatially', () => {
    expect(ORIENTATION_KEYS.ArrowRight).toBe(0);
    expect(ORIENTATION_KEYS.ArrowDown).toBe(1);
    expect(ORIENTATION_KEYS.ArrowLeft).toBe(2);
    expect(ORIENTATION_KEYS.ArrowUp).toBe(3);
  });

  it('scores a response after 2.5 s as a MISS, not as discarded', () => {
    const s = new TrialScheduler(0, lcg(3));
    let t = 0;
    while (s.tick(t) !== 'present') t += 100;
    const shown = s.shown!;
    // Answer one frame after the window closes.
    expect(s.answer(shown, t + RESPONSE_WINDOW_MS + 100)).toBe(false);
    s.tick(t + RESPONSE_WINDOW_MS + 100);
    const tally = s.tally();
    expect(tally.total).toBe(1);
    expect(tally.correct).toBe(0);
  });

  it('tallies at block level with chance = 0.25', () => {
    const s = new TrialScheduler(0, lcg(5));
    let t = 0;
    let presented = 0;
    while (presented < 10) {
      if (s.tick(t) === 'present') {
        presented += 1;
        // Answer correctly for the first 8, wrongly for the last 2.
        const shown = s.shown!;
        const answer = presented <= 8 ? shown : (((shown + 1) % 4) as typeof shown);
        expect(s.answer(answer, t + 100)).toBe(true);
      }
      t += 50;
    }
    const tally = s.tally();
    expect(tally.total).toBe(10);
    expect(tally.correct).toBe(8);
    expect(tally.chance).toBe(CHANCE);
  });

  it('scores the tally against chance with a one-sided exact binomial', () => {
    // 29/31 is far from guessing; 8/31 is not.
    expect(binomialTailP(29, 31)).toBeLessThan(1e-10);
    expect(gazeDemonstrated(29, 31)).toBe(true);
    expect(gazeDemonstrated(8, 31)).toBe(false);
    // P(X >= 0) is exactly 1, and an empty block is never "demonstrated".
    expect(binomialTailP(0, 10)).toBeCloseTo(1, 12);
    expect(gazeDemonstrated(0, 0)).toBe(false);
    // Sanity against a hand-computable case: P(X >= 2 | n=2, p=0.25) = 0.0625
    expect(binomialTailP(2, 2)).toBeCloseTo(0.0625, 10);
  });
});
