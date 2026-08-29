import { describe, it, expect } from 'vitest';
import { dominantFrequency, spectrum, fftInPlace, hannWindow, FFT_SIZE } from '../src/dsp/fft.ts';

const FS = 30;

describe('fftInPlace input validation', () => {
  it('rejects re/im arrays of differing length', () => {
    expect(() => fftInPlace(new Float64Array(4), new Float64Array(8))).toThrow(
      /same length/,
    );
  });

  it('rejects a non-power-of-two length', () => {
    expect(() => fftInPlace(new Float64Array(6), new Float64Array(6))).toThrow(
      /power of two, got 6/,
    );
  });

  it('rejects an empty transform', () => {
    expect(() => fftInPlace(new Float64Array(0), new Float64Array(0))).toThrow(
      /power of two, got 0/,
    );
  });

  it('accepts a length-1 transform and leaves it untouched', () => {
    const re = Float64Array.from([3]);
    const im = Float64Array.from([-4]);
    fftInPlace(re, im);
    // The 1-point DFT is the identity.
    expect(re[0]).toBe(3);
    expect(im[0]).toBe(-4);
  });
});

describe('spectrum of an empty series', () => {
  it('treats a zero-length series as all-zero rather than dividing by zero', () => {
    const { magnitude, binWidthHz } = spectrum([], FS);
    expect(binWidthHz).toBeCloseTo(FS / FFT_SIZE, 12);
    expect(magnitude.length).toBe(FFT_SIZE / 2 + 1);
    for (let k = 0; k < magnitude.length; k++) {
      expect(Number.isNaN(magnitude[k] as number)).toBe(false);
      expect(magnitude[k] as number).toBe(0);
    }
  });

  it('reports no dominant frequency for a zero-length series', () => {
    const est = dominantFrequency([], FS);
    expect(est.frequencyHz).toBeNull();
    expect(est.magnitude).toBe(0);
  });
});

describe('dominantFrequency energy floor', () => {
  it('reports no peak when a real peak exists but sits below the 1e-12 AC floor', () => {
    // A genuine 2 Hz sine, amplitude 1e-15: the peak bin is found (peakBin >= 0)
    // but its magnitude is under the floor, so the absence is reported.
    const tiny = new Float64Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) tiny[i] = 1e-15 * Math.sin((2 * Math.PI * 2 * i) / FS);

    const { magnitude } = spectrum(tiny, FS);
    let peak = 0;
    for (let k = 1; k < magnitude.length; k++) peak = Math.max(peak, magnitude[k] as number);
    expect(peak).toBeGreaterThan(0); // the peak is really there…
    expect(peak).toBeLessThanOrEqual(1e-12); // …and really below the floor

    const est = dominantFrequency(tiny, FS, { minHz: 0.5, maxHz: 6 });
    expect(est.frequencyHz).toBeNull();
    expect(est.magnitude).toBe(0);
  });
});

describe('parabolic interpolation of a degenerate (flat) peak', () => {
  // A windowed unit impulse has an analytically FLAT magnitude spectrum:
  // |DFT(a·δ[i-p])_k| = |a| for every k. Here the mean-removed, Hann-windowed
  // series [-1,0,0,0,1] over an 8-point transform leaves exactly one non-zero
  // sample (index 4, since w[0] = 0), so bins 1..3 carry identical magnitude
  // and the three-point parabola through the peak is degenerate.
  const flat = [-1, 0, 0, 0, 1];
  const SIZE = 8;
  const FS8 = 8; // binWidthHz = 8/8 = 1 Hz

  it('produces a flat single-sided spectrum for a windowed impulse', () => {
    const { magnitude } = spectrum(flat, FS8, SIZE);
    const a = hannWindow(SIZE)[4] as number;
    // Interior bins are doubled (mirror energy) then divided by the Hann
    // coherent gain 0.5; DC and Nyquist are not doubled.
    const interior = (a / SIZE / 0.5) * 2;
    const edge = a / SIZE / 0.5;
    expect(magnitude[0] as number).toBeCloseTo(edge, 15);
    expect(magnitude[4] as number).toBeCloseTo(edge, 15);
    for (const k of [1, 2, 3]) expect(magnitude[k] as number).toBeCloseTo(interior, 15);
    // Bit-exact equality across the three interior bins is what makes the
    // parabola denominator vanish below.
    expect(magnitude[1]).toBe(magnitude[2]);
    expect(magnitude[3]).toBe(magnitude[2]);
  });

  it('falls back to the bin centre when the peak parabola is degenerate', () => {
    const { magnitude } = spectrum(flat, FS8, SIZE);
    const yPrev = magnitude[1] as number;
    const yPeak = magnitude[2] as number;
    const yNext = magnitude[3] as number;
    expect(yPrev - 2 * yPeak + yNext).toBe(0); // denom === 0 exactly

    // Restrict the band to bin 2 so the flat plateau's interior bin is the peak.
    const est = dominantFrequency(flat, FS8, { size: SIZE, minHz: 2, maxHz: 2 });
    expect(est.binWidthHz).toBe(1);
    // delta clamps to 0 → the estimate is the bin centre exactly, not NaN.
    expect(est.frequencyHz).toBe(2);
    expect(est.magnitude).toBe(yPeak);
  });
});
