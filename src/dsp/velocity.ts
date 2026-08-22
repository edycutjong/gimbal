/**
 * Angular velocity, and the published bias correction.
 *
 * A 3-point central difference on a sinusoid of frequency f sampled at interval
 * T reports exactly `sin(2πfT)/(2πfT)` of the true peak — an ATTENUATION with a
 * closed form, which means it can be corrected rather than tolerated.
 *
 *   f = 1.0 Hz, 30 fps →  gain 0.9927 → ×1.0073   (0.73 % under-read)
 *   f = 1.5 Hz, 30 fps →  gain 0.9836 → ×1.0166   (1.66 %)
 *   f = 2.0 Hz, 30 fps →  gain 0.9710 → ×1.0299   (2.90 %)
 *   f = 3.0 Hz, 30 fps →  gain 0.9355 → ×1.0690   (6.45 %)
 *
 * The correction is five lines of arithmetic with a known value, not a fudge
 * factor, and it is published in METHODS.md. It is also load-bearing in the
 * test suite: `npm run verify`'s A1 tolerance is set BELOW the size of this
 * effect, so deleting the correction makes the gate fail.
 */

/**
 * Causal 3-point central difference on MEASURED intervals.
 *
 * Returns ω at index `n - 1` from samples `n` and `n - 2`. The interval is read
 * from the camera's own timestamps, never assumed to be 33.3 ms — a camera whose
 * auto-exposure lengthens the shutter in dim light silently drops to ~15 fps
 * while `getSettings().frameRate` still reports 30.
 */
export function centralDifference(yNewer: number, yOlder: number, tNewerMs: number, tOlderMs: number): number {
  const dtSec = (tNewerMs - tOlderMs) / 1000;
  if (!(dtSec > 0)) return NaN;
  return (yNewer - yOlder) / dtSec;
}

/** The analytic attenuation of a 3-point central difference: `sin(2πfT)/(2πfT)`. */
export function centralDifferenceGain(fHz: number, tSec: number): number {
  const x = 2 * Math.PI * fHz * tSec;
  if (x === 0) return 1;
  return Math.sin(x) / x;
}

/** The reciprocal of the gain — the factor a measured peak is multiplied by. */
export function biasCorrectionFactor(fHz: number, tSec: number): number {
  const g = centralDifferenceGain(fHz, tSec);
  if (!(Math.abs(g) > 1e-9)) return NaN;
  return 1 / g;
}

/**
 * Applies the correction ONCE. `rawPeak` is the largest |ω| observed in the
 * cycle; `fHz` is the FFT's dominant-frequency estimate; `tSec` is the MEDIAN
 * frame interval over that cycle.
 */
export function correctPeak(rawPeak: number, fHz: number, tSec: number): number {
  const g = centralDifferenceGain(fHz, tSec);
  if (!(Math.abs(g) > 1e-9)) return rawPeak;
  return rawPeak / g;
}

/** Peak angular velocity implied by sinusoidal oscillation: ω = 2πfA. Trigonometry, not medicine. */
export function peakOmegaFor(fHz: number, amplitudeDeg: number): number {
  return 2 * Math.PI * fHz * amplitudeDeg;
}

/** Peak angular acceleration implied by the same motion: (2πf)²A. Used by the plausibility term. */
export function peakAccelFor(fHz: number, amplitudeDeg: number): number {
  const w = 2 * Math.PI * fHz;
  return w * w * amplitudeDeg;
}

/** Median of a numeric series — used for the per-cycle frame interval. */
export function median(values: readonly number[] | Float64Array): number {
  const n = values.length;
  if (n === 0) return NaN;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const mid = n >> 1;
  return n % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}
