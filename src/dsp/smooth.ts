/**
 * Savitzky–Golay smoothing, applied to the ANGLE series only.
 *
 * The rule that generated this: smooth the quantity that is noisy (the angle),
 * differentiate with the operator whose bias is a closed-form expression, and
 * then correct that bias explicitly (`velocity.ts`).
 *
 * Smoothing the angle and differentiating separately keeps the derivative's
 * attenuation analytic. A Savitzky–Golay *derivative* filter would fold the two
 * together and triple the bias (≈9.6 % at 2 Hz / 30 fps against 2.90 %).
 */

/** Quadratic Savitzky–Golay coefficients, normalised, for odd window widths. */
const SG_COEFFS: Record<number, readonly number[]> = {
  5: [-3 / 35, 12 / 35, 17 / 35, 12 / 35, -3 / 35],
  7: [-2 / 21, 3 / 21, 6 / 21, 7 / 21, 6 / 21, 3 / 21, -2 / 21],
  9: [-21 / 231, 14 / 231, 39 / 231, 54 / 231, 59 / 231, 54 / 231, 39 / 231, 14 / 231, -21 / 231],
};

export const DEFAULT_SG_WINDOW = 5;

export function savitzkyGolayCoefficients(window: number): readonly number[] {
  const c = SG_COEFFS[window];
  if (!c) throw new Error(`unsupported Savitzky-Golay window: ${window} (use 5, 7 or 9)`);
  return c;
}

/**
 * Smooths one sample at the CENTRE of the supplied window.
 *
 * `window[window.length >> 1]` is the sample being smoothed, so this is a
 * symmetric (non-causal) filter costing (width-1)/2 frames of latency — at
 * width 5 and 30 fps that is 2 frames, ~67 ms, which is well inside one 250 ms
 * sweep and is why the audio coaching still lands within the same head turn.
 */
export function savitzkyGolayPoint(window: readonly number[] | Float64Array, width = DEFAULT_SG_WINDOW): number {
  const c = savitzkyGolayCoefficients(width);
  if (window.length !== width) {
    throw new Error(`window length ${window.length} does not match width ${width}`);
  }
  let acc = 0;
  for (let i = 0; i < width; i++) acc += (c[i] as number) * (window[i] as number);
  return acc;
}

/** Smooths a whole series; the (width-1)/2 samples at each end pass through unfiltered. */
export function savitzkyGolay(series: readonly number[] | Float64Array, width = DEFAULT_SG_WINDOW): Float64Array {
  const n = series.length;
  const out = new Float64Array(n);
  const half = width >> 1;
  if (n < width) {
    for (let i = 0; i < n; i++) out[i] = series[i] as number;
    return out;
  }
  const c = savitzkyGolayCoefficients(width);
  for (let i = 0; i < n; i++) {
    if (i < half || i >= n - half) {
      out[i] = series[i] as number;
      continue;
    }
    let acc = 0;
    for (let k = 0; k < width; k++) acc += (c[k] as number) * (series[i - half + k] as number);
    out[i] = acc;
  }
  return out;
}
