// @vitest-environment jsdom
/**
 * Coverage suite for the two files that touch browser hardware:
 * `src/capture/camera.ts` (getUserMedia + the requestVideoFrameCallback clock)
 * and `src/capture/landmarker.ts` (the MediaPipe FaceLandmarker WASM runtime).
 *
 * jsdom implements neither `getUserMedia` nor a WASM vision runtime, so both are
 * substituted INSIDE this file — `vi.mock` for `@mediapipe/tasks-vision`, a
 * hand-built `navigator.mediaDevices` for the camera. Nothing under `src/` is
 * substituted; every assertion below is on the real module's real behaviour
 * (the constraints it asks for, the DOMException names it maps, the cleanup it
 * performs, the same-origin asset paths it loads).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  REQUESTED_WIDTH,
  REQUESTED_HEIGHT,
  detectSupport,
  requestCamera,
  listCameras,
  reEnableSteps,
  FrameClock,
} from '../src/capture/camera.ts';

import {
  MODEL_PATH,
  WASM_PATH,
  createLandmarker,
  createLandmarkerWithFallback,
  readResult,
} from '../src/capture/landmarker.ts';

// ---------------------------------------------------------------------------
// MediaPipe runtime substitute. The real package ships a WASM loader that
// fetches a fileset from the network; this records what the loader was asked
// for so the same-origin claim can be asserted rather than assumed.
// ---------------------------------------------------------------------------

interface VisionRecord {
  forVisionTasksArgs: string[];
  createArgs: { fileset: unknown; options: Record<string, unknown> }[];
  forVisionTasksError: Error | null;
  /** Delegates that must throw at creation time, to drive the GPU→CPU fallback. */
  failingDelegates: Set<string>;
}

const vision: VisionRecord = vi.hoisted(() => ({
  forVisionTasksArgs: [] as string[],
  createArgs: [] as { fileset: unknown; options: Record<string, unknown> }[],
  forVisionTasksError: null as Error | null,
  failingDelegates: new Set<string>(),
}));

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: {
    forVisionTasks: async (path: string) => {
      vision.forVisionTasksArgs.push(path);
      if (vision.forVisionTasksError) throw vision.forVisionTasksError;
      return { wasmLoaderPath: `${path}/vision_wasm_internal.js` };
    },
  },
  FaceLandmarker: {
    createFromOptions: async (fileset: unknown, options: Record<string, unknown>) => {
      vision.createArgs.push({ fileset, options });
      const delegate = (options.baseOptions as { delegate?: string } | undefined)?.delegate ?? '';
      if (vision.failingDelegates.has(delegate)) {
        throw new Error(`delegate ${delegate} unavailable`);
      }
      return { __delegate: delegate };
    },
  },
}));

// ---------------------------------------------------------------------------
// Environment substitutes for camera.ts
// ---------------------------------------------------------------------------

/** An HTMLVideoElement constructor that advertises per-frame callbacks. */
class VideoWithFrameCallbacks {
  requestVideoFrameCallback(): number {
    return 0;
  }
  cancelVideoFrameCallback(): void {}
}

/** …and one that does not, the pre-2021 Firefox shape. */
class VideoWithoutFrameCallbacks {}

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const FIREFOX_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0';

type NavigatorLike = {
  userAgent?: string;
  mediaDevices?: {
    getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
    enumerateDevices?: () => Promise<MediaDeviceInfo[]>;
  };
};

function stubNavigator(nav: NavigatorLike | undefined): void {
  vi.stubGlobal('navigator', nav);
}

/** Puts every feature detectSupport() looks for in place; individual tests remove one. */
function stubSupportedEnvironment(nav?: NavigatorLike): void {
  stubNavigator(nav ?? { userAgent: CHROME_UA, mediaDevices: { getUserMedia: async () => null as never } });
  vi.stubGlobal('HTMLVideoElement', VideoWithFrameCallbacks);
  vi.stubGlobal('AudioContext', class {});
}

/** A MediaStreamTrack substitute: the object requestCamera reads label + settings from. */
function makeTrack(label: string | undefined, settings: MediaTrackSettings | undefined) {
  return {
    label,
    getSettings: () => settings,
  } as unknown as MediaStreamTrack;
}

function makeStream(tracks: MediaStreamTrack[]): MediaStream {
  return { getVideoTracks: () => tracks } as unknown as MediaStream;
}

function domError(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

beforeEach(() => {
  vision.forVisionTasksArgs.length = 0;
  vision.createArgs.length = 0;
  vision.forVisionTasksError = null;
  vision.failingDelegates.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ===========================================================================
// detectSupport
// ===========================================================================

describe('detectSupport — the honest unsupported screen', () => {
  it('reports supported when camera, per-frame callbacks, Web Audio and WebAssembly are all present', () => {
    stubSupportedEnvironment();
    expect(detectSupport()).toEqual({ supported: true, missing: [] });
  });

  it('names camera access when there is no navigator at all', () => {
    stubSupportedEnvironment();
    stubNavigator(undefined);
    const r = detectSupport();
    expect(r.supported).toBe(false);
    expect(r.missing).toEqual(['camera access']);
  });

  it('names camera access when navigator exists but mediaDevices does not (insecure context)', () => {
    stubSupportedEnvironment();
    stubNavigator({ userAgent: CHROME_UA });
    expect(detectSupport().missing).toEqual(['camera access']);
  });

  it('names camera access when mediaDevices exists but getUserMedia is absent', () => {
    stubSupportedEnvironment();
    stubNavigator({ userAgent: CHROME_UA, mediaDevices: {} });
    expect(detectSupport().missing).toEqual(['camera access']);
  });

  it('names per-frame video callbacks when HTMLVideoElement is undefined', () => {
    stubSupportedEnvironment();
    vi.stubGlobal('HTMLVideoElement', undefined);
    expect(detectSupport().missing).toEqual(['per-frame video callbacks']);
  });

  it('names per-frame video callbacks when the prototype lacks requestVideoFrameCallback', () => {
    stubSupportedEnvironment();
    vi.stubGlobal('HTMLVideoElement', VideoWithoutFrameCallbacks);
    expect(detectSupport().missing).toEqual(['per-frame video callbacks']);
  });

  it('names Web Audio when AudioContext is missing', () => {
    stubSupportedEnvironment();
    vi.stubGlobal('AudioContext', undefined);
    expect(detectSupport().missing).toEqual(['Web Audio']);
  });

  it('names WebAssembly when the runtime has none', () => {
    stubSupportedEnvironment();
    vi.stubGlobal('WebAssembly', undefined);
    expect(detectSupport().missing).toEqual(['WebAssembly']);
  });

  it('accumulates every missing capability rather than reporting only the first', () => {
    stubSupportedEnvironment();
    stubNavigator(undefined);
    vi.stubGlobal('HTMLVideoElement', undefined);
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('WebAssembly', undefined);
    expect(detectSupport().missing).toEqual([
      'camera access',
      'per-frame video callbacks',
      'Web Audio',
      'WebAssembly',
    ]);
  });
});

// ===========================================================================
// requestCamera
// ===========================================================================

describe('requestCamera — constraints requested', () => {
  it('asks for 640x480 @30 user-facing video with audio off, and reports the granted stream', async () => {
    const calls: MediaStreamConstraints[] = [];
    const track = makeTrack('FaceTime HD Camera', { width: 1280, height: 720 } as MediaTrackSettings);
    const stream = makeStream([track]);
    stubSupportedEnvironment({
      userAgent: CHROME_UA,
      mediaDevices: {
        getUserMedia: async (c) => {
          calls.push(c);
          return stream;
        },
      },
    });

    const res = await requestCamera();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.handle.stream).toBe(stream);
    expect(res.handle.label).toBe('FaceTime HD Camera');
    // The REQUESTED resolution is not echoed back — what the track reports is.
    expect(res.handle.resolution).toBe('1280x720');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      video: {
        width: { ideal: REQUESTED_WIDTH },
        height: { ideal: REQUESTED_HEIGHT },
        frameRate: { ideal: 30 },
        facingMode: 'user',
      },
      audio: false,
    });
    expect(REQUESTED_WIDTH).toBe(640);
    expect(REQUESTED_HEIGHT).toBe(480);
  });

  it('pins deviceId with an exact constraint when one is given', async () => {
    const calls: MediaStreamConstraints[] = [];
    stubSupportedEnvironment({
      userAgent: CHROME_UA,
      mediaDevices: {
        getUserMedia: async (c) => {
          calls.push(c);
          return makeStream([makeTrack('Rear', { width: 640, height: 480 } as MediaTrackSettings)]);
        },
      },
    });

    const res = await requestCamera('cam-42');
    expect(res.ok).toBe(true);
    const video = (calls[0] as { video: Record<string, unknown> }).video;
    expect(video.deviceId).toEqual({ exact: 'cam-42' });
    expect(video.facingMode).toBe('user');
  });

  it('falls back to the requested resolution and an "unnamed camera" label when the track reports nothing', async () => {
    stubSupportedEnvironment({
      userAgent: CHROME_UA,
      mediaDevices: {
        // A track that exists but whose getSettings() reports an empty dictionary.
        getUserMedia: async () => makeStream([makeTrack(undefined, {} as MediaTrackSettings)]),
      },
    });
    const res = await requestCamera();
    if (!res.ok) throw new Error('expected ok');
    expect(res.handle.label).toBe('unnamed camera');
    expect(res.handle.resolution).toBe('640x480');
  });

  it('survives a stream that carries no video track at all', async () => {
    const stream = makeStream([]);
    stubSupportedEnvironment({
      userAgent: CHROME_UA,
      mediaDevices: { getUserMedia: async () => stream },
    });
    const res = await requestCamera();
    if (!res.ok) throw new Error('expected ok');
    expect(res.handle.stream).toBe(stream);
    expect(res.handle.label).toBe('unnamed camera');
    expect(res.handle.resolution).toBe('640x480');
  });
});

describe('requestCamera — error mapping to designed permission screens', () => {
  function stubRejecting(err: unknown): void {
    stubSupportedEnvironment({
      userAgent: CHROME_UA,
      mediaDevices: {
        getUserMedia: async () => {
          throw err;
        },
      },
    });
  }

  it('refuses to prompt at all when the browser cannot run the instrument', async () => {
    let prompted = false;
    stubSupportedEnvironment({
      userAgent: CHROME_UA,
      mediaDevices: {
        getUserMedia: async () => {
          prompted = true;
          return makeStream([]);
        },
      },
    });
    // Remove one required capability AFTER wiring the camera: feature detection
    // must short-circuit before any permission prompt is raised.
    vi.stubGlobal('AudioContext', undefined);

    expect(await requestCamera()).toEqual({ ok: false, state: 'unsupported' });
    expect(prompted).toBe(false);
  });

  it('maps NotAllowedError to denied', async () => {
    stubRejecting(domError('NotAllowedError'));
    expect(await requestCamera()).toEqual({ ok: false, state: 'denied' });
  });

  it('maps SecurityError to denied', async () => {
    stubRejecting(domError('SecurityError'));
    expect(await requestCamera()).toEqual({ ok: false, state: 'denied' });
  });

  it('maps NotFoundError to no-camera', async () => {
    stubRejecting(domError('NotFoundError'));
    expect(await requestCamera()).toEqual({ ok: false, state: 'no-camera' });
  });

  it('maps OverconstrainedError to no-camera', async () => {
    stubRejecting(domError('OverconstrainedError'));
    expect(await requestCamera('missing-device')).toEqual({ ok: false, state: 'no-camera' });
  });

  it('maps NotReadableError to in-use — the camera is held by another app', async () => {
    stubRejecting(domError('NotReadableError'));
    expect(await requestCamera()).toEqual({ ok: false, state: 'in-use' });
  });

  it('maps AbortError to in-use — the track ended before it could be delivered', async () => {
    stubRejecting(domError('AbortError'));
    expect(await requestCamera()).toEqual({ ok: false, state: 'in-use' });
  });

  it('maps an unrecognised DOMException name to unsupported', async () => {
    stubRejecting(domError('TypeError'));
    expect(await requestCamera()).toEqual({ ok: false, state: 'unsupported' });
  });

  it('maps an error object with no name at all to unsupported', async () => {
    stubRejecting({});
    expect(await requestCamera()).toEqual({ ok: false, state: 'unsupported' });
  });

  it('maps a thrown non-object to unsupported rather than crashing', async () => {
    stubRejecting(undefined);
    expect(await requestCamera()).toEqual({ ok: false, state: 'unsupported' });
  });
});

// ===========================================================================
// listCameras
// ===========================================================================

describe('listCameras', () => {
  it('returns only videoinput devices', async () => {
    const devices = [
      { deviceId: 'a', kind: 'videoinput', label: 'Front' },
      { deviceId: 'b', kind: 'audioinput', label: 'Mic' },
      { deviceId: 'c', kind: 'audiooutput', label: 'Speakers' },
      { deviceId: 'd', kind: 'videoinput', label: 'External' },
    ] as unknown as MediaDeviceInfo[];
    stubNavigator({ mediaDevices: { enumerateDevices: async () => devices } });

    const out = await listCameras();
    expect(out.map((d) => d.deviceId)).toEqual(['a', 'd']);
  });

  it('returns an empty list when mediaDevices is unavailable', async () => {
    stubNavigator({});
    expect(await listCameras()).toEqual([]);
  });

  it('returns an empty list when enumerateDevices is not implemented', async () => {
    stubNavigator({ mediaDevices: {} });
    expect(await listCameras()).toEqual([]);
  });

  it('swallows an enumerateDevices rejection instead of propagating it', async () => {
    stubNavigator({
      mediaDevices: {
        enumerateDevices: async () => {
          throw domError('NotAllowedError');
        },
      },
    });
    expect(await listCameras()).toEqual([]);
  });
});

// ===========================================================================
// reEnableSteps
// ===========================================================================

describe('reEnableSteps — literal per-browser steps, never a link', () => {
  it('gives the Settings → Websites → Camera path on real Safari', () => {
    stubNavigator({ userAgent: SAFARI_UA });
    const steps = reEnableSteps();
    expect(steps[0]).toContain('Safari');
    expect(steps[0]).toContain('Websites');
    expect(steps).toHaveLength(3);
    expect(steps.some((s) => /https?:\/\//.test(s))).toBe(false);
  });

  it('gives the address-bar path on Chrome, whose UA also contains "Safari"', () => {
    stubNavigator({ userAgent: CHROME_UA });
    expect(reEnableSteps()[0]).toContain('address bar');
  });

  it('gives the address-bar path on Edge, whose UA contains both "Safari" and "Edg"', () => {
    stubNavigator({ userAgent: `${CHROME_UA} Edg/140.0.0.0` });
    expect(reEnableSteps()[0]).toContain('address bar');
  });

  it('gives the address-bar path on Firefox, whose UA contains no "Safari" token', () => {
    stubNavigator({ userAgent: FIREFOX_UA });
    expect(reEnableSteps()[0]).toContain('address bar');
  });

  it('falls back to the address-bar path when there is no navigator to sniff', () => {
    stubNavigator(undefined);
    expect(reEnableSteps()[0]).toContain('address bar');
  });
});

// ===========================================================================
// FrameClock
// ===========================================================================

/**
 * A controllable `requestVideoFrameCallback` host. Frames are delivered only
 * when the test asks for them, carrying a mediaTime in SECONDS exactly as the
 * real VideoFrameCallbackMetadata does.
 */
function makeVideoHost() {
  let nextId = 1;
  let pending: { id: number; cb: (now: number, meta: { mediaTime: number }) => void } | null = null;
  let retained: ((now: number, meta: { mediaTime: number }) => void) | null = null;
  const cancelled: number[] = [];
  const issued: number[] = [];

  const video = {
    requestVideoFrameCallback(cb: (now: number, meta: { mediaTime: number }) => void): number {
      const id = nextId++;
      issued.push(id);
      pending = { id, cb };
      retained = cb;
      return id;
    },
    cancelVideoFrameCallback(id: number): void {
      cancelled.push(id);
      if (pending?.id === id) pending = null;
    },
  } as unknown as HTMLVideoElement;

  return {
    video,
    cancelled,
    issued,
    get pendingId(): number | null {
      return pending?.id ?? null;
    },
    /** Delivers one frame at `mediaTimeSec` through the currently registered callback. */
    frame(mediaTimeSec: number): void {
      if (!pending) throw new Error('no frame callback is registered');
      const { cb } = pending;
      pending = null;
      cb(performance.now(), { mediaTime: mediaTimeSec });
    },
    /** Delivers a frame through a callback the browser had already scheduled, even after stop(). */
    deliverRetained(mediaTimeSec: number): void {
      if (!retained) throw new Error('nothing retained');
      retained(performance.now(), { mediaTime: mediaTimeSec });
    },
  };
}

describe('FrameClock — the frame clock comes from the camera, not Date.now()', () => {
  it('reports the camera mediaTime in ms and NaN for the first interval', () => {
    const host = makeVideoHost();
    const seen: { tMs: number; intervalMs: number }[] = [];
    const clock = new FrameClock(host.video, (t) => seen.push(t));

    clock.start();
    host.frame(1.0);
    host.frame(1.0333);

    expect(seen).toHaveLength(2);
    expect(seen[0]?.tMs).toBeCloseTo(1000, 6);
    expect(Number.isNaN(seen[0]?.intervalMs as number)).toBe(true);
    expect(seen[1]?.tMs).toBeCloseTo(1033.3, 6);
    expect(seen[1]?.intervalMs).toBeCloseTo(33.3, 6);
  });

  it('re-arms itself once per delivered frame and never double-arms', () => {
    const host = makeVideoHost();
    const clock = new FrameClock(host.video, () => {});
    clock.start();
    expect(host.issued).toEqual([1]);
    host.frame(0.1);
    host.frame(0.2);
    expect(host.issued).toEqual([1, 2, 3]);
    clock.stop();
  });

  it('start() is idempotent — a second call does not register a second callback', () => {
    const host = makeVideoHost();
    const clock = new FrameClock(host.video, () => {});
    clock.start();
    clock.start();
    clock.start();
    expect(host.issued).toEqual([1]);
    clock.stop();
  });

  it('stop() cancels the outstanding frame callback and clears the handle', () => {
    const host = makeVideoHost();
    const clock = new FrameClock(host.video, () => {});
    clock.start();
    host.frame(0.1);
    const outstanding = host.pendingId;
    expect(outstanding).not.toBeNull();

    clock.stop();
    expect(host.cancelled).toEqual([outstanding]);
    // Handle cleared: a second stop() has nothing left to cancel.
    clock.stop();
    expect(host.cancelled).toEqual([outstanding]);
  });

  it('stop() before start() is a no-op — nothing is cancelled', () => {
    const host = makeVideoHost();
    const clock = new FrameClock(host.video, () => {});
    clock.stop();
    expect(host.cancelled).toEqual([]);
  });

  it('ignores a frame the browser had already scheduled when stop() ran', () => {
    const host = makeVideoHost();
    const seen: number[] = [];
    const clock = new FrameClock(host.video, (t) => seen.push(t.tMs));
    clock.start();
    host.frame(0.1);
    host.frame(0.2);
    expect(seen).toHaveLength(2);

    clock.stop();
    // The browser fires the in-flight callback anyway; it must not reach onFrame
    // and must not re-arm the clock.
    const armedBefore = host.issued.length;
    host.deliverRetained(0.3);
    expect(seen).toHaveLength(2);
    expect(host.issued.length).toBe(armedBefore);
  });

  it('restarts cleanly after stop(), treating the next frame as a first frame', () => {
    const host = makeVideoHost();
    const seen: number[] = [];
    const clock = new FrameClock(host.video, (t) => seen.push(t.intervalMs));
    clock.start();
    host.frame(0.0);
    host.frame(0.02);
    clock.stop();

    clock.start();
    host.frame(5.0);
    expect(Number.isNaN(seen[2] as number)).toBe(true);
  });
});

describe('FrameClock — measured cadence', () => {
  it('medianIntervalMs is NaN before any interval has been observed', () => {
    const host = makeVideoHost();
    const clock = new FrameClock(host.video, () => {});
    expect(Number.isNaN(clock.medianIntervalMs())).toBe(true);
    expect(Number.isNaN(clock.effectiveFps())).toBe(true);

    // Still NaN after exactly one frame: one timestamp is not an interval.
    clock.start();
    host.frame(1.0);
    expect(Number.isNaN(clock.medianIntervalMs())).toBe(true);
    expect(Number.isNaN(clock.effectiveFps())).toBe(true);
  });

  it('takes the median of an odd-length sample', () => {
    const host = makeVideoHost();
    const clock = new FrameClock(host.video, () => {});
    clock.start();
    // Intervals, in ms: 10, 50, 20 → sorted 10, 20, 50 → median 20.
    for (const t of [0, 0.01, 0.06, 0.08]) host.frame(t);
    expect(clock.medianIntervalMs()).toBeCloseTo(20, 6);
    expect(clock.effectiveFps()).toBeCloseTo(50, 6);
  });

  it('averages the two middle samples of an even-length sample', () => {
    const host = makeVideoHost();
    const clock = new FrameClock(host.video, () => {});
    clock.start();
    // Intervals: 10, 50, 20, 40 → sorted 10, 20, 40, 50 → median 30.
    for (const t of [0, 0.01, 0.06, 0.08, 0.12]) host.frame(t);
    expect(clock.medianIntervalMs()).toBeCloseTo(30, 6);
    expect(clock.effectiveFps()).toBeCloseTo(1000 / 30, 6);
  });

  it('one stall does not move the median — the reason it is not a mean', () => {
    const host = makeVideoHost();
    const clock = new FrameClock(host.video, () => {});
    clock.start();
    let t = 0;
    host.frame(t);
    for (let i = 0; i < 20; i++) {
      t += 1 / 30;
      host.frame(t);
    }
    // A 900 ms stall.
    t += 0.9;
    host.frame(t);
    expect(clock.medianIntervalMs()).toBeCloseTo(1000 / 30, 3);
    expect(clock.effectiveFps()).toBeCloseTo(30, 3);
  });

  it('discards a non-advancing or backwards mediaTime instead of recording it', () => {
    const host = makeVideoHost();
    const seen: number[] = [];
    const clock = new FrameClock(host.video, (f) => seen.push(f.intervalMs));
    clock.start();
    host.frame(1.0);
    host.frame(1.0); // duplicate timestamp → interval 0, not a sample
    host.frame(0.9); // mediaTime went backwards → negative interval, not a sample
    host.frame(0.94); // +40 ms from 0.9 → the only recorded sample

    expect(seen[1]).toBe(0);
    expect(seen[2]).toBeCloseTo(-100, 6);
    expect(clock.medianIntervalMs()).toBeCloseTo(40, 6);
  });

  it('keeps a rolling window of at most 600 intervals', () => {
    const host = makeVideoHost();
    const clock = new FrameClock(host.video, () => {});
    clock.start();
    // 700 intervals: the first 100 are 100 ms, the rest 10 ms. Once the window
    // has rolled, only the 10 ms population survives.
    let t = 0;
    host.frame(t);
    for (let i = 0; i < 100; i++) {
      t += 0.1;
      host.frame(t);
    }
    expect(clock.medianIntervalMs()).toBeCloseTo(100, 6);
    for (let i = 0; i < 700; i++) {
      t += 0.01;
      host.frame(t);
    }
    expect(clock.medianIntervalMs()).toBeCloseTo(10, 6);
  });

  it('reset() drops the sample window and the previous timestamp', () => {
    const host = makeVideoHost();
    const seen: number[] = [];
    const clock = new FrameClock(host.video, (f) => seen.push(f.intervalMs));
    clock.start();
    for (const t of [0, 0.02, 0.04]) host.frame(t);
    expect(clock.medianIntervalMs()).toBeCloseTo(20, 6);

    clock.reset();
    expect(Number.isNaN(clock.medianIntervalMs())).toBe(true);
    expect(Number.isNaN(clock.effectiveFps())).toBe(true);

    // The next frame is a first frame again, so it contributes no interval.
    host.frame(9.0);
    expect(Number.isNaN(seen[3] as number)).toBe(true);
    expect(Number.isNaN(clock.medianIntervalMs())).toBe(true);
  });
});

// ===========================================================================
// landmarker.ts
// ===========================================================================

describe('landmarker asset paths — same-origin, content-addressed, no CDN', () => {
  it('exposes a same-origin model path carrying a content hash', () => {
    expect(WASM_PATH).toBe('/model');
    expect(MODEL_PATH.startsWith('/model/')).toBe(true);
    expect(MODEL_PATH).toMatch(/^\/model\/face_landmarker\.[0-9a-f]{8}\.task$/);
    for (const p of [MODEL_PATH, WASM_PATH]) {
      expect(p).not.toMatch(/^https?:/);
      expect(p).not.toMatch(/\/\//);
      expect(p.toLowerCase()).not.toContain('cdn');
      expect(p.toLowerCase()).not.toContain('jsdelivr');
      expect(p.toLowerCase()).not.toContain('storage.googleapis');
    }
  });

  it('asks the fileset resolver for the vendored same-origin directory only', async () => {
    await createLandmarker();
    expect(vision.forVisionTasksArgs).toEqual([WASM_PATH]);
    expect(vision.forVisionTasksArgs[0]).not.toMatch(/^https?:/);
  });
});

describe('createLandmarker — configured for rigid head orientation only', () => {
  it('requests transformation matrixes, one face, VIDEO mode, and no blendshapes', async () => {
    const lm = await createLandmarker();
    expect(lm).toBeDefined();
    expect(vision.createArgs).toHaveLength(1);
    const { fileset, options } = vision.createArgs[0] as { fileset: unknown; options: Record<string, unknown> };
    expect(fileset).toEqual({ wasmLoaderPath: '/model/vision_wasm_internal.js' });
    expect(options).toEqual({
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  });

  it('defaults the delegate to GPU and honours an explicit CPU request', async () => {
    await createLandmarker({});
    await createLandmarker({ delegate: 'CPU' });
    await createLandmarker({ delegate: 'GPU' });
    const delegates = vision.createArgs.map(
      (c) => (c.options.baseOptions as { delegate: string }).delegate,
    );
    expect(delegates).toEqual(['GPU', 'CPU', 'GPU']);
  });

  it('propagates a fileset-resolution failure rather than returning a half-built task', async () => {
    vision.forVisionTasksError = new Error('wasm fetch failed');
    await expect(createLandmarker()).rejects.toThrow('wasm fetch failed');
    expect(vision.createArgs).toHaveLength(0);
  });
});

describe('createLandmarkerWithFallback — GPU feature-detected, not trusted', () => {
  it('returns the GPU delegate when GPU creation succeeds, without trying CPU', async () => {
    const { delegate } = await createLandmarkerWithFallback();
    expect(delegate).toBe('GPU');
    expect(vision.createArgs).toHaveLength(1);
  });

  it('falls back to CPU when the GPU delegate throws', async () => {
    vision.failingDelegates.add('GPU');
    const { landmarker, delegate } = await createLandmarkerWithFallback();
    expect(delegate).toBe('CPU');
    expect(landmarker).toEqual({ __delegate: 'CPU' });
    const delegates = vision.createArgs.map(
      (c) => (c.options.baseOptions as { delegate: string }).delegate,
    );
    expect(delegates).toEqual(['GPU', 'CPU']);
  });

  it('propagates the CPU failure when neither delegate can be created', async () => {
    vision.failingDelegates.add('GPU');
    vision.failingDelegates.add('CPU');
    await expect(createLandmarkerWithFallback()).rejects.toThrow('delegate CPU unavailable');
  });
});

describe('readResult', () => {
  it('reports a present face and copies the 16-element row-major matrix out', () => {
    const data = Float32Array.from(Array.from({ length: 16 }, (_, i) => i + 1));
    const r = readResult({
      faceLandmarks: [new Array(478).fill({ x: 0, y: 0, z: 0 })],
      facialTransformationMatrixes: [{ data }],
    });
    expect(r.facePresent).toBe(true);
    expect(r.matrix).toHaveLength(16);
    expect(Array.isArray(r.matrix)).toBe(true);
    expect(r.matrix).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    // A copy, not a live view into the task's buffer.
    data[0] = 99;
    expect(r.matrix[0]).toBe(1);
  });

  it('accepts a plain number[] payload as well as a Float32Array', () => {
    const r = readResult({
      faceLandmarks: [{}],
      facialTransformationMatrixes: [{ data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
    });
    expect(r.facePresent).toBe(true);
    expect(r.matrix[15]).toBe(1);
  });

  it('reports no face when the result carries no landmarks key at all', () => {
    expect(readResult({})).toEqual({ facePresent: false, matrix: [] });
  });

  it('reports no face when the landmark list is present but empty', () => {
    expect(readResult({ faceLandmarks: [], facialTransformationMatrixes: [{ data: new Array(16).fill(0) }] })).toEqual(
      { facePresent: false, matrix: [] },
    );
  });

  it('reports no face when landmarks exist but no transformation matrix was fitted', () => {
    expect(readResult({ faceLandmarks: [{}], facialTransformationMatrixes: [] })).toEqual({
      facePresent: false,
      matrix: [],
    });
    expect(readResult({ faceLandmarks: [{}] })).toEqual({ facePresent: false, matrix: [] });
  });
});
