import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SG_WINDOW,
  savitzkyGolayCoefficients,
  savitzkyGolayPoint,
  savitzkyGolay,
} from '../src/dsp/smooth.ts';

const WIDTHS = [5, 7, 9] as const;

/** A degree-2 polynomial — the exact class a quadratic SG filter reproduces untouched. */
const quad = (i: number) => 3 - 0.7 * i + 0.25 * i * i;

/**
 * Closed-form frequency response of a symmetric FIR filter:
 * H(ω) = c_centre + 2·Σ c_k·cos(kω), real because the kernel is symmetric.
 */
function response(c: readonly number[], omega: number): number {
  const half = c.length >> 1;
  let h = c[half] as number;
  for (let k = 1; k <= half; k++) h += 2 * (c[half + k] as number) * Math.cos(k * omega);
  return h;
}

describe('Savitzky–Golay kernels', () => {
  it('exposes width 5 as the default', () => {
    expect(DEFAULT_SG_WINDOW).toBe(5);
  });

  it('returns kernels of the requested width that are symmetric and sum to exactly 1', () => {
    for (const w of WIDTHS) {
      const c = savitzkyGolayCoefficients(w);
      expect(c).toHaveLength(w);
      for (let k = 0; k < w; k++) expect(c[k]).toBeCloseTo(c[w - 1 - k] as number, 15);
      expect(c.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 15);
    }
  });

  it('gives the published quadratic coefficients (−3, 12, 17, 12, −3)/35 at width 5', () => {
    expect(Array.from(savitzkyGolayCoefficients(5))).toEqual([
      -3 / 35,
      12 / 35,
      17 / 35,
      12 / 35,
      -3 / 35,
    ]);
  });

  it('has negative wings — the shape that preserves peaks a moving average would clip', () => {
    for (const w of WIDTHS) {
      const c = savitzkyGolayCoefficients(w);
      expect(c[0]).toBeLessThan(0);
      expect(c[w - 1]).toBeLessThan(0);
      expect(c[w >> 1]).toBeGreaterThan(0);
    }
  });

  it('rejects every width it has no kernel for', () => {
    for (const bad of [0, 1, 3, 4, 6, 8, 10, 11, -5]) {
      expect(() => savitzkyGolayCoefficients(bad)).toThrow(
        /unsupported Savitzky-Golay window: .* \(use 5, 7 or 9\)/,
      );
    }
  });
});

describe('savitzkyGolayPoint', () => {
  it('reproduces a quadratic exactly — the defining property of the filter', () => {
    for (const w of WIDTHS) {
      const half = w >> 1;
      const win = Array.from({ length: w }, (_, k) => quad(k));
      expect(savitzkyGolayPoint(win, w)).toBeCloseTo(quad(half), 10);
    }
  });

  it('reproduces a straight line and a constant exactly (degree 0 and 1 are in the span)', () => {
    expect(savitzkyGolayPoint([2, 2, 2, 2, 2], 5)).toBeCloseTo(2, 15);
    expect(savitzkyGolayPoint([0, 10, 20, 30, 40], 5)).toBeCloseTo(20, 12);
  });

  it('defaults to width 5 when no width is given', () => {
    const win = [1, -4, 7, 2, 5];
    expect(savitzkyGolayPoint(win)).toBe(savitzkyGolayPoint(win, DEFAULT_SG_WINDOW));
    expect(savitzkyGolayPoint(win)).toBeCloseTo(
      (-3 * 1 + 12 * -4 + 17 * 7 + 12 * 2 + -3 * 5) / 35,
      12,
    );
  });

  it('accepts a Float64Array window and agrees with the array form', () => {
    const win = [4, 9, 1, 6, 3];
    expect(savitzkyGolayPoint(Float64Array.from(win), 5)).toBeCloseTo(
      savitzkyGolayPoint(win, 5),
      15,
    );
  });

  it('rejects a window whose length does not match the width', () => {
    expect(() => savitzkyGolayPoint([1, 2, 3, 4], 5)).toThrow(
      'window length 4 does not match width 5',
    );
    expect(() => savitzkyGolayPoint([1, 2, 3, 4, 5, 6], 5)).toThrow(
      'window length 6 does not match width 5',
    );
    expect(() => savitzkyGolayPoint(new Float64Array(3))).toThrow(
      'window length 3 does not match width 5',
    );
  });

  it('rejects an unsupported width before it ever looks at the window', () => {
    expect(() => savitzkyGolayPoint([1, 2, 3], 3)).toThrow(/unsupported Savitzky-Golay window: 3/);
  });

  it('attenuates a 2 Hz sinusoid at 30 fps by 0.26 % — the closed-form response', () => {
    const c = savitzkyGolayCoefficients(5);
    const omega = (2 * Math.PI * 2) / 30;
    const gain = response(c, omega);
    // Sample a sine at its own peak, centred in the window.
    const win = Array.from({ length: 5 }, (_, k) => 20 * Math.cos((k - 2) * omega));
    expect(savitzkyGolayPoint(win, 5) / 20).toBeCloseTo(gain, 12);
    expect(1 - gain).toBeCloseTo(0.002563, 6);
  });

  it('inverts and crushes a Nyquist-rate alternation to exactly −13/35', () => {
    expect(savitzkyGolayPoint([1, -1, 1, -1, 1], 5)).toBeCloseTo(-13 / 35, 15);
    expect(response(savitzkyGolayCoefficients(5), Math.PI)).toBeCloseTo(-13 / 35, 15);
  });
});

describe('savitzkyGolay over a series', () => {
  it('returns a Float64Array of the same length', () => {
    const out = savitzkyGolay([1, 2, 3, 4, 5, 6, 7], 5);
    expect(out).toBeInstanceOf(Float64Array);
    expect(out).toHaveLength(7);
  });

  it('passes a series shorter than the window through completely unfiltered', () => {
    for (const n of [0, 1, 2, 3, 4]) {
      const src = Array.from({ length: n }, (_, i) => i * 3 + 1);
      expect(Array.from(savitzkyGolay(src, 5))).toEqual(src);
    }
  });

  it('passes a short Float64Array through unfiltered too', () => {
    const src = Float64Array.from([9, -2, 4]);
    expect(Array.from(savitzkyGolay(src, 5))).toEqual([9, -2, 4]);
  });

  it('never consults a kernel when the series is too short — even for an unsupported width', () => {
    // n < width short-circuits before savitzkyGolayCoefficients is reached.
    expect(Array.from(savitzkyGolay([1, 2, 3], 6))).toEqual([1, 2, 3]);
    // …but a long enough series does reach it, and throws.
    expect(() => savitzkyGolay([1, 2, 3, 4, 5, 6, 7], 6)).toThrow(
      /unsupported Savitzky-Golay window: 6/,
    );
  });

  it('reproduces a quadratic exactly in the interior, at every supported width', () => {
    for (const w of WIDTHS) {
      const n = 20;
      const src = Array.from({ length: n }, (_, i) => quad(i));
      const out = savitzkyGolay(src, w);
      const half = w >> 1;
      for (let i = half; i < n - half; i++) expect(out[i]).toBeCloseTo(quad(i), 8);
    }
  });

  it('leaves exactly (width−1)/2 samples untouched at each end', () => {
    for (const w of WIDTHS) {
      const half = w >> 1;
      const n = 16;
      // Pure noise: any filtering at all would visibly change these values.
      const src = Array.from({ length: n }, (_, i) => Math.sin(i * 7.3) * 100 + i * i);
      const out = savitzkyGolay(src, w);
      for (let i = 0; i < half; i++) expect(out[i]).toBe(src[i]);
      for (let i = n - half; i < n; i++) expect(out[i]).toBe(src[i]);
      // The first and last interior samples ARE filtered — the boundary is exact.
      expect(out[half]).not.toBe(src[half]);
      expect(out[n - half - 1]).not.toBe(src[n - half - 1]);
    }
  });

  it('handles n exactly equal to the width — one filtered sample, the centre', () => {
    const src = [1, -3, 8, 0, 5];
    const out = savitzkyGolay(src, 5);
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(-3);
    expect(out[2]).toBeCloseTo(savitzkyGolayPoint(src, 5), 15);
    expect(out[3]).toBe(0);
    expect(out[4]).toBe(5);
  });

  it('defaults to width 5', () => {
    const src = Array.from({ length: 12 }, (_, i) => Math.cos(i) * 4 + i);
    expect(Array.from(savitzkyGolay(src))).toEqual(
      Array.from(savitzkyGolay(src, DEFAULT_SG_WINDOW)),
    );
  });

  it('agrees sample-for-sample with the single-point filter over the interior', () => {
    const src = Array.from({ length: 30 }, (_, i) => Math.sin(i / 3) * 12 + Math.cos(i * 2.1) * 3);
    for (const w of WIDTHS) {
      const out = savitzkyGolay(src, w);
      const half = w >> 1;
      for (let i = half; i < src.length - half; i++) {
        expect(out[i]).toBeCloseTo(savitzkyGolayPoint(src.slice(i - half, i + half + 1), w), 12);
      }
    }
  });

  it('accepts a Float64Array series and matches the array result', () => {
    const src = Array.from({ length: 14 }, (_, i) => i % 5) as number[];
    expect(Array.from(savitzkyGolay(Float64Array.from(src), 7))).toEqual(
      Array.from(savitzkyGolay(src, 7)),
    );
  });

  it('suppresses added noise while leaving the underlying signal intact', () => {
    const fs = 30;
    const n = 120;
    const clean = Array.from({ length: n }, (_, i) => 20 * Math.sin((2 * Math.PI * 2 * i) / fs));
    // Deterministic, zero-mean, high-frequency contamination.
    const noisy = clean.map((v, i) => v + (i % 2 === 0 ? 1.5 : -1.5));
    const err = (s: readonly number[] | Float64Array) => {
      let acc = 0;
      for (let i = 2; i < n - 2; i++) acc += ((s[i] as number) - (clean[i] as number)) ** 2;
      return Math.sqrt(acc / (n - 4));
    };
    const before = err(noisy);
    const after = err(savitzkyGolay(noisy, 5));
    expect(before).toBeCloseTo(1.5, 12);
    // Nyquist gain is |−13/35| = 0.371, so the noise term shrinks by that factor;
    // what is left is that plus the 0.26 % signal attenuation.
    expect(after).toBeLessThan(before * 0.42);
    expect(after).toBeGreaterThan(0);
  });
});
