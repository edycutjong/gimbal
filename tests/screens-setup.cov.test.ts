// @vitest-environment jsdom
/**
 * Coverage suite for `src/ui/screens/setup.ts` — the four-check setup screen and
 * the ten-second light-and-frame-rate measurement.
 *
 * jsdom implements neither `getUserMedia` nor `requestVideoFrameCallback`, so
 * both are substituted INSIDE this file: `navigator`, `HTMLVideoElement` and
 * `AudioContext` through `vi.stubGlobal`, and the per-frame callback as an own
 * property of the one `<video>` element the screen is handed. Nothing under
 * `src/` is mocked — `requestCamera`, `listCameras`, `FrameClock`,
 * `cardExceedsInstrument` and the copy constants are the real modules, so every
 * assertion below is on the screen's real rendered DOM and real state.
 *
 * The invariants this file exists to defend:
 *   · denied, no-camera and in-use each surface their OWN named recovery, and
 *     every failure state keeps a route to the example report
 *   · Start is disabled until the measured frame rate clears the floor DERIVED
 *     FROM THE CARD, not from this computer's speed
 *   · nothing on this screen removes a focus ring, opens a modal, raises a toast
 *     or a tooltip, and the only timer it ever sets is the 10 s check itself
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  SETUP_CHECK_MS,
  defaultSetupState,
  renderSetup,
  setupPreviewSlot,
  fpsReadout,
  type SetupProps,
  type SetupState,
} from '../src/ui/screens/setup.ts';
import { INSTRUMENT_LIMITS, minSampleRateHz } from '../src/dsp/limits.ts';
import {
  CAMERA_PRIVACY_COPY,
  EXAMPLE_REPORT_LABEL,
  FPS_FIX_COPY,
  OPTOTYPE_SIZER_COPY,
  OPTOTYPE_NO_ACUITY_COPY,
} from '../src/ui/copy.ts';
import type { ProtocolCard } from '../src/protocol/card.ts';
import { testCard } from './helpers.ts';

// ---------------------------------------------------------------------------
// Environment substitutes
// ---------------------------------------------------------------------------

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** An HTMLVideoElement constructor that advertises per-frame callbacks. */
class VideoWithFrameCallbacks {
  requestVideoFrameCallback(): number {
    return 0;
  }
  cancelVideoFrameCallback(): void {}
}

/** Every getUserMedia constraint dictionary the screen asked for, in order. */
const gumCalls: MediaStreamConstraints[] = [];

function makeStream(): MediaStream {
  return {
    getVideoTracks: () => [
      { label: 'FaceTime HD Camera', getSettings: () => ({ width: 640, height: 480 }) },
    ],
  } as unknown as MediaStream;
}

function domError(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

interface BrowserEnv {
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  enumerateDevices?: () => Promise<MediaDeviceInfo[]>;
}

/** Puts a complete, supported browser in place. Individual tests remove pieces. */
function stubBrowser(env: BrowserEnv = {}): void {
  vi.stubGlobal('navigator', {
    userAgent: CHROME_UA,
    mediaDevices: {
      getUserMedia:
        env.getUserMedia ??
        (async (c: MediaStreamConstraints) => {
          gumCalls.push(c);
          return makeStream();
        }),
      enumerateDevices: env.enumerateDevices ?? (async () => []),
    },
  });
  vi.stubGlobal('HTMLVideoElement', VideoWithFrameCallbacks);
  vi.stubGlobal('AudioContext', class {});
}

/** A getUserMedia that records its constraints and then fails a named way. */
function rejectingWith(name: string): (c: MediaStreamConstraints) => Promise<MediaStream> {
  return async (c: MediaStreamConstraints) => {
    gumCalls.push(c);
    throw domError(name);
  };
}

function videoInputs(...ids: { deviceId: string; label: string }[]): MediaDeviceInfo[] {
  return ids.map((d) => ({ ...d, kind: 'videoinput', groupId: 'g' })) as unknown as MediaDeviceInfo[];
}

// ---------------------------------------------------------------------------
// The one <video> element the screen owns
// ---------------------------------------------------------------------------

type FrameCallback = (now: number, meta: { mediaTime: number }) => void;

/**
 * A real jsdom `<video>` — the screen appends it to the framing slot, so it has
 * to be a Node — carrying a controllable `requestVideoFrameCallback` and a
 * `play()` that resolves. Frames are delivered only when a test asks for them.
 */
function makeVideoHost(playResult: () => Promise<void> = () => Promise.resolve()) {
  const video = document.createElement('video');
  let pending: FrameCallback | null = null;
  let nextId = 1;
  const cancelled: number[] = [];
  const playCalls: number[] = [];
  /** The camera's own clock, in seconds — never Date.now(). */
  let mediaTime = 0;

  Object.assign(video, {
    requestVideoFrameCallback(cb: FrameCallback): number {
      pending = cb;
      return nextId++;
    },
    cancelVideoFrameCallback(id: number): void {
      cancelled.push(id);
      pending = null;
    },
    play: () => {
      playCalls.push(1);
      return playResult();
    },
  });

  return {
    video: video as HTMLVideoElement,
    cancelled,
    get playCount(): number {
      return playCalls.length;
    },
    /** Delivers `count` frames spaced `1/fps` seconds apart on the camera clock. */
    frames(count: number, fps: number): void {
      for (let i = 0; i < count; i++) {
        const cb = pending;
        if (!cb) return;
        pending = null;
        cb(0, { mediaTime: mediaTime });
        mediaTime += 1 / fps;
      }
    },
    /** Delivers one frame `seconds` late — a stall, not a cadence. */
    stall(seconds: number): void {
      const cb = pending;
      if (!cb) throw new Error('no frame callback is registered');
      pending = null;
      mediaTime += seconds;
      cb(0, { mediaTime });
    },
  };
}

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

interface Recorded {
  start: number;
  example: number;
  audioTest: number[];
  audioOff: boolean[];
  announce: string[];
  rerender: number;
}

interface Mounted {
  host: HTMLElement;
  props: SetupProps;
  state: SetupState;
  rec: Recorded;
  vh: ReturnType<typeof makeVideoHost>;
  /** Re-renders with the current state, exactly as the app's rerender would. */
  render: () => void;
}

/**
 * Mounts the screen. `live` makes `props.rerender` actually re-render, which is
 * what the app does; the default records the call without re-entering, so a
 * handler's effect on state can be read before the DOM is replaced.
 */
function mount(
  overrides: Partial<SetupState> = {},
  opts: { card?: ProtocolCard; live?: boolean; play?: () => Promise<void>; theme?: 'dim' | 'dark' | 'light' | null } = {},
): Mounted {
  // One screen in the document at a time: the app never mounts two, and two
  // copies of `#start` would make every id lookup below ambiguous.
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.appendChild(host);
  const vh = makeVideoHost(opts.play);
  const state: SetupState = { ...defaultSetupState(), ...overrides };
  const rec: Recorded = { start: 0, example: 0, audioTest: [], audioOff: [], announce: [], rerender: 0 };

  const props: SetupProps = {
    state,
    card: opts.card ?? testCard(),
    video: vh.video,
    theme: opts.theme ?? null,
    onStart: () => {
      rec.start += 1;
    },
    onExampleReport: () => {
      rec.example += 1;
    },
    onAudioTest: (v) => rec.audioTest.push(v),
    onAudioOff: (o) => rec.audioOff.push(o),
    announce: (t) => rec.announce.push(t),
    rerender: () => {
      rec.rerender += 1;
      if (opts.live) renderSetup(host, props);
    },
  };

  const render = (): void => renderSetup(host, props);
  render();
  return { host, props, state, rec, vh, render };
}

function q<T extends Element>(host: HTMLElement, selector: string): T {
  const found = host.querySelector<T>(selector);
  if (!found) throw new Error(`missing element: ${selector}`);
  return found;
}

/** `fpsReadout` is typed nullable but throws on a missing verdict; this narrows it. */
function readout(host: HTMLElement): HTMLElement {
  const found = fpsReadout(host);
  if (!found) throw new Error('fpsReadout returned null');
  return found;
}

/** A real activation, so a disabled control stays inert exactly as it would in a browser. */
function click(host: HTMLElement, selector: string): void {
  q<HTMLElement>(host, selector).click();
}

function setRange(host: HTMLElement, selector: string, value: string): void {
  const input = q<HTMLInputElement>(host, selector);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** The card used everywhere: band 1.7–2.3 Hz, so the derived floor is 27 fps. */
const FLOOR_FPS = minSampleRateHz(2.3);
const PASSING_FPS = 30;
const FAILING_FPS = 20;

beforeEach(() => {
  vi.useFakeTimers();
  gumCalls.length = 0;
  stubBrowser();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

// ===========================================================================
// defaultSetupState
// ===========================================================================

describe('defaultSetupState', () => {
  it('starts with no permission asked, no measured frame rate and no device chosen', () => {
    const s = defaultSetupState();
    expect(s.permission).toBe('not-asked');
    expect(Number.isNaN(s.measuredFps)).toBe(true);
    expect(s).toEqual({
      permission: 'not-asked',
      optoVmin: 4.0,
      hideVideo: false,
      audioOff: false,
      volume: 0.5,
      measuredFps: NaN,
      // No measurement in flight yet. The flag is what keeps the 10 s check
      // idempotent: `measuredFps` stays NaN for the whole window, so without it
      // every re-render during the window started another FrameClock and
      // announced the verdict again.
      measuring: false,
      devices: [],
      selectedDeviceId: null,
    });
  });

  it('hands out a fresh object each call, so two screens cannot share state', () => {
    const a = defaultSetupState();
    const b = defaultSetupState();
    expect(a).not.toBe(b);
    expect(a.devices).not.toBe(b.devices);
  });
});

// ===========================================================================
// The permission panel — four designed states, never an error dialog
// ===========================================================================

describe('permission panel — not-asked', () => {
  it('states the privacy promise and offers the camera before anything else', () => {
    const { host } = mount({ permission: 'not-asked' });
    expect(q(host, '.check-card h2').textContent).toBe('Camera');
    expect(host.textContent).toContain(CAMERA_PRIVACY_COPY);
    expect(q<HTMLButtonElement>(host, '#allow-camera').textContent?.trim()).toBe('Allow camera');
    // No measurement UI exists before permission is granted.
    expect(host.querySelector('.setup-grid')).toBeNull();
    expect(host.querySelector('#start')).toBeNull();
  });

  it('renders the screen chrome: settings row, eyebrow and a focusable title', () => {
    const { host } = mount({ permission: 'not-asked' });
    expect(host.querySelector('.settings-row')).not.toBeNull();
    expect(host.querySelectorAll('input[name="theme"]')).toHaveLength(3);
    expect(q(host, '.eyebrow').textContent).toBe('Before you start');
    const title = q<HTMLHeadingElement>(host, '#screen-title');
    expect(title.textContent).toBe('Set up');
    // -1 on the heading is a programmatic focus target, not a removed stop.
    expect(title.getAttribute('tabindex')).toBe('-1');
  });

  it('honours an explicitly stored theme in the settings row', () => {
    const { host } = mount({ permission: 'not-asked' }, { theme: 'light' });
    expect(q<HTMLInputElement>(host, 'input[name="theme"][value="light"]').checked).toBe(true);
    expect(q<HTMLInputElement>(host, 'input[name="theme"][value="dark"]').checked).toBe(false);
  });
});

describe('permission panel — denied', () => {
  it('names the literal re-enable steps for this browser rather than linking away', () => {
    const { host } = mount({ permission: 'denied' });
    expect(q(host, '.check-card h2').textContent).toBe('Camera access is blocked');
    const steps = Array.from(host.querySelectorAll('ol li')).map((li) => li.textContent ?? '');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toContain('address bar');
    expect(steps.some((s) => /https?:\/\//.test(s))).toBe(false);
    expect(q<HTMLButtonElement>(host, '#allow-camera').textContent?.trim()).toBe(
      "I've enabled it — try again",
    );
  });
});

describe('permission panel — no camera found', () => {
  it('asks for a webcam and offers a retry, with no picker when nothing was enumerated', () => {
    const { host } = mount({ permission: 'no-camera', devices: [] });
    expect(q(host, '.check-card h2').textContent).toBe('No camera found');
    expect(host.textContent).toContain('Connect a webcam and try again.');
    expect(host.querySelector('#device-picker')).toBeNull();
    expect(q<HTMLButtonElement>(host, '#allow-camera').textContent?.trim()).toBe('Try again');
  });

  it('offers a labelled picker when cameras were enumerated, naming unlabelled ones', () => {
    const { host } = mount({
      permission: 'no-camera',
      devices: videoInputs({ deviceId: 'a', label: 'External USB' }, { deviceId: 'b', label: '' }),
    });
    const picker = q<HTMLSelectElement>(host, '#device-picker');
    const options = Array.from(picker.options);
    expect(options.map((o) => o.value)).toEqual(['a', 'b']);
    // A device the browser refuses to name still gets a human option label.
    expect(options.map((o) => o.textContent)).toEqual(['External USB', 'camera']);
    expect(q(host, 'label[for="device-picker"]').textContent).toBe('Camera');
  });

  it('escapes a hostile device label rather than injecting it as markup', () => {
    const { host } = mount({
      permission: 'no-camera',
      devices: videoInputs({ deviceId: '"><script>x</script>', label: '<img src=x onerror=y>' }),
    });
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('img')).toBeNull();
    const option = q<HTMLOptionElement>(host, '#device-picker option');
    expect(option.value).toBe('"><script>x</script>');
    expect(option.textContent).toBe('<img src=x onerror=y>');
  });
});

describe('permission panel — in use by another app', () => {
  it('names the fix that actually applies: close the other app, then reload', () => {
    const { host } = mount({ permission: 'in-use' });
    expect(q(host, '.check-card h2').textContent).toBe('The camera is in use by another app');
    expect(host.textContent).toContain('Close Zoom, Meet or any other app using the camera');
    expect(q<HTMLButtonElement>(host, '#allow-camera').textContent?.trim()).toBe('Try again');
    // It is a variant of unsupported, not a dead end: retry is still offered.
    expect(host.querySelector('#allow-camera')).not.toBeNull();
  });
});

describe('permission panel — unsupported browser', () => {
  it('names every missing capability and does not offer a prompt it cannot honour', () => {
    // A browser with no camera API, no per-frame callbacks and no Web Audio.
    vi.stubGlobal('navigator', { userAgent: CHROME_UA });
    vi.stubGlobal('HTMLVideoElement', class {});
    vi.stubGlobal('AudioContext', undefined);

    const { host } = mount({ permission: 'unsupported' });
    expect(q(host, '.check-card h2').textContent).toBe('This browser cannot run the measurement');
    expect(host.textContent).toContain('camera access, per-frame video callbacks, Web Audio');
    expect(host.textContent).toContain('desktop Chromium 110 or later');
    // No retry button: there is nothing a retry could change.
    expect(host.querySelector('#allow-camera')).toBeNull();
    expect(host.querySelector('#example-report')).not.toBeNull();
  });

  it('falls back to a plain sentence when nothing specific can be named', () => {
    // Every capability present — the state was reached by an unmapped failure,
    // so detectSupport() has no specific missing feature to list.
    const { host } = mount({ permission: 'unsupported' });
    expect(host.textContent).toContain('features this browser does not provide');
    expect(host.querySelector('#allow-camera')).toBeNull();
  });
});

describe('every failure state keeps a route to the artefact', () => {
  it('offers the example report from not-asked, denied, no-camera, in-use and unsupported', () => {
    for (const permission of ['not-asked', 'denied', 'no-camera', 'in-use', 'unsupported'] as const) {
      const { host, rec } = mount({ permission });
      const button = q<HTMLButtonElement>(host, '#example-report');
      expect(button.textContent).toBe(EXAMPLE_REPORT_LABEL);
      expect(button.classList.contains('no-print')).toBe(true);
      button.click();
      expect(rec.example).toBe(1);
    }
  });

  it('withdraws it once the camera is granted — there is no longer a wall to route around', () => {
    const { host, rec } = mount({ permission: 'granted', measuredFps: PASSING_FPS });
    expect(host.querySelector('#example-report')).toBeNull();
    expect(host.querySelector('.check-card h2')?.textContent).toBe('Framing');
    expect(rec.example).toBe(0);
  });
});

// ===========================================================================
// The granted screen
// ===========================================================================

describe('granted — the four checks', () => {
  it('renders framing, frame rate, target size and sound, and mounts the live preview', () => {
    const { host, props, vh } = mount({ permission: 'granted', measuredFps: PASSING_FPS });
    const headings = Array.from(host.querySelectorAll('.setup-grid h2')).map((h) => h.textContent);
    expect(headings).toEqual(['Framing', 'Light and frame rate', 'Target size', 'Sound']);

    const slot = setupPreviewSlot(host);
    expect(slot).not.toBeNull();
    expect(slot?.hasAttribute('hidden')).toBe(false);
    expect(slot?.firstElementChild).toBe(vh.video);
    expect(props.video.className).toBe('framing');
    expect(props.video.hidden).toBe(false);
    expect(host.textContent).toContain('No face mesh is drawn.');
    expect(q<HTMLButtonElement>(host, '#toggle-video').textContent).toBe('Hide my video');
  });

  it('reports the MEASURED frame rate and the floor derived from the card', () => {
    const { host } = mount({ permission: 'granted', measuredFps: PASSING_FPS });
    expect(readout(host).textContent).toBe('30.0 fps measured');
    expect(host.textContent).toContain(`at least ${FLOOR_FPS} frames per second`);
    expect(FLOOR_FPS).toBe(27);
    expect(host.textContent).toContain("derived from your clinician's band, not from this computer's speed");
    expect(host.querySelector('.field-error')).toBeNull();
  });

  it('shows the target sizer at the current size, with the acuity disclaimer', () => {
    const { host } = mount({ permission: 'granted', measuredFps: PASSING_FPS, optoVmin: 4 });
    expect(host.textContent).toContain(OPTOTYPE_SIZER_COPY);
    expect(host.textContent).toContain(OPTOTYPE_NO_ACUITY_COPY);
    expect(q<HTMLElement>(host, '#opto-preview').style.getPropertyValue('--opto-d')).toBe('4vmin');
    expect(host.querySelector('#opto-preview svg.optotype')).not.toBeNull();
    const range = q<HTMLInputElement>(host, '#opto-size');
    expect([range.min, range.max, range.step, range.value]).toEqual(['1.2', '9', '0.1', '4']);
  });

  it('offers the pacing sound with a volume control at the stored volume', () => {
    const { host } = mount({ permission: 'granted', measuredFps: PASSING_FPS, volume: 0.5 });
    expect(q<HTMLButtonElement>(host, '#audio-test').textContent).toBe('Play the pacing sound');
    const volume = q<HTMLInputElement>(host, '#volume');
    expect([volume.min, volume.max, volume.step, volume.value]).toEqual(['0', '1', '0.05', '0.5']);
    expect(q<HTMLButtonElement>(host, '#audio-off').textContent?.trim()).toBe("I can't use sound");
    expect(host.querySelector('.banner')).toBeNull();
  });
});

describe('granted — hiding your own video', () => {
  it('hides the slot, relabels the control and leaves the video unmounted', () => {
    const { host, vh } = mount({ permission: 'granted', measuredFps: PASSING_FPS, hideVideo: true });
    const slot = setupPreviewSlot(host);
    expect(slot?.hasAttribute('hidden')).toBe(true);
    expect(slot?.firstElementChild).toBeNull();
    expect(slot?.contains(vh.video)).toBe(false);
    expect(q<HTMLButtonElement>(host, '#toggle-video').textContent).toBe('Show my video');
  });

  it('toggling does not disturb the measurement — the frame rate readout survives', () => {
    const m = mount({ permission: 'granted', measuredFps: PASSING_FPS }, { live: true });
    click(m.host, '#toggle-video');
    expect(m.state.hideVideo).toBe(true);
    expect(m.rec.rerender).toBe(1);
    expect(setupPreviewSlot(m.host)?.hasAttribute('hidden')).toBe(true);
    expect(readout(m.host).textContent).toBe('30.0 fps measured');
    expect(m.state.measuredFps).toBe(PASSING_FPS);

    click(m.host, '#toggle-video');
    expect(m.state.hideVideo).toBe(false);
    expect(m.rec.rerender).toBe(2);
    expect(setupPreviewSlot(m.host)?.firstElementChild).toBe(m.vh.video);
  });
});

describe('granted — sound off', () => {
  it('announces on the report that the session was coached without audio', () => {
    const { host } = mount({ permission: 'granted', measuredFps: PASSING_FPS, audioOff: true });
    expect(q<HTMLButtonElement>(host, '#audio-off').textContent?.trim()).toBe('Turn sound back on');
    expect(q(host, '.banner').textContent).toContain(
      'The report will say the session was coached without audio.',
    );
  });

  it('flips both ways and tells the app each time', () => {
    const m = mount({ permission: 'granted', measuredFps: PASSING_FPS }, { live: true });
    click(m.host, '#audio-off');
    expect(m.state.audioOff).toBe(true);
    expect(m.rec.audioOff).toEqual([true]);
    expect(m.host.querySelector('.banner')).not.toBeNull();

    click(m.host, '#audio-off');
    expect(m.state.audioOff).toBe(false);
    expect(m.rec.audioOff).toEqual([true, false]);
    expect(m.host.querySelector('.banner')).toBeNull();
    expect(m.rec.rerender).toBe(2);
  });
});

// ===========================================================================
// The gate: Start stays disabled until the frame rate clears the card's floor
// ===========================================================================

describe('the frame-rate gate', () => {
  it('enables Start when the measured rate clears the floor', () => {
    const { host, rec } = mount({ permission: 'granted', measuredFps: PASSING_FPS });
    const start = q<HTMLButtonElement>(host, '#start');
    expect(start.disabled).toBe(false);
    expect(start.hasAttribute('aria-disabled')).toBe(false);
    expect(host.textContent).not.toContain('Start stays disabled');
    click(host, '#start');
    expect(rec.start).toBe(1);
  });

  it('disables Start and names the fix when the camera is too slow for the prescription', () => {
    const { host, rec } = mount({ permission: 'granted', measuredFps: FAILING_FPS });
    const start = q<HTMLButtonElement>(host, '#start');
    expect(start.disabled).toBe(true);
    expect(start.getAttribute('aria-disabled')).toBe('true');
    expect(host.textContent).toContain('Start stays disabled until the frame-rate check passes.');

    const error = q(host, '.field-error');
    expect(error.textContent).toContain('This prescription needs more than this camera can supply.');
    expect(error.textContent).toContain(FPS_FIX_COPY);

    // A disabled button is inert: the click never reaches the handler.
    click(host, '#start');
    expect(rec.start).toBe(0);
  });

  it('refuses a card above the instrument ceiling as an INSTRUMENT limit, not a clinical rule', () => {
    const fastCard = testCard({ bandLo: 3.2, bandHi: 3.5 });
    const { host } = mount(
      { permission: 'granted', measuredFps: 240 },
      { card: fastCard },
    );
    const error = q(host, '.field-error');
    expect(error.textContent).toContain("This prescription's upper band edge is 3.5 Hz");
    expect(error.textContent).toContain(`validated to measure up to ${INSTRUMENT_LIMITS.maxCycleHz} Hz`);
    expect(error.textContent).toContain('this is an\n                 instrument limit, not a clinical rule');
    // Even a 240 fps camera cannot rescue it.
    expect(q<HTMLButtonElement>(host, '#start').disabled).toBe(true);
    // The band message replaces the light-and-lamp message; only one is shown.
    expect(host.querySelectorAll('.field-error')).toHaveLength(1);
    expect(host.textContent).not.toContain(FPS_FIX_COPY);
  });

  it('says "Measuring…" and shows no verdict at all while the check is still running', async () => {
    const { host, vh } = mount({ permission: 'granted' });
    expect(readout(host).textContent).toBe('Measuring…');
    expect(host.querySelector('.field-error')).toBeNull();
    expect(q<HTMLButtonElement>(host, '#start').disabled).toBe(true);
    // Drain the measurement this render started.
    vh.frames(6, PASSING_FPS);
    await vi.advanceTimersByTimeAsync(SETUP_CHECK_MS);
  });
});

// ===========================================================================
// Controls
// ===========================================================================

describe('the target-size and volume controls write straight through', () => {
  it('resizes the preview live without a re-render', () => {
    const { host, state, rec } = mount({ permission: 'granted', measuredFps: PASSING_FPS });
    setRange(host, '#opto-size', '2.5');
    expect(state.optoVmin).toBe(2.5);
    expect(q<HTMLElement>(host, '#opto-preview').style.getPropertyValue('--opto-d')).toBe('2.5vmin');
    // No re-render: the optotype must not flicker while it is being sized.
    expect(rec.rerender).toBe(0);
  });

  it('records the volume and plays the pacing sound at exactly that volume', () => {
    const { host, state, rec } = mount({ permission: 'granted', measuredFps: PASSING_FPS });
    setRange(host, '#volume', '0.85');
    expect(state.volume).toBe(0.85);
    expect(rec.rerender).toBe(0);

    click(host, '#audio-test');
    expect(rec.audioTest).toEqual([0.85]);
    expect(rec.rerender).toBe(0);
  });
});

// ===========================================================================
// Asking for the camera
// ===========================================================================

describe('allow-camera — the granted path', () => {
  it('asks for user-facing video, mounts the stream and announces the measurement', async () => {
    const { host, state, rec, vh } = mount({ permission: 'not-asked' });
    click(host, '#allow-camera');
    await vi.advanceTimersByTimeAsync(0);

    expect(gumCalls).toHaveLength(1);
    expect(gumCalls[0]).toEqual({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 },
        facingMode: 'user',
      },
      audio: false,
    });
    expect(state.permission).toBe('granted');
    expect(vh.video.srcObject).not.toBeNull();
    expect(vh.video.hidden).toBe(false);
    expect(vh.playCount).toBe(1);
    expect(rec.announce).toEqual(['Camera on. Measuring light and frame rate.']);
    expect(rec.rerender).toBe(1);
  });

  it('survives a browser that refuses to autoplay — the screen still comes up', async () => {
    const { host, state, rec } = mount(
      { permission: 'not-asked' },
      { play: () => Promise.reject(domError('NotAllowedError')) },
    );
    click(host, '#allow-camera');
    await vi.advanceTimersByTimeAsync(0);

    expect(state.permission).toBe('granted');
    expect(rec.announce).toEqual(['Camera on. Measuring light and frame rate.']);
    expect(rec.rerender).toBe(1);
  });

  it('pins the chosen device when the picker offers one', async () => {
    const { host, state } = mount({
      permission: 'no-camera',
      devices: videoInputs({ deviceId: 'usb-cam', label: 'External USB' }),
    });
    expect(q<HTMLSelectElement>(host, '#device-picker').value).toBe('usb-cam');
    click(host, '#allow-camera');
    await vi.advanceTimersByTimeAsync(0);

    const video = (gumCalls[0] as { video: Record<string, unknown> }).video;
    expect(video.deviceId).toEqual({ exact: 'usb-cam' });
    expect(state.permission).toBe('granted');
  });

  it('asks for any camera when the picker has nothing to pin', async () => {
    const { host } = mount({
      permission: 'no-camera',
      devices: videoInputs({ deviceId: '', label: 'Unidentified' }),
    });
    expect(q<HTMLSelectElement>(host, '#device-picker').value).toBe('');
    click(host, '#allow-camera');
    await vi.advanceTimersByTimeAsync(0);

    const video = (gumCalls[0] as { video: Record<string, unknown> }).video;
    expect(video).not.toHaveProperty('deviceId');
    expect(video.facingMode).toBe('user');
  });
});

describe('allow-camera — each refusal lands on its own designed state', () => {
  const cases = [
    { error: 'NotAllowedError', permission: 'denied', heading: 'Camera access is blocked' },
    { error: 'SecurityError', permission: 'denied', heading: 'Camera access is blocked' },
    { error: 'NotFoundError', permission: 'no-camera', heading: 'No camera found' },
    { error: 'NotReadableError', permission: 'in-use', heading: 'The camera is in use by another app' },
    { error: 'AbortError', permission: 'in-use', heading: 'The camera is in use by another app' },
    { error: 'WeirdUnmappedError', permission: 'unsupported', heading: 'This browser cannot run the measurement' },
  ] as const;

  for (const c of cases) {
    it(`maps ${c.error} to the ${c.permission} screen with its own recovery`, async () => {
      stubBrowser({ getUserMedia: rejectingWith(c.error) });
      const m = mount({ permission: 'not-asked' }, { live: true });
      click(m.host, '#allow-camera');
      await vi.advanceTimersByTimeAsync(0);

      expect(m.state.permission).toBe(c.permission);
      expect(m.host.querySelector('.check-card h2')?.textContent).toBe(c.heading);
      expect(m.rec.announce).toEqual([
        'Camera unavailable. There is still a route to an example report.',
      ]);
      // Never a browser error dialog, and never a dead end.
      expect(m.host.querySelector('#example-report')).not.toBeNull();
      expect(m.host.querySelector('.setup-grid')).toBeNull();
    });
  }

  it('gives the three failure states three DIFFERENT named fixes', async () => {
    const fixes: string[] = [];
    for (const error of ['NotAllowedError', 'NotFoundError', 'NotReadableError']) {
      stubBrowser({ getUserMedia: rejectingWith(error) });
      const m = mount({ permission: 'not-asked' }, { live: true });
      click(m.host, '#allow-camera');
      await vi.advanceTimersByTimeAsync(0);
      fixes.push(m.host.querySelector('.check-card')?.textContent ?? '');
    }
    expect(new Set(fixes).size).toBe(3);
    expect(fixes[0]).toContain('address bar');
    expect(fixes[1]).toContain('Connect a webcam');
    expect(fixes[2]).toContain('Close Zoom, Meet');
  });

  it('enumerates cameras only on no-camera, and offers them as a picker', async () => {
    let enumerated = 0;
    stubBrowser({
      getUserMedia: rejectingWith('NotFoundError'),
      enumerateDevices: async () => {
        enumerated += 1;
        return videoInputs({ deviceId: 'a', label: 'Front' }, { deviceId: 'b', label: 'Back' });
      },
    });
    const m = mount({ permission: 'not-asked' }, { live: true });
    click(m.host, '#allow-camera');
    await vi.advanceTimersByTimeAsync(0);

    expect(enumerated).toBe(1);
    expect(m.state.devices.map((d) => d.deviceId)).toEqual(['a', 'b']);
    expect(Array.from(q<HTMLSelectElement>(m.host, '#device-picker').options)).toHaveLength(2);
  });

  it('does not enumerate cameras on denial — that would be a second prompt for nothing', async () => {
    let enumerated = 0;
    stubBrowser({
      getUserMedia: rejectingWith('NotAllowedError'),
      enumerateDevices: async () => {
        enumerated += 1;
        return [];
      },
    });
    const m = mount({ permission: 'not-asked' }, { live: true });
    click(m.host, '#allow-camera');
    await vi.advanceTimersByTimeAsync(0);

    expect(enumerated).toBe(0);
    expect(m.state.devices).toEqual([]);
  });

  it('refuses to prompt at all on a browser that cannot run the instrument', async () => {
    let prompted = 0;
    stubBrowser({
      getUserMedia: async () => {
        prompted += 1;
        return makeStream();
      },
    });
    vi.stubGlobal('AudioContext', undefined);

    const m = mount({ permission: 'not-asked' }, { live: true });
    click(m.host, '#allow-camera');
    await vi.advanceTimersByTimeAsync(0);

    expect(prompted).toBe(0);
    expect(m.state.permission).toBe('unsupported');
    expect(m.host.querySelector('.check-card h2')?.textContent).toBe(
      'This browser cannot run the measurement',
    );
  });
});

// ===========================================================================
// The ten-second light-and-frame-rate check
// ===========================================================================

describe('measureFps — the ten-second check', () => {
  it('measures for exactly ten seconds and publishes the EFFECTIVE rate', async () => {
    const m = mount({ permission: 'granted' }, { live: true });
    // The clock is armed synchronously; frames arrive from the camera clock.
    m.vh.frames(31, PASSING_FPS);

    await vi.advanceTimersByTimeAsync(SETUP_CHECK_MS - 1);
    expect(Number.isNaN(m.state.measuredFps)).toBe(true);
    expect(m.rec.announce).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(m.state.measuredFps).toBeCloseTo(PASSING_FPS, 6);
    expect(m.rec.announce).toEqual(['Frame rate check passed at 30.0 frames per second.']);
    expect(readout(m.host).textContent).toBe('30.0 fps measured');
    expect(q<HTMLButtonElement>(m.host, '#start').disabled).toBe(false);
    // The clock is stopped, not left running against the camera.
    expect(m.vh.cancelled.length).toBe(1);
  });

  it('names the light fix when the measured rate is below the card floor', async () => {
    const m = mount({ permission: 'granted' }, { live: true });
    m.vh.frames(21, FAILING_FPS);
    await vi.advanceTimersByTimeAsync(SETUP_CHECK_MS);

    expect(m.state.measuredFps).toBeCloseTo(FAILING_FPS, 6);
    expect(m.rec.announce).toEqual([
      `Frame rate is 20.0 frames per second, below what this prescription needs. ${FPS_FIX_COPY}`,
    ]);
    expect(q<HTMLButtonElement>(m.host, '#start').disabled).toBe(true);
    expect(q(m.host, '.field-error').textContent).toContain(FPS_FIX_COPY);
  });

  it('says "unknown" rather than inventing a number when no frame ever arrived', async () => {
    const m = mount({ permission: 'granted' }, { live: true });
    // A camera that produced no frames at all: one timestamp is not an interval.
    m.vh.frames(1, PASSING_FPS);
    await vi.advanceTimersByTimeAsync(SETUP_CHECK_MS);

    expect(Number.isNaN(m.state.measuredFps)).toBe(true);
    expect(m.rec.announce).toEqual([
      `Frame rate is unknown frames per second, below what this prescription needs. ${FPS_FIX_COPY}`,
    ]);
    // Unknown is a failure, never a pass: Start stays shut.
    expect(q<HTMLButtonElement>(m.host, '#start').disabled).toBe(true);
  });

  it('refuses a card above the instrument ceiling even at a measured 240 fps', async () => {
    const m = mount({ permission: 'granted' }, { card: testCard({ bandLo: 3.2, bandHi: 3.5 }), live: true });
    m.vh.frames(61, 240);
    await vi.advanceTimersByTimeAsync(SETUP_CHECK_MS);

    expect(m.state.measuredFps).toBeCloseTo(240, 4);
    expect(m.rec.announce[0]).toContain('below what this prescription needs');
    expect(q<HTMLButtonElement>(m.host, '#start').disabled).toBe(true);
  });

  it('runs once per render and does not re-measure a rate it already has', async () => {
    const m = mount({ permission: 'granted' }, { live: true });
    m.vh.frames(31, PASSING_FPS);
    await vi.advanceTimersByTimeAsync(SETUP_CHECK_MS);
    expect(m.rec.announce).toHaveLength(1);

    // The re-render triggered by the measurement must NOT start a second one.
    await vi.advanceTimersByTimeAsync(SETUP_CHECK_MS * 3);
    expect(m.rec.announce).toHaveLength(1);
    expect(m.vh.cancelled.length).toBe(1);
  });

  it('"Measure again" clears the verdict, re-measures, and can change the answer', async () => {
    const m = mount({ permission: 'granted', measuredFps: FAILING_FPS });
    expect(q<HTMLButtonElement>(m.host, '#start').disabled).toBe(true);

    click(m.host, '#recheck');
    // Cleared before the repaint: no stale number survives into the recheck.
    expect(Number.isNaN(m.state.measuredFps)).toBe(true);
    expect(m.rec.rerender).toBe(1);
    expect(m.rec.announce).toEqual([]);

    m.vh.frames(31, PASSING_FPS);
    await vi.advanceTimersByTimeAsync(SETUP_CHECK_MS);

    expect(m.state.measuredFps).toBeCloseTo(PASSING_FPS, 6);
    expect(m.rec.announce).toEqual(['Frame rate check passed at 30.0 frames per second.']);
    expect(m.rec.rerender).toBe(2);

    m.render();
    expect(readout(m.host).textContent).toBe('30.0 fps measured');
    expect(q<HTMLButtonElement>(m.host, '#start').disabled).toBe(false);
  });

  /*
   * ONE MEASUREMENT, however many times the screen re-renders.
   *
   * `measuredFps` is NaN for the whole 10 s window, so `fpsKnown` is false for
   * the whole window, so every re-render used to reach `if (!fpsKnown) void
   * measureFps(props)` and start ANOTHER one. Two ways in, both real:
   *
   *   1. `#recheck` re-rendered (which re-enters and starts a measurement) and
   *      then called `measureFps` itself — two, every single click.
   *   2. Any control that re-renders mid-window — Hide my video, the volume
   *      slider, the theme picker — added one more.
   *
   * The damage is not a wasted timer. Two `FrameClock`s compete on one video,
   * the verdict is announced to the live region TWICE, and whichever resolves
   * last wins `state.measuredFps`. These two tests are the reason the
   * `measuring` flag exists.
   */
  it('starts exactly one measurement per "Measure again", even when rerender re-enters', async () => {
    const m = mount({ permission: 'granted', measuredFps: FAILING_FPS }, { live: true });

    click(m.host, '#recheck');
    m.vh.frames(31, PASSING_FPS);
    await vi.advanceTimersByTimeAsync(SETUP_CHECK_MS);

    // One clock stopped, one verdict spoken. This was 2 and 2.
    expect(m.vh.cancelled.length).toBe(1);
    expect(m.rec.announce).toEqual(['Frame rate check passed at 30.0 frames per second.']);
    expect(m.state.measuredFps).toBeCloseTo(PASSING_FPS, 6);
    expect(m.state.measuring).toBe(false);
  });

  it('does not start a second measurement when the screen re-renders mid-check', async () => {
    const m = mount({ permission: 'granted' }, { live: true });
    m.vh.frames(16, PASSING_FPS);

    // Half way through the window the reader hides their video — a re-render.
    await vi.advanceTimersByTimeAsync(SETUP_CHECK_MS / 2);
    expect(m.state.measuring).toBe(true);
    click(m.host, '#toggle-video');

    m.vh.frames(16, PASSING_FPS);
    await vi.advanceTimersByTimeAsync(SETUP_CHECK_MS);

    expect(m.vh.cancelled.length).toBe(1);
    expect(m.rec.announce).toHaveLength(1);
    expect(m.state.measuring).toBe(false);
  });

  it('takes the median, so one stall does not fail an otherwise good camera', async () => {
    const m = mount({ permission: 'granted' }, { live: true });
    // Twenty intervals at 30 fps, then a single 900 ms stall.
    m.vh.frames(21, PASSING_FPS);
    m.vh.stall(0.9);
    await vi.advanceTimersByTimeAsync(SETUP_CHECK_MS);

    expect(m.state.measuredFps).toBeCloseTo(PASSING_FPS, 3);
    expect(q<HTMLButtonElement>(m.host, '#start').disabled).toBe(false);
  });
});

// ===========================================================================
// Screen-wide invariants
// ===========================================================================

describe('setup screen invariants', () => {
  const permissions = ['not-asked', 'denied', 'no-camera', 'in-use', 'unsupported', 'granted'] as const;

  it('never removes a focus stop from an interactive control, on any state', () => {
    for (const permission of permissions) {
      const { host } = mount({
        permission,
        measuredFps: PASSING_FPS,
        devices: videoInputs({ deviceId: 'a', label: 'Front' }),
      });
      const controls = Array.from(host.querySelectorAll<HTMLElement>('button, input, select, a'));
      expect(controls.length).toBeGreaterThan(0);
      for (const c of controls) {
        expect(c.getAttribute('tabindex')).toBeNull();
        expect(c.style.outline).toBe('');
        expect(c.outerHTML).not.toContain('outline');
      }
      // The only tabindex on the screen is the programmatic heading target.
      const indexed = Array.from(host.querySelectorAll('[tabindex]')).map((e) => e.id);
      expect(indexed).toEqual(['screen-title']);
    }
  });

  it('opens no modal, raises no toast and shows no tooltip, in any state', () => {
    for (const permission of permissions) {
      const { host } = mount({ permission, measuredFps: PASSING_FPS, audioOff: true });
      expect(host.querySelector('dialog')).toBeNull();
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      expect(host.querySelector('[role="alertdialog"]')).toBeNull();
      expect(host.querySelector('[role="tooltip"]')).toBeNull();
      expect(host.querySelector('[title]')).toBeNull();
      expect(host.innerHTML).not.toMatch(/class="[^"]*\b(modal|toast|tooltip|popover)\b/);
    }
  });

  it('sets no timer at all outside the therapy check itself', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const asking = mount({ permission: 'not-asked' });
    click(asking.host, '#example-report');
    expect(asking.rec.example).toBe(1);
    expect(spy).not.toHaveBeenCalled();

    const granted = mount({ permission: 'granted', measuredFps: PASSING_FPS });
    click(granted.host, '#toggle-video');
    click(granted.host, '#audio-off');
    click(granted.host, '#audio-test');
    click(granted.host, '#start');
    setRange(granted.host, '#opto-size', '3');
    setRange(granted.host, '#volume', '0.2');
    expect(granted.rec.start).toBe(1);
    expect(spy).not.toHaveBeenCalled();

    // The 10 s check is the ONLY timer this screen ever sets.
    const measuring = mount({ permission: 'granted' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toBe(SETUP_CHECK_MS);
    expect(SETUP_CHECK_MS).toBe(10_000);
    measuring.vh.frames(6, PASSING_FPS);
    await vi.advanceTimersByTimeAsync(SETUP_CHECK_MS);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('re-rendering replaces the screen rather than accumulating duplicate controls', () => {
    const m = mount({ permission: 'granted', measuredFps: PASSING_FPS });
    m.render();
    m.render();
    expect(m.host.querySelectorAll('#start')).toHaveLength(1);
    expect(m.host.querySelectorAll('#toggle-video')).toHaveLength(1);
    expect(m.host.querySelectorAll('.check-card')).toHaveLength(4);
    // And the single video element moves with the slot rather than being cloned.
    expect(document.querySelectorAll('video')).toHaveLength(1);
    expect(setupPreviewSlot(m.host)?.firstElementChild).toBe(m.vh.video);
  });
});

// ===========================================================================
// The two DOM accessors
// ===========================================================================

describe('setupPreviewSlot / fpsReadout', () => {
  it('find the framing slot and the frame-rate verdict on the granted screen', () => {
    const { host } = mount({ permission: 'granted', measuredFps: PASSING_FPS });
    expect(setupPreviewSlot(host)?.id).toBe('framing-slot');
    expect(readout(host).id).toBe('fps-readout');
    expect(readout(host).classList.contains('check-verdict')).toBe(true);
  });

  it('setupPreviewSlot returns null off the granted screen rather than throwing', () => {
    const { host } = mount({ permission: 'denied' });
    expect(setupPreviewSlot(host)).toBeNull();
  });

  it('fpsReadout throws off the granted screen — a missing verdict is a bug, not a blank', () => {
    const { host } = mount({ permission: 'denied' });
    expect(() => fpsReadout(host)).toThrow('missing element: #fps-readout');
  });
});
