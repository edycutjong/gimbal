import { describe, it, expect } from 'vitest';
import { LookaheadScheduler, detuneCents, MAX_DETUNE_CENTS, LOOKAHEAD_SEC } from '../src/audio/scheduler.ts';
import { testCard } from './helpers.ts';

const card = testCard(); // floor 150, ceiling 350 => centre 250, half-width 100

describe('audio scheduler and the zone pitch map', () => {
  it('never schedules an event in the past, given a clock with 40 ms jitter', () => {
    const period = 0.5;
    let clock = 0;
    const s = new LookaheadScheduler(clock, period);
    let jitterSeed = 1;
    const jitter = (): number => {
      jitterSeed = (jitterSeed * 1103515245 + 12345) & 0x7fffffff;
      return ((jitterSeed / 0x7fffffff) * 0.04);
    };
    for (let i = 0; i < 2000; i++) {
      clock += 0.025 + jitter();
      for (const t of s.pump(clock)) {
        expect(t).toBeGreaterThanOrEqual(clock);
        expect(t).toBeLessThan(clock + LOOKAHEAD_SEC + 1e-9);
      }
    }
  });

  it('holds the click period stable — successive events are exactly one period apart', () => {
    const period = 0.5;
    const s = new LookaheadScheduler(0, period);
    const emitted: number[] = [];
    for (let clock = 0; clock < 60; clock += 0.025) emitted.push(...s.pump(clock));
    expect(emitted.length).toBeGreaterThan(100);
    for (let i = 1; i < emitted.length; i++) {
      expect((emitted[i] as number) - (emitted[i - 1] as number)).toBeCloseTo(period, 12);
    }
  });

  it('does not emit a burst of past-dated events after a clock jump', () => {
    const s = new LookaheadScheduler(0, 0.5);
    s.pump(0.01);
    // The tab was hidden for a minute; the context clock jumped.
    const after = s.pump(60);
    expect(after.length).toBeLessThanOrEqual(1);
    for (const t of after) expect(t).toBeGreaterThanOrEqual(60);
  });

  it('maps velocity to detune monotonically, clamped at both ends', () => {
    let previous = -Infinity;
    for (let omega = 0; omega <= 600; omega += 5) {
      const cents = detuneCents(omega, card);
      expect(cents).toBeGreaterThanOrEqual(previous);
      expect(Math.abs(cents)).toBeLessThanOrEqual(MAX_DETUNE_CENTS);
      previous = cents;
    }
    // Centred in the band, flat below it, sharp above it.
    expect(detuneCents(250, card)).toBeCloseTo(0, 9);
    expect(detuneCents(150, card)).toBeCloseTo(-MAX_DETUNE_CENTS, 9);
    expect(detuneCents(350, card)).toBeCloseTo(MAX_DETUNE_CENTS, 9);
    expect(detuneCents(50, card)).toBe(-MAX_DETUNE_CENTS);
    expect(detuneCents(9999, card)).toBe(MAX_DETUNE_CENTS);
  });
});
