/**
 * Tracking quality `q` — computed from observables, not from a number the API
 * does not return.
 *
 * The MediaPipe JS API does NOT expose a per-detection confidence value.
 * `minFaceDetectionConfidence`, `minFacePresenceConfidence` and
 * `minTrackingConfidence` are thresholds we SUPPLY; they are not readings we
 * RECEIVE. A quality score claiming to be "the model's confidence" would be
 * architecture inflation, so `q` is built from four things that are genuinely
 * observable.
 *
 *   q = min(q_presence, q_cadence, q_fit, q_kinematic) ∈ [0, 1]
 */

export interface QualityInputs {
  /** The result contained a face, or it did not. */
  facePresent: boolean;
  /** ms — measured from `requestVideoFrameCallback`, never `getSettings().frameRate`. */
  frameIntervalMs: number;
  /** ms — the interval implied by the derived sampling floor for this prescription. */
  targetIntervalMs: number;
  /** ‖RᵀR − I‖_F for the rotation block. Near zero for a well-conditioned rigid fit. */
  fitResidual: number;
  /** °/s² — this frame's angular acceleration. */
  angularAccel: number;
  /** °/s² — peak plausible acceleration for the prescribed motion, (2πf)²A. */
  plausibleAccel: number;
}

/** How many times the prescribed peak acceleration is still treated as a neck rather than flicker. */
export const KINEMATIC_MULTIPLIER = 3;

/** Fit residual at which `q_fit` reaches zero. */
export const FIT_RESIDUAL_TOLERANCE = 0.05;

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/**
 * A frame that arrives LATE scores below 1. Early frames are not penalised —
 * a camera running fast is not a measurement problem.
 */
export function cadenceQuality(frameIntervalMs: number, targetIntervalMs: number): number {
  if (!(frameIntervalMs > 0) || !(targetIntervalMs > 0)) return 0;
  if (frameIntervalMs <= targetIntervalMs) return 1;
  return clamp01(targetIntervalMs / frameIntervalMs);
}

/** Nine multiply-adds that catch a degenerate rigid fit nothing else sees. */
export function fitQuality(fitResidual: number, tolerance = FIT_RESIDUAL_TOLERANCE): number {
  if (!Number.isFinite(fitResidual) || fitResidual < 0) return 0;
  return clamp01(1 - fitResidual / tolerance);
}

/**
 * Physiological plausibility. A single-frame acceleration several times the
 * prescribed peak is landmark flicker, not a neck. Its effect is always
 * REFUSAL, never correction — a corrected implausible value is still a guess.
 */
export function kinematicQuality(
  angularAccel: number,
  plausibleAccel: number,
  multiplier = KINEMATIC_MULTIPLIER,
): number {
  if (!Number.isFinite(angularAccel)) return 0;
  if (!(plausibleAccel > 0)) return 1;
  const ceiling = plausibleAccel * multiplier;
  const magnitude = Math.abs(angularAccel);
  if (magnitude <= ceiling) return 1;
  // Falls to zero one further ceiling above the limit.
  return clamp01(1 - (magnitude - ceiling) / ceiling);
}

export function frameQuality(inputs: QualityInputs): number {
  // A zero-face frame is q = 0 and flags the cycle `face-lost`. This is the only
  // place the model's internal thresholds surface: when presence drops below
  // `minFacePresenceConfidence`, MediaPipe emits nothing — and that absence IS
  // the signal.
  if (!inputs.facePresent) return 0;

  return Math.min(
    1,
    cadenceQuality(inputs.frameIntervalMs, inputs.targetIntervalMs),
    fitQuality(inputs.fitResidual),
    kinematicQuality(inputs.angularAccel, inputs.plausibleAccel),
  );
}

/**
 * Orthonormality residual of a 3×3 rotation block, ‖RᵀR − I‖_F.
 * `r` is row-major, nine elements.
 */
export function orthonormalityResidual(r: readonly number[]): number {
  if (r.length !== 9) return Infinity;
  let acc = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let dot = 0;
      for (let k = 0; k < 3; k++) dot += (r[k * 3 + i] as number) * (r[k * 3 + j] as number);
      const target = i === j ? 1 : 0;
      acc += (dot - target) * (dot - target);
    }
  }
  return Math.sqrt(acc);
}
