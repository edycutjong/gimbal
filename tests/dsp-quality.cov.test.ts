import { describe, it, expect } from 'vitest';
import {
  cadenceQuality,
  fitQuality,
  kinematicQuality,
  frameQuality,
  orthonormalityResidual,
  KINEMATIC_MULTIPLIER,
  FIT_RESIDUAL_TOLERANCE,
} from '../src/dsp/quality.ts';
import type { QualityInputs } from '../src/dsp/quality.ts';

/** A frame every term of which scores 1 — each test spoils exactly one term. */
function goodFrame(overrides: Partial<QualityInputs> = {}): QualityInputs {
  return {
    facePresent: true,
    frameIntervalMs: 33.3,
    targetIntervalMs: 33.3,
    fitResidual: 0,
    angularAccel: 100,
    plausibleAccel: 500,
    ...overrides,
  };
}

describe('published constants', () => {
  it('treats 3× the prescribed peak acceleration as the flicker ceiling, and 0.05 as the fit tolerance', () => {
    expect(KINEMATIC_MULTIPLIER).toBe(3);
    expect(FIT_RESIDUAL_TOLERANCE).toBe(0.05);
  });
});

describe('cadenceQuality — late frames are penalised, early ones are not', () => {
  it('scores 1 for a frame that arrives early and for one that arrives exactly on target', () => {
    expect(cadenceQuality(20, 33.3)).toBe(1);
    expect(cadenceQuality(33.3, 33.3)).toBe(1);
  });

  it('falls as target/actual once the frame is late — a doubled interval scores 0.5', () => {
    expect(cadenceQuality(66.6, 33.3)).toBeCloseTo(0.5, 12);
    expect(cadenceQuality(133.2, 33.3)).toBeCloseTo(0.25, 12);
  });

  it('refuses a non-positive or non-finite frame interval outright', () => {
    expect(cadenceQuality(0, 33.3)).toBe(0);
    expect(cadenceQuality(-10, 33.3)).toBe(0);
    expect(cadenceQuality(Number.NaN, 33.3)).toBe(0);
  });

  it('refuses a non-positive target interval — there is nothing to compare against', () => {
    expect(cadenceQuality(33.3, 0)).toBe(0);
    expect(cadenceQuality(33.3, -1)).toBe(0);
    expect(cadenceQuality(33.3, Number.NaN)).toBe(0);
  });

  it('scores an infinitely late frame at 0 rather than at an infinitesimal', () => {
    expect(cadenceQuality(Number.POSITIVE_INFINITY, 33.3)).toBe(0);
  });
});

describe('fitQuality — linear in the orthonormality residual', () => {
  it('scores a perfect rigid fit 1 and half the tolerance 0.5', () => {
    expect(fitQuality(0)).toBe(1);
    expect(fitQuality(0.025)).toBeCloseTo(0.5, 12);
  });

  it('reaches exactly zero at the tolerance and stays clamped beyond it', () => {
    expect(fitQuality(FIT_RESIDUAL_TOLERANCE)).toBe(0);
    expect(fitQuality(0.5)).toBe(0);
  });

  it('refuses a negative or non-finite residual', () => {
    expect(fitQuality(-0.001)).toBe(0);
    expect(fitQuality(Number.NaN)).toBe(0);
    expect(fitQuality(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('honours an explicit tolerance, and refuses a degenerate zero tolerance', () => {
    expect(fitQuality(0.05, 0.1)).toBeCloseTo(0.5, 12);
    expect(fitQuality(0.2, 0.1)).toBe(0);
    // 1 − r/0 is not a finite score, so it is not a score: clamp01 refuses it.
    expect(fitQuality(0.01, 0)).toBe(0);
    expect(fitQuality(0, 0)).toBe(0);
  });
});

describe('kinematicQuality — implausible acceleration is refused, never corrected', () => {
  it('scores anything up to and including 3× the prescribed peak a full 1', () => {
    expect(kinematicQuality(0, 100)).toBe(1);
    expect(kinematicQuality(299, 100)).toBe(1);
    expect(kinematicQuality(300, 100)).toBe(1);
  });

  it('falls linearly over one further ceiling, hitting 0.5 midway and 0 at 6×', () => {
    expect(kinematicQuality(450, 100)).toBeCloseTo(0.5, 12);
    expect(kinematicQuality(600, 100)).toBe(0);
    expect(kinematicQuality(900, 100)).toBe(0);
  });

  it('uses the magnitude, so a negative acceleration scores like its positive twin', () => {
    expect(kinematicQuality(-450, 100)).toBeCloseTo(kinematicQuality(450, 100), 12);
    expect(kinematicQuality(-100, 100)).toBe(1);
  });

  it('refuses a non-finite acceleration', () => {
    expect(kinematicQuality(Number.NaN, 100)).toBe(0);
    expect(kinematicQuality(Number.POSITIVE_INFINITY, 100)).toBe(0);
  });

  it('abstains — scores 1, not 0 — when no plausible peak is available to judge against', () => {
    expect(kinematicQuality(1e9, 0)).toBe(1);
    expect(kinematicQuality(1e9, -5)).toBe(1);
    expect(kinematicQuality(1e9, Number.NaN)).toBe(1);
  });

  it('honours an explicit multiplier', () => {
    // multiplier 1 → ceiling 100, so 150 is halfway through the falloff.
    expect(kinematicQuality(150, 100, 1)).toBeCloseTo(0.5, 12);
    expect(kinematicQuality(150, 100, 2)).toBe(1);
  });
});

describe('frameQuality — the minimum of four independently observable terms', () => {
  it('is exactly 0 for a frame with no face, whatever else the frame reports', () => {
    expect(frameQuality(goodFrame({ facePresent: false }))).toBe(0);
  });

  it('is 1 only when every term is 1', () => {
    expect(frameQuality(goodFrame())).toBe(1);
  });

  it('is limited by cadence when cadence is the worst term', () => {
    expect(frameQuality(goodFrame({ frameIntervalMs: 66.6 }))).toBeCloseTo(0.5, 12);
  });

  it('is limited by the rigid fit when the fit is the worst term', () => {
    expect(frameQuality(goodFrame({ fitResidual: 0.0375 }))).toBeCloseTo(0.25, 12);
  });

  it('is limited by kinematics when the acceleration is the worst term', () => {
    expect(frameQuality(goodFrame({ angularAccel: 2250, plausibleAccel: 500 }))).toBeCloseTo(
      0.5,
      12,
    );
  });

  it('takes the minimum, not the mean, when several terms are degraded', () => {
    const q = frameQuality(
      goodFrame({ frameIntervalMs: 66.6, fitResidual: 0.045, angularAccel: 2000, plausibleAccel: 500 }),
    );
    // cadence 0.5, fit 0.1, kinematic 0.667 → 0.1.
    expect(q).toBeCloseTo(0.1, 12);
  });
});

describe('orthonormalityResidual — ‖RᵀR − I‖_F', () => {
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  it('is zero for the identity and for a proper rotation', () => {
    expect(orthonormalityResidual(I)).toBeCloseTo(0, 12);
    const c = Math.cos(0.7);
    const s = Math.sin(0.7);
    expect(orthonormalityResidual([c, -s, 0, s, c, 0, 0, 0, 1])).toBeCloseTo(0, 12);
  });

  it('reports Infinity for anything that is not nine elements', () => {
    expect(orthonormalityResidual([])).toBe(Number.POSITIVE_INFINITY);
    expect(orthonormalityResidual([1, 0, 0, 0, 1, 0, 0, 0])).toBe(Number.POSITIVE_INFINITY);
    expect(orthonormalityResidual([...I, 1])).toBe(Number.POSITIVE_INFINITY);
  });

  it('catches a uniform scale — the diagonal terms of RᵀR − I', () => {
    const k = 1.01;
    const residual = orthonormalityResidual(I.map((v) => v * k));
    expect(residual).toBeCloseTo(Math.sqrt(3) * (k * k - 1), 12);
  });

  it('catches a shear — the off-diagonal terms nothing else sees', () => {
    // Columns are no longer orthogonal: c0·c1 = 0.1.
    const sheared = [1, 0.1, 0, 0, 1, 0, 0, 0, 1];
    expect(orthonormalityResidual(sheared)).toBeCloseTo(Math.sqrt(2 * 0.01 + 0.01 * 0.01), 12);
  });

  it('is large for a degenerate fit whose rows have collapsed', () => {
    expect(orthonormalityResidual([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeCloseTo(Math.sqrt(3), 12);
  });
});
