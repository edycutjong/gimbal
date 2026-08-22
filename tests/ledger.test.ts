import { describe, it, expect, beforeEach } from 'vitest';
import {
  quantiseVelocities,
  dequantiseVelocities,
  VELOCITY_SCALE,
  VELOCITY_MAX,
  SESSION_SCHEMA,
  sessionId,
  type PersistedSession,
} from '../src/store/session.ts';
import {
  loadSessions,
  saveSessions,
  clearAllData,
  SESSIONS_KEY,
  SESSION_CAP,
} from '../src/store/local.ts';
import { trendAnnotation, MIN_SESSIONS_FOR_TREND } from '../src/store/ledger.ts';
import { buildDeviceSignature } from '../src/store/deviceSignature.ts';
import { INSTRUMENT_LIMITS } from '../src/dsp/limits.ts';
import { scoreCycle } from '../src/dsp/score.ts';
import { testCard, testCycle } from './helpers.ts';

/** Minimal in-memory Storage so the node test exercises the real module. */
class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return Array.from(this.map.keys())[i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  has(k: string): boolean {
    return this.map.has(k);
  }
}

let mem: MemoryStorage;
beforeEach(() => {
  mem = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: mem, configurable: true, writable: true });
});

const sig = buildDeviceSignature({
  userAgent: 'test-agent',
  cameraLabel: 'test-cam',
  resolution: '640x480',
  medianFps: 29.8,
});

function session(overrides: Partial<PersistedSession> = {}): PersistedSession {
  const startedAt = overrides.startedAt ?? '2026-08-27T09:14:22Z';
  return {
    schema: SESSION_SCHEMA,
    id: overrides.id ?? sessionId(startedAt, 1, overrides.provenance ?? 'live'),
    provenance: 'live',
    startedAt,
    cardId: 'test-card',
    cardHash: 'fnv1a:0000000000000000',
    card: testCard(),
    device: sig,
    blocks: [],
    symptom: { baseline: 2, gates: [], final: 3 },
    totals: { prescribedSeconds: 360, deliveredSeconds: 246, ratio: 0.683 },
    appVersion: 'gimbal test',
    methodsRev: 'METHODS.md@test',
    ...overrides,
  };
}

describe('ledger and storage', () => {
  it('round-trips Int16 quantisation within 0.01 °/s — half an LSB at scale 50', () => {
    const values = [0, 1.234, 75.5, 250.71, -180.33, VELOCITY_MAX];
    const back = dequantiseVelocities(quantiseVelocities(values));
    expect(back.length).toBe(values.length);
    // Half an LSB at scale 50 is exactly 0.01 °/s. The 1e-9 is IEEE-754
    // representation slack on a value that lands exactly on the boundary, not
    // measurement error.
    const HALF_LSB = 1 / VELOCITY_SCALE / 2;
    for (let i = 0; i < values.length; i++) {
      expect(Math.abs((back[i] as number) - (values[i] as number))).toBeLessThanOrEqual(HALF_LSB + 1e-9);
    }
    expect(HALF_LSB).toBeCloseTo(0.01, 12);
    expect(VELOCITY_MAX).toBeCloseTo(655.34, 2);
    expect(1 / VELOCITY_SCALE).toBeCloseTo(0.02, 10);
  });

  it('REFUSES a cycle beyond ±655.34 °/s rather than clipping it', () => {
    const card = testCard({ ceiling: 600 });
    const saturated = testCycle({ peakOmega: 700, saturated: true });
    const r = scoreCycle(saturated, card);
    expect(r.credited).toBe(false);
    expect(r.reason).toBe('low-confidence');
    expect(saturated.peakOmega).toBeGreaterThan(INSTRUMENT_LIMITS.quantisationMaxDegPerSec);
  });

  it('evicts the oldest row at the 100-session FIFO cap', () => {
    const rows = Array.from({ length: SESSION_CAP + 5 }, (_, i) =>
      session({ id: `s-${String(i).padStart(3, '0')}`, startedAt: `2026-08-${String((i % 28) + 1).padStart(2, '0')}T09:00:00Z` }),
    );
    saveSessions(rows);
    const { sessions } = loadSessions();
    expect(sessions.length).toBe(SESSION_CAP);
    // The five oldest by (startedAt, id) are gone.
    const sortedIn = [...rows].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
    const evicted = sortedIn.slice(0, 5).map((s) => s.id);
    for (const id of evicted) expect(sessions.some((s) => s.id === id)).toBe(false);
  });

  it('stores a different device signature but EXCLUDES it from the trend', () => {
    const other = buildDeviceSignature({
      userAgent: 'other-agent',
      cameraLabel: 'other-cam',
      resolution: '1280x720',
      medianFps: 24,
    });
    const rows = [
      ...Array.from({ length: MIN_SESSIONS_FOR_TREND }, (_, i) =>
        session({ id: `s-mine-${i}`, startedAt: `2026-08-1${i}T09:00:00Z` }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        session({ id: `s-other-${i}`, startedAt: `2026-08-2${i}T09:00:00Z`, device: other }),
      ),
    ];
    saveSessions(rows);
    const { sessions } = loadSessions();
    expect(sessions.length).toBe(rows.length);
    const trend = trendAnnotation(sessions, sig.sigHash);
    expect(trend.used.length).toBe(MIN_SESSIONS_FOR_TREND);
    expect(trend.kind).not.toBe('insufficient-history');
    for (const s of trend.used) expect(s.device.sigHash).toBe(sig.sigHash);
  });

  it('surfaces an unknown gimbal.session/N rather than parsing or silently dropping it', () => {
    mem.setItem(
      SESSIONS_KEY,
      JSON.stringify([session(), { ...session({ id: 's-future' }), schema: 'gimbal.session/9' }]),
    );
    const res = loadSessions();
    expect(res.sessions.length).toBe(1);
    expect(res.unknownSchemaCount).toBe(1);
  });

  it('leaves the key ABSENT after clear-all, not an empty array', () => {
    saveSessions([session()]);
    expect(mem.has(SESSIONS_KEY)).toBe(true);
    clearAllData();
    expect(mem.has(SESSIONS_KEY)).toBe(false);
    expect(mem.getItem(SESSIONS_KEY)).toBeNull();
  });

  it('renders no annotation below six sessions on one device', () => {
    const rows = Array.from({ length: MIN_SESSIONS_FOR_TREND - 1 }, (_, i) =>
      session({ id: `s-${i}`, startedAt: `2026-08-1${i}T09:00:00Z` }),
    );
    const trend = trendAnnotation(rows, sig.sigHash);
    expect(trend.kind).toBe('insufficient-history');
    expect(trend.text).toContain(`${MIN_SESSIONS_FOR_TREND} sessions needed`);
    expect(trend.text).toContain(`${rows.length} stored`);
  });

  it('tags the annotation when any example row is inside the window', () => {
    const rows = Array.from({ length: MIN_SESSIONS_FOR_TREND }, (_, i) =>
      session({
        id: `s-${i}`,
        startedAt: `2026-08-1${i}T09:00:00Z`,
        provenance: i === 0 ? 'example' : 'live',
        capturedBy: i === 0 ? 'developer' : undefined,
      }),
    );
    const trend = trendAnnotation(rows, sig.sigHash);
    expect(trend.includesExample).toBe(true);
    expect(trend.text).toContain('(includes example sessions)');
  });
});
