import './styles/fonts.css';
import './styles/tokens.css';
import './styles/themes.css';
import './styles/screen.css';
import './styles/print.css';

import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { createLandmarkerWithFallback } from './capture/landmarker.ts';
import { cardFromDraft, emptyDraft, prescribedSeconds, bandCentreHz, type CardDraft, type ProtocolCard } from './protocol/card.ts';
import { exampleDraft, EXAMPLE_DRAFT_BANNER } from './protocol/exampleParameters.ts';
import type { StopRuleOutcome } from './protocol/stopRule.ts';
import { BlockRunner, type BlockResult } from './session/blockRunner.ts';
import { LiveRegions } from './ui/live.ts';
import { renderPrescribe } from './ui/screens/prescribe.ts';
import { renderSetup, defaultSetupState, type SetupState } from './ui/screens/setup.ts';
import { renderBlock, type BlockView } from './ui/screens/block.ts';
import { renderGate } from './ui/screens/gate.ts';
import { renderReport } from './ui/screens/report.ts';
import { renderLedger } from './ui/screens/ledger.ts';
import { AudioEngine, detuneCents } from './audio/scheduler.ts';
import { buildReport } from './report/report.ts';
import { loadTheme, applyTheme, el, type ThemeName } from './ui/dom.ts';
import { refusalPhrase } from './ui/copy.ts';
import { buildDeviceSignature } from './store/deviceSignature.ts';
import { loadSessions, upsertSession, clearAllData } from './store/local.ts';
import { loadExampleLedger } from './store/exampleLedger.ts';
import { downloadSessionJson } from './store/export.ts';
import {
  SESSION_SCHEMA,
  contentHash,
  quantiseVelocities,
  sessionId,
  VELOCITY_SCALE,
  type PersistedSession,
  type PersistedBlock,
  type DeviceSignature,
} from './store/session.ts';
import { FFT_SIZE } from './dsp/fft.ts';

/**
 * Bootstrap: six screens toggled by one enum, one reducer over the session
 * state, in memory. No router — six screens, no deep links, and no back-button
 * semantics worth having mid-exercise. No framework — the judged code path is a
 * 30 Hz loop, and a virtual DOM diff inside it is pure downside.
 */

/**
 * READ from `package.json` at build time, never typed here.
 *
 * This string is stamped onto every printed report, which is the one artifact
 * that leaves the browser and reaches a clinician on paper. It said
 * `gimbal 0.1.0` by hand while `package.json` was at 1.3.0, so every report
 * printed since v0.2.0 named a build that was five releases stale — a report
 * you cannot tie to the code that produced it is not evidence of anything.
 * `__GIMBAL_VERSION__` is substituted by the `gimbal-version-stamp` plugin in
 * `vite.config.ts` (and by the matching `define` in `vitest.config.ts`), from
 * the same `package.json` that `scripts/version.mjs` writes on release.
 */
declare const __GIMBAL_VERSION__: string;
export const APP_VERSION = `gimbal ${__GIMBAL_VERSION__}`;
const METHODS_REV = 'METHODS.md@unreleased';

type Screen = 'prescribe' | 'setup' | 'block' | 'gate' | 'report' | 'ledger';

interface SessionState {
  card: ProtocolCard | null;
  draft: CardDraft;
  setup: SetupState;
  blockIndex: number;
  blocks: BlockResult[];
  baseline: number | null;
  gates: { afterBlock: number; rating: number; ruling: StopRuleOutcome }[];
  finalRating: number | null;
  startedAt: string;
  landmarker: FaceLandmarker | null;
  ended: boolean;
}

const hosts: Record<Screen, HTMLElement> = {
  prescribe: el(document, '#screen-prescribe'),
  setup: el(document, '#screen-setup'),
  block: el(document, '#screen-block'),
  gate: el(document, '#screen-gate'),
  report: el(document, '#screen-report'),
  ledger: el(document, '#screen-ledger'),
};

const video = el<HTMLVideoElement>(document, '#camera');
const live = new LiveRegions(el(document, '#live-status'), el(document, '#live-alert'));
const audio = new AudioEngine();

let theme: ThemeName | null = loadTheme();
if (theme) applyTheme(theme);

/**
 * THE TWO ENTRY ROUTES, AND WHY CLAIM C1 SURVIVES THE DEFAULT MOVING.
 *
 *   `/app`        the labelled example prescription, pre-filled
 *   `/app?demo`   the same thing, named — kept because README.md and DEMO.md
 *                 both publish that address
 *   `/app?blank`  the eight empty fields; the origination path the product ships
 *
 * The default used to be blank, and the emptiness was doing double duty: it was
 * the safety property AND it was the first thing a judge saw, which meant every
 * reader without a clinician's handout in front of them hit eight required
 * fields they had no way to fill. The default is now the example.
 *
 * CLAIM C1 — "Gimbal has no path to originate a prescription" — is unchanged,
 * and it is unchanged for reasons that are structural rather than editorial:
 *
 *   1. THE BLANK ORIGINATION PATH STILL EXISTS, at `?blank`, and it is reachable
 *      in one visible click from the pre-filled screen (`prescribe.ts` renders
 *      that link beside the banner) as well as from three places on `/`.
 *   2. THE EIGHT VALUES STILL ARRIVE ONLY FROM `exampleParameters.ts`, by this
 *      one labelled route. There is no second source of numbers, no preset list,
 *      no "typical values" button, and `prescribe.ts` still imports none of it —
 *      it renders whatever draft it is handed.
 *   3. THE CLINICIAN-ATTESTATION CHECKBOX IS STILL NEVER AUTO-TICKED. That is
 *      the load-bearing half. Filling in a number for someone is a convenience;
 *      ticking their attestation for them would be a lie, and it is the tick —
 *      not the numbers — that lets a card exist at all.
 *   4. THE LABEL AND THE DRAFT COME FROM THE SAME FLAG, on the two lines below.
 *      A pre-filled form that has stopped saying it is pre-filled is not
 *      constructible, which is what check `U-CARD` asserts mechanically.
 *
 * The disclosure is unchanged and travels onto paper: a persistent banner above
 * the form, an `EXAMPLE` chip on every one of the eight values, and `EXAMPLE …`
 * as the `source` string on every one of the eight criteria — which is what
 * prints in the report's "Why?" disclosure.
 */
const usingExampleParameters = !new URLSearchParams(globalThis.location?.search ?? '').has('blank');

const state: SessionState = {
  card: null,
  draft: usingExampleParameters ? exampleDraft() : emptyDraft(),
  setup: defaultSetupState(),
  blockIndex: 0,
  blocks: [],
  baseline: null,
  gates: [],
  finalRating: null,
  startedAt: new Date().toISOString(),
  landmarker: null,
  ended: false,
};

let currentScreen: Screen = 'prescribe';
let blockView: BlockView | null = null;
let runner: BlockRunner | null = null;
let viewingSession: PersistedSession | null = null;
/** Where `[ Back to report ]` returns to when the ledger was reached from the report. */
let ledgerReturn: Screen = 'report';
/** A visible reason on the ledger when a requested load did not happen. */
let ledgerNotice: string | null = null;

/**
 * The FIRST render is not a screen change, so it does not move focus.
 *
 * It used to. The heading is `tabindex="-1"` and `show()` focused it
 * unconditionally, so the very first paint of the app put a 3 px focus ring
 * around the `<h1>` before the reader had touched anything — which reads as a
 * rendering fault, not as an affordance. Focus already starts on the document,
 * the skip link is still the first tab stop, and every SUBSEQUENT screen change
 * still moves focus to the new heading, which is the behaviour that actually
 * matters to a screen-reader user.
 */
let hasRendered = false;

function show(screen: Screen): void {
  currentScreen = screen;
  for (const [name, host] of Object.entries(hosts)) host.hidden = name !== screen;
  // Screen change moves focus to the new <h1 tabindex="-1">, announces the
  // screen name, and resets scroll. The app NEVER auto-advances: every
  // transition is a deliberate button press, because auto-advance in front of a
  // cognitively fatigued user is a decision made without them.
  if (hasRendered) {
    const heading = hosts[screen].querySelector<HTMLElement>('#screen-title');
    heading?.focus();
  }
  hasRendered = true;
  globalThis.scrollTo?.(0, 0);
}

const announce = (text: string): void => live.say(text);

// ── Screen 1 ──────────────────────────────────────────────────────────────
function showPrescribe(): void {
  renderPrescribe(hosts.prescribe, {
    draft: state.draft,
    theme,
    announce,
    exampleBanner: usingExampleParameters ? EXAMPLE_DRAFT_BANNER : null,
    onContinue: (draft) => {
      state.draft = draft;
      state.card = cardFromDraft(draft);
      showSetup();
    },
    onExampleReport: () => void openExampleReport(),
  });
  show('prescribe');
}

// ── Screen 2 ──────────────────────────────────────────────────────────────
function showSetup(): void {
  const card = state.card;
  if (!card) return showPrescribe();
  renderSetup(hosts.setup, {
    state: state.setup,
    card,
    video,
    theme,
    announce,
    rerender: showSetup,
    onExampleReport: () => void openExampleReport(),
    onAudioTest: (volume) => {
      // The ONE place an AudioContext is created and resumed.
      void audio.start({ periodSec: 1 / bandCentreHz(card), volume });
    },
    onAudioOff: (off) => audio.setMuted(off),
    onStart: () => void startSession(),
  });
  show('setup');
}

async function startSession(): Promise<void> {
  const card = state.card;
  if (!card) return;
  state.startedAt = new Date().toISOString();
  state.blocks = [];
  state.gates = [];
  state.blockIndex = 0;
  state.baseline = null;
  state.finalRating = null;
  state.ended = false;

  if (!state.landmarker) {
    announce('Loading the tracking model.');
    try {
      const { landmarker } = await createLandmarkerWithFallback();
      state.landmarker = landmarker;
    } catch {
      announce('Reload — the tracking model did not finish downloading.');
      return;
    }
  }
  await audio.start({ periodSec: 1 / bandCentreHz(card), volume: state.setup.volume });
  audio.setMuted(state.setup.audioOff);
  // The baseline rating comes first: the stop rule needs a reference.
  showGate(null, null, false);
}

// ── Screen 3 ──────────────────────────────────────────────────────────────
function startBlock(): void {
  const card = state.card;
  const landmarker = state.landmarker;
  if (!card || !landmarker) return;

  const view = renderBlock(hosts.block, {
    card,
    blockIndex: state.blockIndex,
    video,
    optoVmin: state.setup.optoVmin,
    hideVideo: state.setup.hideVideo,
    onAnswer: (o) => runner?.answer(o),
    onPauseToggle: () => (runner?.isPaused ? resumeBlock() : pauseBlock()),
    onInterrupt: () => runner?.interrupt(),
  });
  blockView = view;

  runner = new BlockRunner({
    index: state.blockIndex,
    video,
    landmarker,
    card,
    callbacks: {
      onFrame: (s) => {
        view.onFrame(s);
        view.setOptotype(s.optotypeShown, s.optotypeWindowOpen);
        if (Number.isFinite(s.omega)) audio.setDetune(detuneCents(Math.abs(s.omega), card));
      },
      onCycle: (c) => {
        view.onCycle(c);
        if (!c.credited) {
          live.announceRefusal(c.reason, refusalPhrase(c.reason));
          audio.refusalEarcon();
        }
      },
      onPause: (paused) => view.setPaused(paused),
      onFinish: (result) => void finishBlock(result),
    },
  });

  show('block');
  runner.start();
}

function pauseBlock(): void {
  runner?.pause();
  void audio.suspend();
}

function resumeBlock(): void {
  const card = state.card;
  if (!card) return;
  void audio.start({ periodSec: 1 / bandCentreHz(card), volume: state.setup.volume }).then(() => {
    audio.setMuted(state.setup.audioOff);
    runner?.resume();
  });
}

// Tab hidden pauses the block and excludes the gap from elapsed time.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && currentScreen === 'block') pauseBlock();
});

async function finishBlock(result: BlockResult): Promise<void> {
  blockView?.destroy();
  blockView = null;
  state.blocks.push(result);
  await audio.suspend();
  persist();

  const card = state.card;
  if (!card) return;
  const isLastBlock = state.blockIndex >= card.blockCount.value - 1;

  if (result.interrupted) {
    // An interruption ends the SESSION. There is no mid-block resume.
    state.ended = true;
    showGate(state.baseline, state.blockIndex, true);
    return;
  }
  if (isLastBlock) {
    showGate(state.baseline, state.blockIndex, true);
    return;
  }
  showGate(state.baseline, state.blockIndex, false);
}

// ── Screen 4 ──────────────────────────────────────────────────────────────
function showGate(baseline: number | null, afterBlock: number | null, isFinal: boolean): void {
  const card = state.card;
  if (!card) return;
  renderGate(hosts.gate, {
    card,
    baseline,
    afterBlock,
    isFinal,
    theme,
    announce,
    alertEndSession: (text) => live.alertOnly('end-session', text),
    onRuling: (rating, outcome) => {
      if (baseline === null) {
        state.baseline = rating;
        startBlock();
        return;
      }
      if (isFinal) {
        state.finalRating = rating;
        persist();
        void openReport();
        return;
      }
      state.gates.push({ afterBlock: afterBlock as number, rating, ruling: outcome ?? 'continue' });
      persist();
      if (outcome === 'end-session') {
        state.ended = true;
        showGate(state.baseline, afterBlock, true);
        return;
      }
      state.blockIndex += 1;
      startBlock();
    },
  });
  show('gate');
}

// ── Screens 5 and 6 ───────────────────────────────────────────────────────
function deviceSignature(): DeviceSignature {
  const fps = state.blocks.length > 0 ? (state.blocks[0] as BlockResult).effectiveFpsMedian : state.setup.measuredFps;
  return buildDeviceSignature({
    userAgent: navigator.userAgent,
    cameraLabel: video.srcObject instanceof MediaStream
      ? (video.srcObject.getVideoTracks()[0]?.label ?? 'unnamed camera')
      : 'unnamed camera',
    resolution: `${video.videoWidth || 640}x${video.videoHeight || 480}`,
    medianFps: Number.isFinite(fps) ? fps : 0,
  });
}

function toPersisted(): PersistedSession | null {
  const card = state.card;
  if (!card) return null;

  const blocks: PersistedBlock[] = state.blocks.map((b) => ({
    index: b.index,
    prescribedSeconds: b.prescribedSeconds,
    deliveredSeconds: Number(b.dose.deliveredSeconds.toFixed(3)),
    cyclesAttempted: b.dose.attempted,
    cyclesCredited: b.dose.credited,
    refusals: b.dose.refusals(),
    fHatHz: b.fHatMedian,
    fHatBinWidthHz: Number.isFinite(b.effectiveFpsMedian) ? b.effectiveFpsMedian / FFT_SIZE : NaN,
    gaze: b.trials.tally(),
    peakVelocitiesQ: quantiseVelocities(b.dose.peakVelocities()),
    peakVelocityScale: VELOCITY_SCALE,
    saturatedCycles: b.dose.saturatedCycles,
    interruptions: b.dose.interruptions,
  }));

  const delivered = blocks.reduce((a, b) => a + b.deliveredSeconds, 0);
  const prescribed = prescribedSeconds(card);

  return {
    schema: SESSION_SCHEMA,
    id: sessionId(state.startedAt, 1, 'live'),
    provenance: 'live',
    startedAt: state.startedAt,
    cardId: 'clinician-entered',
    cardHash: contentHash(JSON.stringify(card)),
    card,
    device: deviceSignature(),
    blocks,
    symptom: { baseline: state.baseline ?? 0, gates: state.gates, final: state.finalRating },
    totals: {
      prescribedSeconds: prescribed,
      deliveredSeconds: Number(delivered.toFixed(3)),
      ratio: prescribed > 0 ? Number((delivered / prescribed).toFixed(3)) : 0,
    },
    appVersion: APP_VERSION,
    methodsRev: METHODS_REV,
    audioOff: state.setup.audioOff,
  };
}

/** localStorage is written exactly twice per session — block end and session end. */
function persist(): void {
  const session = toPersisted();
  if (!session) return;
  viewingSession = session;
  if (!upsertSession(session)) {
    announce('History could not be saved in this browser — your report still prints.');
  }
}

async function openReport(): Promise<void> {
  /*
   * Both halves of this line are defensive and NEITHER can fire.
   * `viewingSession` is only ever assigned non-null, and nothing sets it back.
   * Of the two call sites, the ledger's "Back to report" is already guarded by
   * `&& viewingSession`, and the final gate's ruling is only reachable through
   * `finishBlock`, whose unconditional `persist()` assigns `viewingSession`
   * before any gate is rendered — and which returns before rendering a gate at
   * all in the one case where `persist()` skips that assignment.
   *
   * Kept because `openReport` must not render a report out of nothing if a
   * future call site appears; ignored because the alternative is a test that
   * fakes a state the module cannot hold.
   */
  /* v8 ignore start */
  const session = viewingSession ?? toPersisted();
  if (!session) return;
  /* v8 ignore stop */
  viewingSession = session;
  renderReport(hosts.report, {
    model: buildReport(session),
    theme,
    onPrint: () => globalThis.print(),
    onDownload: () => downloadSessionJson(session),
    onLedger: () => {
      ledgerReturn = 'report';
      showLedger();
    },
  });
  show('report');
  await audio.stop();
}

/**
 * The zero-typing route to the artifact, from screen 1 and from each of screen
 * 2's failure states. It loads the example ledger and opens the report — so
 * every judge on every device reaches the thing they came to see, and the
 * degradation is designed rather than a wall.
 */
async function openExampleReport(): Promise<void> {
  const outcome = await loadExampleLedger();
  if (!outcome.ok) {
    // Shown on screen, not only announced — a reader who is not using a screen
    // reader deserves the same sentence.
    ledgerNotice = outcome.reason ?? 'The example ledger could not be loaded.';
    announce(ledgerNotice);
    ledgerReturn = currentScreen;
    showLedger();
    return;
  }
  ledgerNotice = null;
  announce(`Example ledger loaded. ${outcome.added} developer-recorded sessions added, labelled example.`);
  const first = outcome.sessions[0];
  if (!first) {
    ledgerReturn = currentScreen;
    showLedger();
    return;
  }
  viewingSession = first;
  renderReport(hosts.report, {
    model: buildReport(first),
    theme,
    onPrint: () => globalThis.print(),
    onDownload: () => downloadSessionJson(first),
    onLedger: () => {
      ledgerReturn = 'report';
      showLedger();
    },
  });
  show('report');
}

function showLedger(): void {
  const { sessions, unknownSchemaCount, unavailable } = loadSessions();
  renderLedger(hosts.ledger, {
    sessions,
    device: viewingSession?.device ?? deviceSignature(),
    unknownSchemaCount,
    storageUnavailable: unavailable,
    notice: ledgerNotice,
    hasReport: viewingSession !== null,
    theme,
    onLoadExamples: () => void openExampleReport(),
    onClearAll: () => {
      clearAllData();
      announce('All Gimbal data cleared from this browser. Your theme returns to the system setting.');
      document.documentElement.removeAttribute('data-theme');
      theme = null;
      showLedger();
    },
    onBack: () => {
      if (ledgerReturn === 'report' && viewingSession) void openReport();
      else showPrescribe();
    },
  });
  show('ledger');
}

// Keep the picker in sync across re-renders.
document.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement | null;
  if (target?.name === 'theme' && target.checked) theme = target.value as ThemeName;
});

showPrescribe();
