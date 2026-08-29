import { describe, it, expect } from 'vitest';
import {
  INSTRUMENT_LIMITS,
  PROVISIONAL_FROM_SPIKE,
  minSampleRateHz,
  cardExceedsInstrument,
  deadbandDegPerSec,
  type InstrumentLimits,
} from '../src/dsp/limits.ts';

/** The 5 % central-difference constant from the module docstring: sin(x)/x = 0.95. */
const CORRECTION_X = 0.5519;

/** A limits object whose samples-per-cycle term dominates the correction bound. */
function limitsWith(overrides: Partial<InstrumentLimits> = {}): InstrumentLimits {
  return { ...INSTRUMENT_LIMITS, ...overrides };
}

describe('instrument limits — the constants', () => {
  it('names provisional fields that actually exist on InstrumentLimits', () => {
    expect([...PROVISIONAL_FROM_SPIKE]).toEqual(['deadbandFraction', 'qFloor']);
    for (const key of PROVISIONAL_FROM_SPIKE) {
      expect(typeof INSTRUMENT_LIMITS[key]).toBe('number');
    }
  });

  it('holds the documented instrument values, deadband as a fraction not a °/s', () => {
    expect(INSTRUMENT_LIMITS.maxCycleHz).toBe(3.0);
    expect(INSTRUMENT_LIMITS.nMin).toBe(10);
    expect(INSTRUMENT_LIMITS.deadbandFraction).toBeGreaterThan(0);
    expect(INSTRUMENT_LIMITS.deadbandFraction).toBeLessThan(1);
    expect(INSTRUMENT_LIMITS.qFloor).toBe(0.55);
    // Int16 quantisation range, in hundredths of a degree per second.
    expect(INSTRUMENT_LIMITS.quantisationMaxDegPerSec).toBeCloseTo(65534 / 100, 10);
  });
});

describe('minSampleRateHz', () => {
  it('reproduces the docstring worked example: 3.0 Hz needs 35 fps', () => {
    // 2π·3.0 / 0.5519 = 34.15… → 35, which a 30 fps camera cannot deliver.
    expect(minSampleRateHz(3.0)).toBe(35);
  });

  it('is governed by the correction bound at the default nMin of 10', () => {
    // 10·f vs 11.38·f — the correction bound wins for every positive f.
    for (const f of [0.5, 1.0, 1.7, 2.3, 2.9]) {
      const correctionBound = (2 * Math.PI * f) / CORRECTION_X;
      expect(correctionBound).toBeGreaterThan(INSTRUMENT_LIMITS.nMin * f);
      expect(minSampleRateHz(f)).toBe(Math.ceil(correctionBound));
    }
    expect(minSampleRateHz(2.3)).toBe(27);
  });

  it('is governed by the samples-per-cycle term once nMin exceeds 2π/0.5519', () => {
    const limits = limitsWith({ nMin: 20 });
    // 20·2.3 = 46 beats 2π·2.3/0.5519 = 26.18…
    expect(minSampleRateHz(2.3, limits)).toBe(46);
    expect(minSampleRateHz(1.0, limits)).toBe(20);
  });

  it('rounds UP — a floor of 26.18 fps is not cleared by 26 fps', () => {
    const exact = (2 * Math.PI * 2.3) / CORRECTION_X;
    expect(exact).toBeGreaterThan(26);
    expect(exact).toBeLessThan(27);
    expect(minSampleRateHz(2.3)).toBe(27);
  });

  it('is zero at zero — the floor is derived, with no constant term', () => {
    expect(minSampleRateHz(0)).toBe(0);
  });
});

describe('cardExceedsInstrument', () => {
  it('fails a band edge above the measurement-validity ceiling, whatever the camera', () => {
    expect(cardExceedsInstrument(3.5, 1000)).toBe(true);
    expect(cardExceedsInstrument(3.0001, 240)).toBe(true);
  });

  it('fails a legal band edge the camera is simply too slow for', () => {
    // 2.3 Hz needs 27 fps; a 24 fps capture is refused rather than mis-measured.
    expect(cardExceedsInstrument(2.3, 24)).toBe(true);
    expect(minSampleRateHz(2.3)).toBeGreaterThan(24);
  });

  it('passes when the edge is under the ceiling AND the camera clears the floor', () => {
    expect(cardExceedsInstrument(2.3, 30)).toBe(false);
    expect(cardExceedsInstrument(3.0, 35)).toBe(false);
  });

  it('treats the fps floor as inclusive: exactly-at-floor passes, one below fails', () => {
    expect(cardExceedsInstrument(2.3, 27)).toBe(false);
    expect(cardExceedsInstrument(2.3, 26)).toBe(true);
  });

  it('honours an injected limits object for both the ceiling and the floor', () => {
    const strictCeiling = limitsWith({ maxCycleHz: 2.0 });
    // 2.3 Hz clears the default ceiling but not this one.
    expect(cardExceedsInstrument(2.3, 60, strictCeiling)).toBe(true);
    expect(cardExceedsInstrument(1.9, 60, strictCeiling)).toBe(false);

    const hungryNMin = limitsWith({ nMin: 20 });
    // 20·2.3 = 46 fps demanded, so 30 fps now fails where the default passed.
    expect(cardExceedsInstrument(2.3, 30, hungryNMin)).toBe(true);
    expect(cardExceedsInstrument(2.3, 30)).toBe(false);
    expect(cardExceedsInstrument(2.3, 46, hungryNMin)).toBe(false);
  });
});

describe('deadbandDegPerSec', () => {
  it('scales the deadband to the prescription rather than fixing it in °/s', () => {
    expect(deadbandDegPerSec(150)).toBeCloseTo(22.5, 10);
    expect(deadbandDegPerSec(300)).toBeCloseTo(45, 10);
    // Doubling the floor doubles the deadband — it is a fraction, not a constant.
    expect(deadbandDegPerSec(300)).toBeCloseTo(2 * deadbandDegPerSec(150), 10);
    expect(deadbandDegPerSec(0)).toBe(0);
  });

  it('uses the injected fraction when limits are supplied', () => {
    expect(deadbandDegPerSec(200, limitsWith({ deadbandFraction: 0.25 }))).toBeCloseTo(50, 10);
    expect(deadbandDegPerSec(200, limitsWith({ deadbandFraction: 0 }))).toBe(0);
  });
});
