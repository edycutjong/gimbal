import { describe, it, expect } from 'vitest';
import { dominantFrequency, spectrum, hannWindow, HANN_COHERENT_GAIN, FFT_SIZE } from '../src/dsp/fft.ts';

const FS = 30;

function sine(freqHz: number, amplitude: number, n = FFT_SIZE, fs = FS): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / fs);
  return out;
}

describe('256-point Hann-windowed real FFT', () => {
  it('peaks in the bin containing 2.0 Hz for sin(2π·2·t) at 30 fps', () => {
    const { magnitude, binWidthHz } = spectrum(sine(2, 20), FS);
    let peakBin = 0;
    for (let k = 1; k < magnitude.length; k++) {
      if ((magnitude[k] as number) > (magnitude[peakBin] as number)) peakBin = k;
    }
    expect(peakBin * binWidthHz).toBeLessThanOrEqual(2.0);
    expect((peakBin + 1) * binWidthHz).toBeGreaterThanOrEqual(2.0);
  });

  it('has a bin width of exactly 30/256 = 0.1172 Hz', () => {
    const { binWidthHz } = spectrum(sine(2, 20), FS);
    expect(binWidthHz).toBeCloseTo(30 / 256, 12);
    expect(binWidthHz).toBeCloseTo(0.1172, 4);
  });

  it('applies a Hann window with coherent gain 0.5', () => {
    const w = hannWindow(FFT_SIZE);
    let sum = 0;
    for (let i = 0; i < w.length; i++) sum += w[i] as number;
    expect(sum / FFT_SIZE).toBeCloseTo(HANN_COHERENT_GAIN, 2);
  });

  it('recovers an off-bin 2.06 Hz input to within 0.02 Hz by parabolic interpolation', () => {
    const est = dominantFrequency(sine(2.06, 20), FS, { minHz: 0.5, maxHz: 6 });
    expect(est.frequencyHz).not.toBeNull();
    expect(Math.abs((est.frequencyHz as number) - 2.06)).toBeLessThan(0.02);
  });

  it('yields zero AC energy for a DC input', () => {
    const dc = new Float64Array(FFT_SIZE).fill(7);
    const { magnitude } = spectrum(dc, FS);
    for (let k = 1; k < magnitude.length; k++) expect(magnitude[k] as number).toBeLessThan(1e-9);
  });

  it('scales amplitude linearly', () => {
    const a = dominantFrequency(sine(2, 10), FS, { minHz: 0.5, maxHz: 6 });
    const b = dominantFrequency(sine(2, 20), FS, { minHz: 0.5, maxHz: 6 });
    expect(b.magnitude / a.magnitude).toBeCloseTo(2, 1);
  });

  it('does not alias a Nyquist input into the therapeutic band', () => {
    const est = dominantFrequency(sine(FS / 2, 20), FS, { minHz: 0.5, maxHz: 6 });
    // A 15 Hz input must not masquerade as a 1-6 Hz peak of comparable size.
    const band = dominantFrequency(sine(2, 20), FS, { minHz: 0.5, maxHz: 6 });
    expect(est.magnitude).toBeLessThan(band.magnitude * 0.1);
  });

  it('returns no peak rather than NaN for an all-zero input', () => {
    const est = dominantFrequency(new Float64Array(FFT_SIZE), FS);
    expect(est.frequencyHz).toBeNull();
    expect(Number.isNaN(est.magnitude)).toBe(false);
  });
});
