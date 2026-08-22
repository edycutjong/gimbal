import type { ProtocolCard } from '../protocol/card.ts';
import type { StopRuleOutcome } from '../protocol/stopRule.ts';
import type { Interruption } from '../session/dose.ts';

/**
 * The persisted session record — `gimbal.session/1`.
 *
 * This is exactly what the app writes to `localStorage`, exactly what the export
 * button downloads, and exactly what the example-ledger fixture contains. ONE
 * shape means the seeding path exercises the real import path.
 */
export const SESSION_SCHEMA = 'gimbal.session/1';

/** Int16 at scale 50 → ±655.34 °/s range at 0.02 °/s resolution. */
export const VELOCITY_SCALE = 50;
export const VELOCITY_MAX = 32767 / VELOCITY_SCALE; // 655.34

export type Provenance = 'live' | 'example';

export interface DeviceSignature {
  userAgent: string;
  cameraLabel: string;
  resolution: string;
  /** Stored UNBUCKETED because the report prints it; the hash uses the bucketed value. */
  medianFps: number;
  sigHash: string;
}

export interface PersistedBlock {
  index: number;
  prescribedSeconds: number;
  deliveredSeconds: number;
  cyclesAttempted: number;
  cyclesCredited: number;
  refusals: Record<'too-slow' | 'too-fast' | 'off-cadence' | 'low-confidence' | 'face-lost', number>;
  fHatHz: number;
  fHatBinWidthHz: number;
  gaze: { correct: number; total: number; chance: number };
  /** Base64 Int16LE, one per ATTEMPTED cycle. */
  peakVelocitiesQ: string;
  peakVelocityScale: number;
  saturatedCycles: number;
  interruptions: Interruption[];
}

export interface PersistedSession {
  schema: string;
  /** `s-<startIso>-<counter>` for live rows, `ex-…` for example rows. Never a UUID. */
  id: string;
  provenance: Provenance;
  capturedBy?: string;
  startedAt: string;
  cardId: string;
  cardHash: string;
  card: ProtocolCard;
  device: DeviceSignature;
  blocks: PersistedBlock[];
  symptom: {
    baseline: number;
    gates: { afterBlock: number; rating: number; ruling: StopRuleOutcome }[];
    final: number | null;
  };
  totals: { prescribedSeconds: number; deliveredSeconds: number; ratio: number };
  appVersion: string;
  methodsRev: string;
  /** True when the session ran with the audio-off flag set. The report says so. */
  audioOff?: boolean;
}

/**
 * Quantises per-cycle peak velocities.
 *
 * Scale 100 was REJECTED: it caps at 327.67 °/s, and a vigorous 2.5 Hz / ±25°
 * turn reaches 2π·2.5·25 ≈ 393 °/s, which would silently saturate. Any cycle
 * that does saturate is REFUSED, never clipped — a clipped velocity is a wrong
 * number, and a wrong number is worse than no number.
 */
export function quantiseVelocities(values: readonly number[]): string {
  const buf = new ArrayBuffer(values.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < values.length; i++) {
    const raw = Math.round((values[i] as number) * VELOCITY_SCALE);
    const clamped = Math.max(-32768, Math.min(32767, raw));
    view.setInt16(i * 2, clamped, true);
  }
  return bytesToBase64(new Uint8Array(buf));
}

export function dequantiseVelocities(b64: string): number[] {
  const bytes = base64ToBytes(b64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: number[] = [];
  for (let i = 0; i + 1 < bytes.byteLength; i += 2) out.push(view.getInt16(i, true) / VELOCITY_SCALE);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * FNV-1a — a short, dependency-free content hash.
 *
 * Deliberately NOT a cryptographic hash: this identifies a device signature and
 * groups a trend line. Reaching for SubtleCrypto would make every call async for
 * no security property the app actually needs, and the fixture checksums that DO
 * need SHA-256 are computed by the build script in Node, not here.
 */
export function contentHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let h2 = 0x9e3779b9;
  for (let i = input.length - 1; i >= 0; i--) {
    h2 ^= input.charCodeAt(i);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `fnv1a:${h.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** A session id that is reproducible from its own inputs — a UUID would break fixture regeneration. */
export function sessionId(startedAtIso: string, counter: number, provenance: Provenance): string {
  const stamp = startedAtIso.replace(/[-:]/g, '').replace(/\.\d+/, '').replace(/Z$/, '');
  return `${provenance === 'example' ? 'ex' : 's'}-${stamp}-${String(counter).padStart(2, '0')}`;
}
