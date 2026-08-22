/** Six outcomes: `ok` plus FIVE refusal reasons. */
export type CycleOutcome =
  | 'ok'
  | 'too-slow'
  | 'too-fast'
  | 'off-cadence'
  | 'low-confidence'
  | 'face-lost';

export const REFUSAL_REASONS: readonly CycleOutcome[] = [
  'too-slow',
  'too-fast',
  'off-cadence',
  'low-confidence',
  'face-lost',
] as const;

export const ALL_OUTCOMES: readonly CycleOutcome[] = ['ok', ...REFUSAL_REASONS] as const;

/** One full oscillation — two sweeps. The credit unit. */
export interface Cycle {
  /** ms from block start. */
  tStartMs: number;
  tEndMs: number;
  /** ms. */
  periodMs: number;
  /** °/s, bias-corrected. */
  peakOmega: number;
  /** °/s, as measured before the central-difference correction. */
  rawPeakOmega: number;
  sampleCount: number;
  qMin: number;
  qMean: number;
  /** Hz — the FFT's dominant-frequency estimate covering this cycle. */
  fHat: number;
  /** Any frame in the cycle returned zero faces. */
  faceLost: boolean;
  /** |ω| exceeded the quantisation range — refused, never clipped. */
  saturated: boolean;
}

export interface ScoredCycle extends Cycle {
  credited: boolean;
  reason: CycleOutcome;
}

/** One camera frame's worth of measurement. */
export interface FrameSample {
  /** ms, from `requestVideoFrameCallback` — the camera's own clock, never `Date.now()`. */
  tMs: number;
  /** degrees. */
  yaw: number;
  /** degrees. */
  pitch: number;
  facePresent: boolean;
  /** Orthonormality residual of the rotation block, ‖RᵀR − I‖_F. */
  fitResidual: number;
}
