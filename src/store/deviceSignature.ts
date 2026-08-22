import { contentHash, type DeviceSignature } from './session.ts';

/**
 * Sessions only trend together if these match.
 *
 * Cross-device comparison would contaminate the exact property that
 * differentiates this product — measurement integrity — so sessions from a
 * different camera, browser or resolution are STORED but never plotted on the
 * same trend line, and the ledger says so on screen.
 */
export function buildDeviceSignature(input: {
  userAgent: string;
  cameraLabel: string;
  resolution: string;
  medianFps: number;
}): DeviceSignature {
  // The fps is bucketed to 1 fps BEFORE hashing, so a 29.7 vs 29.9 measurement
  // does not split one device into two trend lines. It is stored unbucketed
  // because the report prints it.
  const bucketed = Math.round(input.medianFps);
  const sigHash = contentHash(
    JSON.stringify([input.userAgent, input.cameraLabel, input.resolution, bucketed]),
  );
  return { ...input, sigHash };
}

export function describeSignature(sig: DeviceSignature): string {
  return `${sig.cameraLabel || 'unnamed camera'} · ${sig.resolution} · ${sig.medianFps.toFixed(1)} fps`;
}
