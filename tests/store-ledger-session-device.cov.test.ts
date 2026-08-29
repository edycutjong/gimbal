// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SESSION_SCHEMA,
  sessionId,
  contentHash,
  quantiseVelocities,
  dequantiseVelocities,
  bytesToBase64,
  base64ToBytes,
  VELOCITY_SCALE,
  VELOCITY_MAX,
  type PersistedSession,
} from '../src/store/session.ts';
import { buildDeviceSignature, describeSignature } from '../src/store/deviceSignature.ts';
import { trendAnnotation, exampleBanner, MIN_SESSIONS_FOR_TREND } from '../src/store/ledger.ts';
import { testCard } from './helpers.ts';

const sig = buildDeviceSignature({
  userAgent: 'cov-agent',
  cameraLabel: 'cov-cam',
  resolution: '640x480',
  medianFps: 29.8,
});

const otherSig = buildDeviceSignature({
  userAgent: 'cov-agent-2',
  cameraLabel: 'cov-cam-2',
  resolution: '1280x720',
  medianFps: 24.2,
});

function session(overrides: Partial<PersistedSession> = {}): PersistedSession {
  const startedAt = overrides.startedAt ?? '2026-08-27T09:14:22Z';
  const ratio = overrides.totals?.ratio ?? 0.5;
  return {
    schema: SESSION_SCHEMA,
    id: overrides.id ?? sessionId(startedAt, 1, overrides.provenance ?? 'live'),
    provenance: 'live',
    startedAt,
    cardId: 'cov-card',
    cardHash: 'fnv1a:0000000000000000',
    card: testCard(),
    device: sig,
    blocks: [],
    symptom: { baseline: 2, gates: [], final: 3 },
    totals: { prescribedSeconds: 360, deliveredSeconds: Math.round(360 * ratio), ratio },
    appVersion: 'gimbal test',
    methodsRev: 'METHODS.md@test',
    ...overrides,
  };
}

/** Six rows on `sig`, one per day, with the supplied ratios in chronological order. */
function sixWithRatios(ratios: readonly number[], extra: Partial<PersistedSession> = {}): PersistedSession[] {
  return ratios.map((ratio, i) =>
    session({
      id: `s-cov-${i}`,
      startedAt: `2026-08-1${i}T09:00:00Z`,
      totals: { prescribedSeconds: 360, deliveredSeconds: Math.round(360 * ratio), ratio },
      ...extra,
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('ledger — trendAnnotation', () => {
  it('reports RISING when the median of the last three exceeds the median of the three before', () => {
    const rows = sixWithRatios([0.4, 0.5, 0.45, 0.8, 0.75, 0.9]);
    const trend = trendAnnotation(rows, sig.sigHash);
    expect(trend.kind).toBe('rising');
    expect(trend.includesExample).toBe(false);
    expect(trend.text).toBe(
      'Delivered dose is higher across your last sessions than the three before them.',
    );
    expect(trend.text).not.toContain('(includes example sessions)');
    expect(trend.used.length).toBe(MIN_SESSIONS_FOR_TREND);
  });

  it('tags a RISING annotation when an example row sits inside the six-session window', () => {
    const rows = sixWithRatios([0.4, 0.5, 0.45, 0.8, 0.75, 0.9]);
    (rows[2] as PersistedSession).provenance = 'example';
    const trend = trendAnnotation(rows, sig.sigHash);
    expect(trend.kind).toBe('rising');
    expect(trend.includesExample).toBe(true);
    expect(trend.text).toBe(
      'Delivered dose is higher across your last sessions than the three before them. (includes example sessions)',
    );
  });

  it('reports FLAT-OR-DECLINING on an exact tie — equal medians are not "rising"', () => {
    const rows = sixWithRatios([0.6, 0.6, 0.6, 0.6, 0.6, 0.6]);
    const trend = trendAnnotation(rows, sig.sigHash);
    expect(trend.kind).toBe('flat-or-declining');
    expect(trend.text).toBe(
      'Delivered dose is flat or declining across your last sessions — worth a check-in with your PT.',
    );
  });

  it('leaves includesExample FALSE when the only example row is older than the six-session window', () => {
    // Seven rows: the oldest is the example, so it is used[] but NOT window[].
    const rows = [
      session({
        id: 's-cov-old',
        startedAt: '2026-08-09T09:00:00Z',
        provenance: 'example',
        totals: { prescribedSeconds: 360, deliveredSeconds: 180, ratio: 0.5 },
      }),
      ...sixWithRatios([0.4, 0.5, 0.45, 0.8, 0.75, 0.9]),
    ];
    const trend = trendAnnotation(rows, sig.sigHash);
    expect(trend.used.length).toBe(7);
    expect(trend.used.some((s) => s.provenance === 'example')).toBe(true);
    expect(trend.includesExample).toBe(false);
    expect(trend.text).not.toContain('(includes example sessions)');
  });

  it('breaks a startedAt tie by id so the window is deterministic', () => {
    const tie = '2026-08-15T09:00:00Z';
    // Two rows share startedAt. Fed in reverse id order; the sort must still put
    // `a` before `b`, which is what decides whether the low ratio is in the
    // prior half or the recent half.
    const rows = [
      session({ id: 's-cov-0', startedAt: '2026-08-10T09:00:00Z', totals: { prescribedSeconds: 360, deliveredSeconds: 144, ratio: 0.4 } }),
      session({ id: 's-cov-1', startedAt: '2026-08-11T09:00:00Z', totals: { prescribedSeconds: 360, deliveredSeconds: 162, ratio: 0.45 } }),
      session({ id: 's-cov-2', startedAt: '2026-08-12T09:00:00Z', totals: { prescribedSeconds: 360, deliveredSeconds: 180, ratio: 0.5 } }),
      session({ id: 's-cov-zz', startedAt: tie, totals: { prescribedSeconds: 360, deliveredSeconds: 324, ratio: 0.9 } }),
      session({ id: 's-cov-aa', startedAt: tie, totals: { prescribedSeconds: 360, deliveredSeconds: 288, ratio: 0.8 } }),
      session({ id: 's-cov-9', startedAt: '2026-08-16T09:00:00Z', totals: { prescribedSeconds: 360, deliveredSeconds: 270, ratio: 0.75 } }),
    ];
    const trend = trendAnnotation(rows, sig.sigHash);
    expect(trend.used.map((s) => s.id)).toEqual([
      's-cov-0',
      's-cov-1',
      's-cov-2',
      's-cov-aa',
      's-cov-zz',
      's-cov-9',
    ]);
    expect(trend.kind).toBe('rising');
  });

  it('flags an example row in an insufficient-history ledger and counts only this device', () => {
    const rows = [
      session({ id: 's-cov-a', startedAt: '2026-08-10T09:00:00Z', provenance: 'example' }),
      session({ id: 's-cov-b', startedAt: '2026-08-11T09:00:00Z' }),
      // Four rows on another device: stored, but neither counted nor plotted.
      ...Array.from({ length: 4 }, (_, i) =>
        session({ id: `s-cov-other-${i}`, startedAt: `2026-08-2${i}T09:00:00Z`, device: otherSig }),
      ),
    ];
    const trend = trendAnnotation(rows, sig.sigHash);
    expect(trend.kind).toBe('insufficient-history');
    expect(trend.includesExample).toBe(true);
    expect(trend.used.length).toBe(2);
    expect(trend.text).toBe(
      `${MIN_SESSIONS_FOR_TREND} sessions needed on this device before a trend is shown — 2 stored.`,
    );
  });

  it('returns insufficient-history with includesExample FALSE for an empty ledger', () => {
    const trend = trendAnnotation([], sig.sigHash);
    expect(trend.kind).toBe('insufficient-history');
    expect(trend.includesExample).toBe(false);
    expect(trend.used).toEqual([]);
    expect(trend.text).toContain('0 stored.');
  });
});

describe('ledger — exampleBanner', () => {
  it('returns null when the ledger holds no example rows', () => {
    expect(exampleBanner([])).toBeNull();
    expect(exampleBanner(sixWithRatios([0.4, 0.5, 0.45, 0.8, 0.75, 0.9]))).toBeNull();
  });

  it('names the count and the true first/last example dates regardless of input order', () => {
    const rows = [
      session({ id: 's-cov-live', startedAt: '2026-07-01T08:00:00Z' }),
      session({ id: 'ex-3', startedAt: '2026-08-20T11:30:00Z', provenance: 'example', capturedBy: 'developer' }),
      session({ id: 'ex-1', startedAt: '2026-08-02T07:05:00Z', provenance: 'example', capturedBy: 'developer' }),
      session({ id: 'ex-2', startedAt: '2026-08-11T19:45:00Z', provenance: 'example', capturedBy: 'developer' }),
    ];
    const banner = exampleBanner(rows);
    expect(banner).toBe(
      'This ledger contains 3 example sessions recorded by the developer on this device, ' +
        '2026-08-02 to 2026-08-20. They are real recordings of real exercise, not patient data and not a clinical trial.',
    );
  });

  it('uses the same date for first and last when there is exactly one example row', () => {
    const banner = exampleBanner([
      session({ id: 'ex-only', startedAt: '2026-08-05T06:00:00Z', provenance: 'example' }),
    ]);
    expect(banner).toContain('contains 1 example sessions');
    expect(banner).toContain('2026-08-05 to 2026-08-05');
  });

  it('does not mutate the caller array while sorting', () => {
    const rows = [
      session({ id: 'ex-b', startedAt: '2026-08-20T11:30:00Z', provenance: 'example' }),
      session({ id: 'ex-a', startedAt: '2026-08-02T07:05:00Z', provenance: 'example' }),
    ];
    const order = rows.map((s) => s.id);
    exampleBanner(rows);
    expect(rows.map((s) => s.id)).toEqual(order);
  });
});

describe('session — sessionId', () => {
  it('prefixes an example row `ex-` and a live row `s-` from the same instant', () => {
    const iso = '2026-08-27T09:14:22.512Z';
    expect(sessionId(iso, 1, 'example')).toBe('ex-20260827T091422-01');
    expect(sessionId(iso, 1, 'live')).toBe('s-20260827T091422-01');
  });

  it('zero-pads the counter to two digits and keeps three-digit counters intact', () => {
    expect(sessionId('2026-01-02T03:04:05Z', 7, 'live')).toBe('s-20260102T030405-07');
    expect(sessionId('2026-01-02T03:04:05Z', 42, 'example')).toBe('ex-20260102T030405-42');
    expect(sessionId('2026-01-02T03:04:05Z', 123, 'live')).toBe('s-20260102T030405-123');
  });

  it('is reproducible — the same inputs give the same id, and it is never a UUID', () => {
    const a = sessionId('2026-08-27T09:14:22Z', 3, 'example');
    expect(sessionId('2026-08-27T09:14:22Z', 3, 'example')).toBe(a);
    expect(a).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});

describe('session — hashing and quantisation', () => {
  it('contentHash is deterministic, order-sensitive, and fixed width', () => {
    const h = contentHash('gimbal');
    expect(h).toBe(contentHash('gimbal'));
    expect(h).not.toBe(contentHash('labmig'));
    expect(h).toMatch(/^fnv1a:[0-9a-f]{16}$/);
    // The empty string still hashes to the padded seed pair, never to ''.
    expect(contentHash('')).toMatch(/^fnv1a:[0-9a-f]{16}$/);
  });

  it('base64 helpers round-trip an arbitrary byte range including 0 and 255', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
    expect(base64ToBytes('').length).toBe(0);
  });

  it('clamps beyond the Int16 range rather than wrapping, and drops a trailing odd byte', () => {
    expect(dequantiseVelocities(quantiseVelocities([VELOCITY_MAX * 2]))[0]).toBeCloseTo(32767 / VELOCITY_SCALE, 6);
    expect(dequantiseVelocities(quantiseVelocities([-VELOCITY_MAX * 2]))[0]).toBeCloseTo(-32768 / VELOCITY_SCALE, 6);
    // Three bytes: one whole sample plus a dangling byte that must be ignored.
    expect(dequantiseVelocities(bytesToBase64(new Uint8Array([0x64, 0x00, 0x7f])))).toEqual([2]);
    expect(quantiseVelocities([])).toBe('');
    expect(dequantiseVelocities('')).toEqual([]);
  });
});

describe('deviceSignature', () => {
  it('describes a signature with the camera label and one decimal place of fps', () => {
    expect(describeSignature(sig)).toBe('cov-cam · 640x480 · 29.8 fps');
    expect(describeSignature(otherSig)).toBe('cov-cam-2 · 1280x720 · 24.2 fps');
  });

  it('falls back to "unnamed camera" when the browser withholds the device label', () => {
    const unlabelled = buildDeviceSignature({
      userAgent: 'cov-agent',
      cameraLabel: '',
      resolution: '640x480',
      medianFps: 30,
    });
    expect(unlabelled.cameraLabel).toBe('');
    expect(describeSignature(unlabelled)).toBe('unnamed camera · 640x480 · 30.0 fps');
  });

  it('buckets fps to 1 fps before hashing but prints the unbucketed value', () => {
    const a = buildDeviceSignature({ userAgent: 'ua', cameraLabel: 'cam', resolution: '640x480', medianFps: 29.7 });
    const b = buildDeviceSignature({ userAgent: 'ua', cameraLabel: 'cam', resolution: '640x480', medianFps: 29.9 });
    const c = buildDeviceSignature({ userAgent: 'ua', cameraLabel: 'cam', resolution: '640x480', medianFps: 24 });
    expect(a.sigHash).toBe(b.sigHash);
    expect(a.sigHash).not.toBe(c.sigHash);
    expect(describeSignature(a)).toBe('cam · 640x480 · 29.7 fps');
    expect(describeSignature(b)).toBe('cam · 640x480 · 29.9 fps');
    expect(a.medianFps).toBe(29.7);
  });
});
