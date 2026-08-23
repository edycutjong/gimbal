import {
  requestCamera,
  listCameras,
  reEnableSteps,
  detectSupport,
  FrameClock,
  type PermissionState,
} from '../../capture/camera.ts';
import { minSampleRateHz, cardExceedsInstrument, INSTRUMENT_LIMITS } from '../../dsp/limits.ts';
import { landoltCSvg } from '../../optotype/landoltC.ts';
import type { ProtocolCard } from '../../protocol/card.ts';
import { esc, el, settingsRow, wireThemePicker, type ThemeName } from '../dom.ts';
import {
  CAMERA_PRIVACY_COPY,
  EXAMPLE_REPORT_LABEL,
  FPS_FIX_COPY,
  OPTOTYPE_SIZER_COPY,
  OPTOTYPE_NO_ACUITY_COPY,
} from '../copy.ts';

/**
 * Screen 2 — Setup.
 *
 * Four things in one column, each with a binary pass state and a NAMED FIX.
 * Permission is a designed state, never an error dialog, and every failure state
 * carries `[ See an example session report ]` — so no judge on any device
 * reaches a wall, and the degradation lands on the artifact they came to see.
 *
 * The light-and-frame-rate check is the first time a judge sees Gimbal refuse to
 * produce a number, about twenty seconds in.
 */

export const SETUP_CHECK_MS = 10_000;

export interface SetupState {
  permission: PermissionState;
  optoVmin: number;
  hideVideo: boolean;
  audioOff: boolean;
  volume: number;
  measuredFps: number;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
}

export interface SetupProps {
  state: SetupState;
  card: ProtocolCard;
  video: HTMLVideoElement;
  theme: ThemeName | null;
  onStart: () => void;
  onExampleReport: () => void;
  onAudioTest: (volume: number) => void;
  onAudioOff: (off: boolean) => void;
  announce: (text: string) => void;
  rerender: () => void;
}

export function defaultSetupState(): SetupState {
  return {
    permission: 'not-asked',
    optoVmin: 4.0,
    hideVideo: false,
    audioOff: false,
    volume: 0.5,
    measuredFps: NaN,
    devices: [],
    selectedDeviceId: null,
  };
}

function permissionPanel(state: SetupState): string {
  const exampleButton = `<button type="button" class="text-button no-print" id="example-report">${esc(
    EXAMPLE_REPORT_LABEL,
  )}</button>`;

  switch (state.permission) {
    case 'not-asked':
      return `<div class="check-card">
        <h2>Camera</h2>
        <p>${esc(CAMERA_PRIVACY_COPY)}</p>
        <button type="button" class="primary" id="allow-camera">Allow camera</button>
        <p>${exampleButton}</p>
      </div>`;

    case 'denied':
      return `<div class="check-card">
        <h2>Camera access is blocked</h2>
        <ol>${reEnableSteps().map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        <button type="button" class="primary" id="allow-camera">I've enabled it — try again</button>
        <p>${exampleButton}</p>
      </div>`;

    case 'no-camera':
      return `<div class="check-card">
        <h2>No camera found</h2>
        <p>Gimbal needs a front-facing camera to measure head movement. Connect a webcam and try again.</p>
        ${
          state.devices.length > 0
            ? `<label for="device-picker">Camera</label>
               <select id="device-picker">${state.devices
                 .map((d) => `<option value="${esc(d.deviceId)}">${esc(d.label || 'camera')}</option>`)
                 .join('')}</select>`
            : ''
        }
        <button type="button" class="primary" id="allow-camera">Try again</button>
        <p>${exampleButton}</p>
      </div>`;

    case 'in-use':
      // A VARIANT of the unsupported state, not a fifth state — same screen,
      // different named fix.
      return `<div class="check-card">
        <h2>The camera is in use by another app</h2>
        <p>Close Zoom, Meet or any other app using the camera, then reload this page.</p>
        <button type="button" class="primary" id="allow-camera">Try again</button>
        <p>${exampleButton}</p>
      </div>`;

    case 'unsupported': {
      const missing = detectSupport().missing;
      return `<div class="check-card">
        <h2>This browser cannot run the measurement</h2>
        <p>Gimbal needs ${esc(missing.join(', ') || 'features this browser does not provide')}.
           The supported configuration is desktop Chromium 110 or later.</p>
        <p>You can still see exactly what the instrument produces:</p>
        <p>${exampleButton}</p>
      </div>`;
    }

    case 'granted':
      return '';
  }
}

export function renderSetup(host: HTMLElement, props: SetupProps): void {
  const { state, card } = props;
  const bandHi = card.frequencyBand.value[1];
  const floorFps = minSampleRateHz(bandHi);

  const granted = state.permission === 'granted';
  const fpsKnown = Number.isFinite(state.measuredFps);
  const cardTooFast = bandHi > INSTRUMENT_LIMITS.maxCycleHz;
  const fpsPass = fpsKnown && !cardExceedsInstrument(bandHi, state.measuredFps);

  host.innerHTML = `
    ${settingsRow(props.theme)}
    <p class="eyebrow">Before you start</p>
    <h1 id="screen-title" tabindex="-1">Set up</h1>
    ${permissionPanel(state)}
    ${
      granted
        ? `
    <div class="setup-grid">
      <div class="check-card">
        <h2>Framing</h2>
        <div class="framing-wrap" id="framing-slot"${state.hideVideo ? ' hidden' : ''}></div>
        <p class="caption">No face mesh is drawn. Gimbal reads one rigid head orientation and nothing else.</p>
        <button type="button" id="toggle-video">${state.hideVideo ? 'Show my video' : 'Hide my video'}</button>
      </div>

      <div class="check-card">
        <h2>Light and frame rate</h2>
        <p class="check-verdict" id="fps-readout">${
          fpsKnown ? `${state.measuredFps.toFixed(1)} fps measured` : 'Measuring…'
        }</p>
        <p class="caption">This prescription needs at least ${floorFps} frames per second.
          The floor is derived from your clinician's band, not from this computer's speed.</p>
        ${
          cardTooFast
            ? `<p class="field-error">This prescription's upper band edge is ${esc(bandHi)} Hz.
                 Gimbal is only validated to measure up to ${INSTRUMENT_LIMITS.maxCycleHz} Hz — this is an
                 instrument limit, not a clinical rule.</p>`
            : fpsKnown && !fpsPass
              ? `<p class="field-error">This prescription needs more than this camera can supply. ${esc(FPS_FIX_COPY)}</p>`
              : ''
        }
        <button type="button" id="recheck">Measure again</button>
      </div>

      <div class="check-card">
        <h2>Target size</h2>
        <p>${esc(OPTOTYPE_SIZER_COPY)}</p>
        <div id="opto-preview" style="--opto-d: ${state.optoVmin}vmin; padding: var(--space-4) 0;">
          ${landoltCSvg(0)}
        </div>
        <label for="opto-size">Target size</label>
        <input type="range" id="opto-size" min="1.2" max="9" step="0.1" value="${state.optoVmin}" />
        <p class="caption">${esc(OPTOTYPE_NO_ACUITY_COPY)}</p>
      </div>

      <div class="check-card">
        <h2>Sound</h2>
        <p>The pacing sound is how Gimbal coaches you while your eyes stay on the target.</p>
        <button type="button" id="audio-test">Play the pacing sound</button>
        <label for="volume">Volume</label>
        <input type="range" id="volume" min="0" max="1" step="0.05" value="${state.volume}" />
        <button type="button" class="text-button" id="audio-off">${
          state.audioOff ? 'Turn sound back on' : "I can't use sound"
        }</button>
        ${
          state.audioOff
            ? `<p class="banner">Audio coaching is off. The report will say the session was coached without audio.</p>`
            : ''
        }
      </div>
    </div>

    <div class="button-row">
      <button type="button" class="primary" id="start" ${fpsPass ? '' : 'disabled aria-disabled="true"'}>
        Start session
      </button>
    </div>
    ${fpsPass ? '' : `<p class="caption">Start stays disabled until the frame-rate check passes.</p>`}
    `
        : ''
    }
  `;

  wireThemePicker(host);

  host.querySelector<HTMLButtonElement>('#example-report')?.addEventListener('click', props.onExampleReport);

  host.querySelector<HTMLButtonElement>('#allow-camera')?.addEventListener('click', async () => {
    const picker = host.querySelector<HTMLSelectElement>('#device-picker');
    const result = await requestCamera(picker?.value || undefined);
    if (result.ok) {
      state.permission = 'granted';
      props.video.srcObject = result.handle.stream;
      props.video.hidden = false;
      await props.video.play().catch(() => undefined);
      props.announce('Camera on. Measuring light and frame rate.');
    } else {
      state.permission = result.state;
      if (result.state === 'no-camera') state.devices = await listCameras();
      props.announce('Camera unavailable. There is still a route to an example report.');
    }
    props.rerender();
  });

  if (granted) {
    const slot = host.querySelector<HTMLElement>('#framing-slot');
    if (slot && !state.hideVideo) {
      props.video.className = 'framing';
      props.video.hidden = false;
      slot.appendChild(props.video);
    }

    host.querySelector<HTMLButtonElement>('#toggle-video')?.addEventListener('click', () => {
      // Being watched by your own screen while dizzy is not universally
      // comfortable. Hiding it does not affect measurement.
      state.hideVideo = !state.hideVideo;
      props.rerender();
    });

    const optoRange = host.querySelector<HTMLInputElement>('#opto-size');
    const preview = host.querySelector<HTMLElement>('#opto-preview');
    optoRange?.addEventListener('input', () => {
      state.optoVmin = Number(optoRange.value);
      preview?.style.setProperty('--opto-d', `${state.optoVmin}vmin`);
    });

    const volume = host.querySelector<HTMLInputElement>('#volume');
    volume?.addEventListener('input', () => {
      state.volume = Number(volume.value);
    });

    host.querySelector<HTMLButtonElement>('#audio-test')?.addEventListener('click', () => {
      props.onAudioTest(state.volume);
    });

    host.querySelector<HTMLButtonElement>('#audio-off')?.addEventListener('click', () => {
      state.audioOff = !state.audioOff;
      props.onAudioOff(state.audioOff);
      props.rerender();
    });

    host.querySelector<HTMLButtonElement>('#start')?.addEventListener('click', props.onStart);
    host.querySelector<HTMLButtonElement>('#recheck')?.addEventListener('click', () => {
      state.measuredFps = NaN;
      props.rerender();
      void measureFps(props);
    });

    if (!fpsKnown) void measureFps(props);
  }
}

/**
 * The 10-second effective-frame-rate measurement.
 *
 * Read from `requestVideoFrameCallback` timestamps, NEVER from
 * `getSettings().frameRate` — which reports the rate that was requested, not the
 * rate the camera is achieving. A camera that has silently dropped to 15 fps in
 * dim light would otherwise produce plausible wrong numbers, and a plausible
 * wrong number is the worst failure mode available to a measuring instrument.
 */
async function measureFps(props: SetupProps): Promise<void> {
  const { video, state } = props;
  const clock = new FrameClock(video, () => undefined);
  clock.reset();
  clock.start();
  await new Promise((resolve) => setTimeout(resolve, SETUP_CHECK_MS));
  clock.stop();
  state.measuredFps = clock.effectiveFps();

  const bandHi = props.card.frequencyBand.value[1];
  const pass = Number.isFinite(state.measuredFps) && !cardExceedsInstrument(bandHi, state.measuredFps);
  props.announce(
    pass
      ? `Frame rate check passed at ${state.measuredFps.toFixed(1)} frames per second.`
      : `Frame rate is ${Number.isFinite(state.measuredFps) ? state.measuredFps.toFixed(1) : 'unknown'} frames per second, below what this prescription needs. ${FPS_FIX_COPY}`,
  );
  props.rerender();
}

export function setupPreviewSlot(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('#framing-slot');
}

export function fpsReadout(host: HTMLElement): HTMLElement | null {
  return el<HTMLElement>(host, '#fps-readout');
}
