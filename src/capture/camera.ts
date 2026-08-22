/**
 * Camera acquisition and the frame clock.
 *
 * Permission is a DESIGNED SCREEN with four drawn states, never a browser error
 * dialog: not-yet-asked, denied, no-camera-found, and unsupported/unavailable
 * (of which "camera in use by another app" is a variant with a different named
 * fix, not a fifth state).
 *
 * The frame clock comes from `requestVideoFrameCallback` timestamps and NEVER
 * from `Date.now()` or `getSettings().frameRate`. `getSettings()` reports the
 * REQUESTED rate: a camera whose auto-exposure lengthens the shutter in dim
 * light silently drops to ~15 fps while still reporting 30, which would halve
 * the sampling rate and produce plausible wrong numbers — the worst failure mode
 * available to a measuring instrument.
 */

export type PermissionState =
  | 'not-asked'
  | 'granted'
  | 'denied'
  | 'no-camera'
  | 'unsupported'
  | 'in-use';

export interface CameraHandle {
  stream: MediaStream;
  label: string;
  resolution: string;
}

export const REQUESTED_WIDTH = 640;
export const REQUESTED_HEIGHT = 480;

/**
 * Feature detection for the honest unsupported screen. Checked BEFORE any
 * permission prompt, so a browser that cannot run the instrument says so rather
 * than asking for a camera it cannot use.
 */
export function detectSupport(): { supported: boolean; missing: string[] } {
  const missing: string[] = [];
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) missing.push('camera access');
  if (typeof HTMLVideoElement === 'undefined' || !('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
    missing.push('per-frame video callbacks');
  }
  if (!(globalThis as { AudioContext?: unknown }).AudioContext) missing.push('Web Audio');
  if (typeof WebAssembly === 'undefined') missing.push('WebAssembly');
  return { supported: missing.length === 0, missing };
}

export async function requestCamera(deviceId?: string): Promise<
  { ok: true; handle: CameraHandle } | { ok: false; state: Exclude<PermissionState, 'granted' | 'not-asked'> }
> {
  if (!detectSupport().supported) return { ok: false, state: 'unsupported' };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: REQUESTED_WIDTH },
        height: { ideal: REQUESTED_HEIGHT },
        frameRate: { ideal: 30 },
        facingMode: 'user',
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings() ?? {};
    return {
      ok: true,
      handle: {
        stream,
        label: track?.label ?? 'unnamed camera',
        // The REQUESTED resolution is what the settings report; the effective
        // frame rate is measured separately and never read from here.
        resolution: `${settings.width ?? REQUESTED_WIDTH}x${settings.height ?? REQUESTED_HEIGHT}`,
      },
    };
  } catch (err) {
    const name = (err as { name?: string })?.name ?? '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return { ok: false, state: 'denied' };
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return { ok: false, state: 'no-camera' };
    if (name === 'NotReadableError' || name === 'AbortError') return { ok: false, state: 'in-use' };
    return { ok: false, state: 'unsupported' };
  }
}

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  } catch {
    return [];
  }
}

/** The exact per-browser re-enable path, as literal steps rather than a link. */
export function reEnableSteps(): string[] {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) {
    return [
      'Open Safari → Settings → Websites → Camera.',
      'Find this site in the list and set it to Allow.',
      'Reload this page.',
    ];
  }
  return [
    'Click the camera icon at the right-hand end of the address bar.',
    'Choose "Always allow" for this site.',
    'Reload this page.',
  ];
}

export interface FrameTiming {
  /** ms, from the camera's own clock. */
  tMs: number;
  /** ms since the previous frame. NaN on the first frame. */
  intervalMs: number;
}

/**
 * Drives one callback per decoded camera frame, carrying the camera's timestamp.
 *
 * `requestVideoFrameCallback` is what makes the cadence term of the quality
 * score honest: a frame that arrives late is visible here and nowhere else.
 */
export class FrameClock {
  private handle = 0;
  private running = false;
  private lastTMs = NaN;
  private readonly intervals: number[] = [];

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly onFrame: (t: FrameTiming) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const step = (_now: number, meta: { mediaTime: number }): void => {
      if (!this.running) return;
      const tMs = meta.mediaTime * 1000;
      const intervalMs = Number.isFinite(this.lastTMs) ? tMs - this.lastTMs : NaN;
      if (Number.isFinite(intervalMs) && intervalMs > 0) {
        this.intervals.push(intervalMs);
        if (this.intervals.length > 600) this.intervals.shift();
      }
      this.lastTMs = tMs;
      this.onFrame({ tMs, intervalMs });
      this.handle = this.video.requestVideoFrameCallback(step);
    };
    this.handle = this.video.requestVideoFrameCallback(step);
  }

  stop(): void {
    this.running = false;
    if (this.handle) this.video.cancelVideoFrameCallback(this.handle);
    this.handle = 0;
    this.lastTMs = NaN;
  }

  /** MEDIAN inter-frame interval — the median, not the mean, so one stall does not move it. */
  medianIntervalMs(): number {
    if (this.intervals.length === 0) return NaN;
    const s = [...this.intervals].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
  }

  /** The EFFECTIVE frame rate — measured, never requested. */
  effectiveFps(): number {
    const m = this.medianIntervalMs();
    return Number.isFinite(m) && m > 0 ? 1000 / m : NaN;
  }

  reset(): void {
    this.intervals.length = 0;
    this.lastTMs = NaN;
  }
}
