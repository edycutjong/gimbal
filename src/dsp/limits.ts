/**
 * Instrument limits — engineering thresholds, NOT clinical ones.
 *
 * Nothing in this file comes from a guideline and nothing in it is a clinical
 * recommendation. Every clinical threshold lives on the protocol card with a
 * mandatory `source` string (see `src/protocol/card.ts`). The separation is the
 * point: `scoreCycle` embeds no constants at all — clinical values reach it from
 * the card, instrument values reach it from here.
 */

export interface InstrumentLimits {
  /** Measurement-validity ceiling in Hz. Derived, not clinical — see `maxCycleHz` note below. */
  maxCycleHz: number;
  /** Minimum samples per cycle before the cycle is refused `low-confidence`. */
  nMin: number;
  /** Hysteresis deadband as a FRACTION of the card's peak-velocity floor, never an absolute °/s. */
  deadbandFraction: number;
  /** Cycle-level tracking-quality floor below which a cycle is refused `low-confidence`. */
  qFloor: number;
  /** A cycle whose |ω| exceeds the Int16 quantisation range is refused, never clipped. */
  quantisationMaxDegPerSec: number;
}

/**
 * PROVISIONAL VALUES — `deadbandFraction` and `qFloor` are set from the D3
 * tracking-spike recording (`specs/spike-d3.md`), as the value that separates
 * cycles performed deliberately-well from cycles performed under deliberately
 * degraded conditions. Until that recording exists these are placeholders, and
 * `PROVISIONAL_FROM_SPIKE` names exactly which ones so the app can say so on the
 * report rather than presenting a guess as a calibrated threshold.
 */
export const PROVISIONAL_FROM_SPIKE = ['deadbandFraction', 'qFloor'] as const;

export const INSTRUMENT_LIMITS: InstrumentLimits = {
  // Two independent arithmetic reasons, both shown in METHODS.md:
  //  (1) at 3.0 Hz and 30 fps a cycle spans 10 samples — exactly nMin — and the
  //      central-difference correction is already 6.45 %;
  //  (2) minSampleRateHz(3.0) = 35 fps, which a 30 fps camera cannot deliver.
  maxCycleHz: 3.0,
  nMin: 10,
  deadbandFraction: 0.15,
  qFloor: 0.55,
  quantisationMaxDegPerSec: 655.34,
};

/**
 * The sampling floor, evaluated at the UPPER EDGE of the card's prescribed band.
 *
 *   F_min(f) = ceil( max( nMin · f , 2πf / 0.5519 ) )
 *
 * First term: the samples-per-cycle requirement. Second term: the frame rate at
 * which the central-difference correction reaches 5 % — solving sin(x)/x = 0.95
 * gives x = 0.5519, and x = 2πf/F.
 *
 * This floor is DERIVED FROM THE PRESCRIPTION. Measured hardware speed determines
 * whether a machine clears it; it never sets it. A floor set from your own
 * hardware's speed is marking your own homework.
 */
export function minSampleRateHz(
  bandUpperEdgeHz: number,
  limits: InstrumentLimits = INSTRUMENT_LIMITS,
): number {
  const samplesPerCycle = limits.nMin * bandUpperEdgeHz;
  const correctionBound = (2 * Math.PI * bandUpperEdgeHz) / 0.5519;
  return Math.ceil(Math.max(samplesPerCycle, correctionBound));
}

/**
 * A card whose band upper edge needs more frames per second than the camera can
 * supply fails the setup check with a named reason rather than being silently
 * mis-measured.
 */
export function cardExceedsInstrument(
  bandUpperEdgeHz: number,
  measuredFps: number,
  limits: InstrumentLimits = INSTRUMENT_LIMITS,
): boolean {
  return bandUpperEdgeHz > limits.maxCycleHz || minSampleRateHz(bandUpperEdgeHz, limits) > measuredFps;
}

/** The hysteresis deadband in °/s, scaled to the prescription rather than fixed. */
export function deadbandDegPerSec(
  peakVelocityFloorDegPerSec: number,
  limits: InstrumentLimits = INSTRUMENT_LIMITS,
): number {
  return limits.deadbandFraction * peakVelocityFloorDegPerSec;
}
