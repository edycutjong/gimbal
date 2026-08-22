import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scoreCycle } from '../src/dsp/score.ts';
import { INSTRUMENT_LIMITS } from '../src/dsp/limits.ts';
import { ALL_OUTCOMES, type CycleOutcome } from '../src/dsp/types.ts';
import { testCard, testCycle } from './helpers.ts';

const card = testCard(); // band 1.7-2.3 Hz, floor 150, ceiling 350 °/s

describe('scoreCycle — the credit / refusal gate', () => {
  it('reaches all six outcomes', () => {
    const reached = new Set<CycleOutcome>();
    reached.add(scoreCycle(testCycle(), card).reason);
    reached.add(scoreCycle(testCycle({ peakOmega: 80 }), card).reason);
    reached.add(scoreCycle(testCycle({ peakOmega: 500 }), card).reason);
    reached.add(scoreCycle(testCycle({ periodMs: 900 }), card).reason);
    reached.add(scoreCycle(testCycle({ qMin: 0.1 }), card).reason);
    reached.add(scoreCycle(testCycle({ faceLost: true }), card).reason);
    for (const o of ALL_OUTCOMES) expect(reached.has(o)).toBe(true);
    expect(reached.size).toBe(6);
  });

  it('credits a cycle inside the band', () => {
    const r = scoreCycle(testCycle(), card);
    expect(r.credited).toBe(true);
    expect(r.reason).toBe('ok');
    expect(r.doseSeconds).toBeCloseTo(0.5, 6);
  });

  it('credits boundary equality at BOTH velocity band edges — a documented convention', () => {
    expect(scoreCycle(testCycle({ peakOmega: 150 }), card).credited).toBe(true);
    expect(scoreCycle(testCycle({ peakOmega: 350 }), card).credited).toBe(true);
  });

  it('credits boundary equality at both cadence band edges', () => {
    // 1.7 Hz => 588.24 ms; 2.3 Hz => 434.78 ms
    expect(scoreCycle(testCycle({ periodMs: 1000 / 1.7 }), card).credited).toBe(true);
    expect(scoreCycle(testCycle({ periodMs: 1000 / 2.3 }), card).credited).toBe(true);
  });

  it('refuses too-slow below the card floor and too-fast above the card ceiling', () => {
    expect(scoreCycle(testCycle({ peakOmega: 149.9 }), card).reason).toBe('too-slow');
    expect(scoreCycle(testCycle({ peakOmega: 350.1 }), card).reason).toBe('too-fast');
  });

  it('refuses off-cadence outside the card frequency band', () => {
    expect(scoreCycle(testCycle({ periodMs: 700 }), card).reason).toBe('off-cadence');
    expect(scoreCycle(testCycle({ periodMs: 380 }), card).reason).toBe('off-cadence');
  });

  it('refuses low-confidence below the quality floor or the sample floor', () => {
    expect(scoreCycle(testCycle({ qMin: INSTRUMENT_LIMITS.qFloor - 0.01 }), card).reason).toBe('low-confidence');
    expect(scoreCycle(testCycle({ sampleCount: INSTRUMENT_LIMITS.nMin - 1 }), card).reason).toBe('low-confidence');
  });

  it('refuses a saturated cycle rather than clipping it', () => {
    const r = scoreCycle(testCycle({ peakOmega: 700, saturated: true }), card);
    expect(r.reason).toBe('low-confidence');
    expect(r.credited).toBe(false);
  });

  it('has deterministic reason precedence: face-lost > low-confidence > velocity > cadence', () => {
    const everythingWrong = testCycle({
      faceLost: true,
      qMin: 0,
      sampleCount: 1,
      peakOmega: 10,
      periodMs: 2000,
    });
    expect(scoreCycle(everythingWrong, card).reason).toBe('face-lost');
    expect(scoreCycle({ ...everythingWrong, faceLost: false }, card).reason).toBe('low-confidence');
    expect(scoreCycle({ ...everythingWrong, faceLost: false, qMin: 1, sampleCount: 15 }, card).reason).toBe('too-slow');
  });

  it('returns a dose contribution of exactly 0 for every refusal, never undefined', () => {
    for (const c of [
      testCycle({ peakOmega: 10 }),
      testCycle({ peakOmega: 999 }),
      testCycle({ periodMs: 3000 }),
      testCycle({ qMin: 0 }),
      testCycle({ faceLost: true }),
    ]) {
      const r = scoreCycle(c, card);
      expect(r.credited).toBe(false);
      expect(r.doseSeconds).toBe(0);
    }
  });

  it('refuses too-fast above the instrument ceiling regardless of what the card says', () => {
    const generous = testCard({ ceiling: 600, bandLo: 0.5, bandHi: 4 });
    const fast = testCycle({ fHat: INSTRUMENT_LIMITS.maxCycleHz + 0.1, periodMs: 1000 / 3.1, peakOmega: 300 });
    expect(scoreCycle(fast, generous).reason).toBe('too-fast');
  });

  it('embeds no thresholds — every clinical value arrives from the card, every limit from INSTRUMENT_LIMITS', () => {
    const src = readFileSync(new URL('../src/dsp/score.ts', import.meta.url), 'utf8');
    const body = src
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//') && !l.trimStart().startsWith('/*'))
      .join('\n');
    // The only bare numerals permitted in the module body are the unit
    // conversion 1000 (ms->s) and 0 (the dose contribution of a refusal).
    const numerals = body.match(/(?<![\w.])\d+(?:\.\d+)?/g) ?? [];
    for (const n of numerals) expect(['0', '1000']).toContain(n);

    // And a card with different thresholds must change the verdict.
    const strict = testCard({ floor: 300 });
    expect(scoreCycle(testCycle({ peakOmega: 250 }), card).credited).toBe(true);
    expect(scoreCycle(testCycle({ peakOmega: 250 }), strict).reason).toBe('too-slow');
  });
});
