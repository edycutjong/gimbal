// @vitest-environment jsdom
/**
 * Coverage suite for the two ENTRY POINTS — `src/main.ts` (the six-screen
 * instrument) and `src/landing/main.ts` (the landing page).
 *
 * Both files are bootstraps: their whole body is a side effect that runs at
 * import time against a live document. So every test here rebuilds the document
 * the real `app/index.html` (or `index.html`) ships, installs the browser
 * globals jsdom does not implement, and only then does a fresh
 * `await import(...)` under `vi.resetModules()`.
 *
 * WHAT IS SUBSTITUTED, AND WHY.
 *
 * `main.ts` is wiring: it owns the route flag, the screen enum, the session
 * reducer, and the callbacks it hands each screen. It owns none of the rendering
 * and none of the hardware. So the six screen renderers, the block runner, the
 * audio engine, the MediaPipe loader, the example-ledger fetch and the download
 * helper are substituted — that is what makes the callbacks main.ts passes
 * *observable*, which is the only way to assert on wiring at all.
 *
 * What is NOT substituted is everything that carries a claim: `protocol/card.ts`
 * (real, except where a test forces a defensive branch — each one is labelled),
 * `protocol/exampleParameters.ts`, `store/local.ts`, `store/session.ts`,
 * `store/deviceSignature.ts`, `report/report.ts`, `ui/live.ts`, `ui/dom.ts`,
 * `ui/copy.ts`, `session/dose.ts` and `optotype/trials.ts` all run for real, and
 * the assertions below are on their real output.
 *
 * THE INVARIANT THIS FILE EXISTS TO HOLD (check `U-CARD`, claim C1): the example
 * flag is derived from the `?blank` route. `/app` and `/app?demo` arrive
 * pre-filled AND labelled; `/app?blank` is eight empty fields; and on all three
 * routes the clinician-attestation checkbox arrives unticked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { emptyDraft, type CardDraft, type ProtocolCard } from '../src/protocol/card.ts';
import { exampleDraft, EXAMPLE_DRAFT_BANNER, EXAMPLE_SOURCE } from '../src/protocol/exampleParameters.ts';
import { DoseAccumulator } from '../src/session/dose.ts';
import { TrialScheduler } from '../src/optotype/trials.ts';
import { detuneCents } from '../src/audio/scheduler.ts';
import { refusalPhrase } from '../src/ui/copy.ts';
import { SESSION_SCHEMA, VELOCITY_SCALE, type PersistedSession } from '../src/store/session.ts';
import { SESSIONS_KEY, THEME_KEY } from '../src/store/local.ts';
import type { ScoredCycle } from '../src/dsp/types.ts';
import type { BlockResult } from '../src/session/blockRunner.ts';

/*
 * The version the build stamps, substituted by the `define` in
 * `vitest.config.ts` from the same `package.json` that `vite.config.ts` reads.
 *
 * Asserted through this constant rather than as a literal ON PURPOSE. This
 * string is what `APP_VERSION` writes onto every persisted session and therefore
 * onto every printed report a clinician reads. It was hard-coded `gimbal 0.1.0`
 * while `package.json` was at 1.3.0 — five releases of reports naming the wrong
 * build. A literal here would have asserted the bug was working.
 */
declare const __GIMBAL_VERSION__: string;
const EXPECTED_APP_VERSION = `gimbal ${__GIMBAL_VERSION__}`;

// ---------------------------------------------------------------------------
// Hoisted control surface. Every substitute below reads from `h`, and every
// test writes to it before importing the entry point.
// ---------------------------------------------------------------------------

interface Recorded {
  host: HTMLElement;
  props: Record<string, unknown>;
}

const h = vi.hoisted(() => {
  const state = {
    /** Screens whose substitute must leave the host EMPTY (no `#screen-title`). */
    headless: new Set<string>(),
    /** Renders that must probe the not-yet-assigned runner from inside renderBlock. */
    probeNullRunner: false,
    /** 'real' | 'null' (defensive guard) | 'zero-dose' (defensive arithmetic guard). */
    cardMode: 'real' as 'real' | 'null' | 'zero-dose',
    landmarkerError: null as Error | null,
    landmarker: { id: 'fake-landmarker' } as unknown,
    /** Runs inside the model load — the one window between two announcements. */
    duringModelLoad: null as (() => void) | null,
    exampleOutcome: {
      ok: false,
      added: 0,
      reason: 'nothing recorded',
      sessions: [] as unknown[],
    } as Record<string, unknown>,
    props: {} as Record<string, Recorded[]>,
    runners: [] as { opts: Record<string, never> }[],
    audio: [] as unknown[],
    downloads: [] as unknown[],
    blockViews: [] as Record<string, ReturnType<typeof vi.fn>>[],
    record(name: string, host: HTMLElement, props: Record<string, unknown>): void {
      (state.props[name] ??= []).push({ host, props });
      // Exactly ONE `#screen-title` may exist at a time. jsdom's selector engine
      // resolves a scoped `#id` through the document's id map, so a stale
      // heading left in a hidden host is what `host.querySelector('#screen-title')`
      // would return — a jsdom quirk, not app behaviour, and it would silently
      // turn the focus assertions below into no-ops.
      for (const stale of Array.from(document.querySelectorAll('#screen-title'))) stale.remove();
      host.innerHTML = state.headless.has(name)
        ? '<p>no heading on this screen</p>'
        : `<h1 id="screen-title" tabindex="-1">${name}</h1>`;
    },
    reset(): void {
      state.headless.clear();
      state.probeNullRunner = false;
      state.cardMode = 'real';
      state.landmarkerError = null;
      state.duringModelLoad = null;
      state.exampleOutcome = { ok: false, added: 0, reason: 'nothing recorded', sessions: [] };
      state.props = {};
      state.runners.length = 0;
      state.audio.length = 0;
      state.downloads.length = 0;
      state.blockViews.length = 0;
    },
  };
  return state;
});

// ---------------------------------------------------------------------------
// Substitutes
// ---------------------------------------------------------------------------

/**
 * `cardFromDraft` is REAL unless a test asks otherwise. The two overrides exist
 * only to reach main.ts's defensive guards: a null card cannot be produced by
 * the real function (it throws or returns a card), and `blockSeconds` is
 * range-checked at 10 s minimum so a zero prescription is likewise not
 * constructible. Both are labelled at every call site below.
 */
vi.mock('../src/protocol/card.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/protocol/card.ts')>();
  return {
    ...real,
    cardFromDraft: (draft: CardDraft) => {
      if (h.cardMode === 'null') return null;
      const card = real.cardFromDraft(draft);
      if (h.cardMode === 'zero-dose') {
        return { ...card, blockSeconds: { ...card.blockSeconds, value: 0 } };
      }
      return card;
    },
  };
});

vi.mock('../src/capture/landmarker.ts', () => ({
  createLandmarkerWithFallback: async () => {
    h.duringModelLoad?.();
    if (h.landmarkerError) throw h.landmarkerError;
    return { landmarker: h.landmarker, delegate: 'CPU' as const };
  },
}));

vi.mock('../src/session/blockRunner.ts', () => {
  class FakeBlockRunner {
    paused = false;
    startCount = 0;
    pauseCount = 0;
    resumeCount = 0;
    interruptCount = 0;
    answers: number[] = [];
    constructor(public readonly opts: Record<string, never>) {
      h.runners.push(this as unknown as { opts: Record<string, never> });
    }
    get isPaused(): boolean {
      return this.paused;
    }
    start(): void {
      this.startCount += 1;
    }
    pause(): void {
      this.pauseCount += 1;
      this.paused = true;
    }
    resume(): void {
      this.resumeCount += 1;
      this.paused = false;
    }
    interrupt(): void {
      this.interruptCount += 1;
    }
    answer(o: number): boolean {
      this.answers.push(o);
      return true;
    }
  }
  return { BlockRunner: FakeBlockRunner };
});

vi.mock('../src/audio/scheduler.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/audio/scheduler.ts')>();
  class FakeAudioEngine {
    starts: { periodSec: number; volume: number }[] = [];
    muted: boolean[] = [];
    detunes: number[] = [];
    earcons = 0;
    suspends = 0;
    stops = 0;
    constructor() {
      h.audio.push(this);
    }
    async start(opts: { periodSec: number; volume: number }): Promise<void> {
      this.starts.push(opts);
    }
    setMuted(m: boolean): void {
      this.muted.push(m);
    }
    setDetune(c: number): void {
      this.detunes.push(c);
    }
    refusalEarcon(): void {
      this.earcons += 1;
    }
    async suspend(): Promise<void> {
      this.suspends += 1;
    }
    async stop(): Promise<void> {
      this.stops += 1;
    }
  }
  // `detuneCents` stays real — main.ts feeds it the frame's ω and the card.
  return { ...real, AudioEngine: FakeAudioEngine };
});

vi.mock('../src/ui/screens/prescribe.ts', () => ({
  renderPrescribe: (host: HTMLElement, props: Record<string, unknown>) => h.record('prescribe', host, props),
}));

vi.mock('../src/ui/screens/setup.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/ui/screens/setup.ts')>();
  return {
    ...real,
    renderSetup: (host: HTMLElement, props: Record<string, unknown>) => h.record('setup', host, props),
  };
});

vi.mock('../src/ui/screens/block.ts', () => ({
  renderBlock: (host: HTMLElement, props: Record<string, unknown>) => {
    h.record('block', host, props);
    if (h.probeNullRunner) {
      // renderBlock runs BEFORE main.ts assigns `runner`, so calling back into
      // these three handlers here is the real window in which the optional
      // chains on `runner` see no runner at all.
      (props.onAnswer as (o: number) => void)(2);
      (props.onPauseToggle as () => void)();
      (props.onInterrupt as () => void)();
    }
    const view = {
      onFrame: vi.fn(),
      onCycle: vi.fn(),
      setPaused: vi.fn(),
      setOptotype: vi.fn(),
      destroy: vi.fn(),
    };
    h.blockViews.push(view);
    return view;
  },
}));

vi.mock('../src/ui/screens/gate.ts', () => ({
  renderGate: (host: HTMLElement, props: Record<string, unknown>) => h.record('gate', host, props),
}));

vi.mock('../src/ui/screens/report.ts', () => ({
  renderReport: (host: HTMLElement, props: Record<string, unknown>) => h.record('report', host, props),
}));

vi.mock('../src/ui/screens/ledger.ts', () => ({
  renderLedger: (host: HTMLElement, props: Record<string, unknown>) => h.record('ledger', host, props),
}));

vi.mock('../src/store/exampleLedger.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/store/exampleLedger.ts')>();
  return { ...real, loadExampleLedger: async () => h.exampleOutcome };
});

vi.mock('../src/store/export.ts', () => ({
  downloadSessionJson: (session: unknown) => {
    h.downloads.push(session);
  },
}));

vi.mock('../src/landing/replay.ts', () => ({
  mountReplay: (...args: unknown[]) => {
    h.downloads.push({ mountReplay: args });
  },
}));

// ---------------------------------------------------------------------------
// Document + global environment
// ---------------------------------------------------------------------------

const APP_BODY = `
  <a class="skip-link" href="#screen-title">Skip to the main content</a>
  <main>
    <section id="screen-prescribe" class="screen"></section>
    <section id="screen-setup" class="screen" hidden></section>
    <section id="screen-block" class="screen" hidden></section>
    <section id="screen-gate" class="screen" hidden></section>
    <section id="screen-report" class="screen" hidden></section>
    <section id="screen-ledger" class="screen" hidden></section>
  </main>
  <div id="live-status" role="status" aria-live="polite"></div>
  <div id="live-alert" role="alert" aria-live="assertive"></div>
  <video id="camera" playsinline muted hidden></video>`;

const LANDING_BODY = `
  <div id="theme-slot"></div>
  <div id="replay-slot"></div>
  <p id="chapter-slot"></p>
  <div id="band-figure"></div>
  <div id="report-figure"></div>`;

/** jsdom has no MediaStream, and `deviceSignature()` uses `instanceof` on one. */
class FakeMediaStream {
  constructor(private readonly tracks: { label?: string }[] = []) {}
  getVideoTracks(): { label?: string }[] {
    return this.tracks;
  }
}

const printSpy = vi.fn();
const scrollSpy = vi.fn();

/** Every `document.addEventListener` main.ts makes, so afterEach can undo it. */
const docListeners: [string, EventListener][] = [];
const nativeAdd = document.addEventListener.bind(document);
document.addEventListener = ((type: string, fn: EventListener, opts?: unknown) => {
  docListeners.push([type, fn]);
  nativeAdd(type, fn, opts as AddEventListenerOptions);
}) as typeof document.addEventListener;

function installAppDom(): void {
  document.documentElement.removeAttribute('data-theme');
  document.body.innerHTML = APP_BODY;
}

interface BootOptions {
  search?: string;
  /** Drives the `globalThis.location?.search ?? ''` fallback. */
  noLocation?: boolean;
  /** Drives the `globalThis.scrollTo?.(0, 0)` fallback. */
  noScrollTo?: boolean;
}

async function bootApp(o: BootOptions = {}): Promise<void> {
  installAppDom();
  if (o.noLocation) vi.stubGlobal('location', undefined);
  else vi.stubGlobal('location', { search: o.search ?? '', href: `http://localhost/app${o.search ?? ''}` });
  if (o.noScrollTo) vi.stubGlobal('scrollTo', undefined);
  else vi.stubGlobal('scrollTo', scrollSpy);
  await import('../src/main.ts');
}

// ---------------------------------------------------------------------------
// Reading what main.ts handed each screen
// ---------------------------------------------------------------------------

/**
 * main.ts hands the screens `() => void asyncThing()` callbacks — deliberately,
 * because a screen must never be able to await the session. So a test drains the
 * microtask queue rather than awaiting a promise it is never given.
 */
async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

/** LiveRegions drops a second sentence inside 2 s; tests that assert one step past it. */
function pastAnnounceFloor(): void {
  vi.advanceTimersByTime(2100);
}

function renders(screen: string): Recorded[] {
  return h.props[screen] ?? [];
}

function last(screen: string): Record<string, unknown> {
  const list = renders(screen);
  const item = list[list.length - 1];
  if (!item) throw new Error(`no ${screen} render recorded`);
  return item.props;
}

function callback(screen: string, name: string): (...args: never[]) => unknown {
  return last(screen)[name] as (...args: never[]) => unknown;
}

function visibleScreen(): string {
  const shown = Array.from(document.querySelectorAll<HTMLElement>('section.screen')).filter((s) => !s.hidden);
  expect(shown).toHaveLength(1);
  return (shown[0] as HTMLElement).id.replace('screen-', '');
}

function statusText(): string {
  return (document.querySelector('#live-status') as HTMLElement).textContent ?? '';
}

// ---------------------------------------------------------------------------
// Fixtures for the block results the runner hands back
// ---------------------------------------------------------------------------

function scoredCycle(over: Partial<ScoredCycle> = {}): ScoredCycle {
  return {
    tStartMs: 0,
    tEndMs: 500,
    periodMs: 500,
    peakOmega: 220,
    rawPeakOmega: 210,
    sampleCount: 15,
    qMin: 0.8,
    qMean: 0.9,
    fHat: 2,
    faceLost: false,
    saturated: false,
    credited: true,
    reason: 'ok',
    ...over,
  };
}

interface ResultOptions {
  index?: number;
  prescribedSeconds?: number;
  fHatMedian?: number;
  effectiveFpsMedian?: number;
  interrupted?: boolean;
  cycles?: ScoredCycle[];
}

function blockResult(o: ResultOptions = {}): BlockResult {
  const dose = new DoseAccumulator();
  for (const c of o.cycles ?? [scoredCycle(), scoredCycle({ credited: false, reason: 'too-slow' })]) dose.add(c);
  return {
    index: o.index ?? 0,
    prescribedSeconds: o.prescribedSeconds ?? 60,
    dose,
    trials: new TrialScheduler(0, () => 0.5),
    fHatMedian: o.fHatMedian ?? 2,
    effectiveFpsMedian: o.effectiveFpsMedian ?? 30,
    interrupted: o.interrupted ?? false,
  };
}

/** A complete, valid draft — the eight numbers plus the tick a HUMAN supplies. */
function attestedDraft(): CardDraft {
  return { ...exampleDraft(), gateAcknowledged: true };
}

/** prescribe → setup → (landmarker) → baseline gate. Returns the built card. */
async function reachBaselineGate(): Promise<ProtocolCard> {
  (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
  const card = last('setup').card as ProtocolCard;
  (callback('setup', 'onStart') as () => void)();
  await flush();
  return card;
}

/** …and on through the baseline rating into block 0. */
async function reachFirstBlock(rating = 2): Promise<ProtocolCard> {
  const card = await reachBaselineGate();
  (callback('gate', 'onRuling') as (r: number, o: string | null) => void)(rating, null);
  return card;
}

interface RunnerCallbacks {
  onFrame: (s: unknown) => void;
  onCycle: (c: unknown) => void;
  onPause: (paused: boolean) => void;
  onFinish: (r: BlockResult) => void;
}

function runnerCallbacks(): RunnerCallbacks {
  const runner = h.runners[h.runners.length - 1];
  if (!runner) throw new Error('no runner constructed');
  return (runner.opts as unknown as { callbacks: RunnerCallbacks }).callbacks;
}

function lastView(): Record<string, ReturnType<typeof vi.fn>> {
  const view = h.blockViews[h.blockViews.length - 1];
  if (!view) throw new Error('no block view created');
  return view;
}

function audioEngine(): {
  starts: { periodSec: number; volume: number }[];
  muted: boolean[];
  detunes: number[];
  earcons: number;
  suspends: number;
  stops: number;
} {
  const engine = h.audio[h.audio.length - 1];
  if (!engine) throw new Error('no audio engine constructed');
  return engine as ReturnType<typeof audioEngine>;
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetModules();
  h.reset();
  printSpy.mockClear();
  scrollSpy.mockClear();
  window.localStorage.clear();
  vi.stubGlobal('print', printSpy);
  vi.stubGlobal('MediaStream', FakeMediaStream);
});

afterEach(() => {
  for (const [type, fn] of docListeners) document.removeEventListener(type, fn);
  docListeners.length = 0;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
});

// ===========================================================================
// src/main.ts — the route flag (claim C1 / check U-CARD)
// ===========================================================================

describe('main.ts — the three entry routes', () => {
  it('serves /app pre-filled with the labelled example draft', async () => {
    await bootApp({ search: '' });
    const props = last('prescribe');
    expect(props.draft).toEqual(exampleDraft());
    expect(props.exampleBanner).toBe(EXAMPLE_DRAFT_BANNER);
    expect((props.draft as CardDraft).gateAcknowledged).toBe(false);
    expect(Object.values((props.draft as CardDraft).sources)).toEqual(Array(8).fill(EXAMPLE_SOURCE));
  });

  it('serves /app?demo with exactly the same pre-filled, labelled draft', async () => {
    await bootApp({ search: '?demo' });
    const props = last('prescribe');
    expect(props.draft).toEqual(exampleDraft());
    expect(props.exampleBanner).toBe(EXAMPLE_DRAFT_BANNER);
    expect((props.draft as CardDraft).gateAcknowledged).toBe(false);
  });

  it('serves /app?blank as eight empty fields with no example label', async () => {
    await bootApp({ search: '?blank' });
    const props = last('prescribe');
    expect(props.draft).toEqual(emptyDraft());
    expect(Object.keys((props.draft as CardDraft).values)).toHaveLength(0);
    expect(props.exampleBanner).toBeNull();
    expect((props.draft as CardDraft).gateAcknowledged).toBe(false);
  });

  it('treats `?blank` as a route, not a substring — `?blankish` is still blank-routed', async () => {
    await bootApp({ search: '?blankish=1' });
    // URLSearchParams keys on the whole parameter name, so this is NOT ?blank.
    expect(last('prescribe').exampleBanner).toBe(EXAMPLE_DRAFT_BANNER);
  });

  it('honours `?blank` alongside other parameters', async () => {
    await bootApp({ search: '?utm=x&blank' });
    expect(last('prescribe').draft).toEqual(emptyDraft());
    expect(last('prescribe').exampleBanner).toBeNull();
  });

  it('falls back to an empty query string when there is no location at all', async () => {
    await bootApp({ noLocation: true });
    expect(last('prescribe').draft).toEqual(exampleDraft());
    expect(last('prescribe').exampleBanner).toBe(EXAMPLE_DRAFT_BANNER);
  });

  it('never ticks the clinician attestation on any of the three routes', async () => {
    for (const search of ['', '?demo', '?blank']) {
      vi.resetModules();
      h.reset();
      await bootApp({ search });
      expect((last('prescribe').draft as CardDraft).gateAcknowledged).toBe(false);
    }
  });
});

// ===========================================================================
// Theme, first paint and screen changes
// ===========================================================================

describe('main.ts — theme and the show() transition', () => {
  it('applies a stored theme at boot and passes it to the first screen', async () => {
    window.localStorage.setItem(THEME_KEY, 'dim');
    await bootApp();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dim');
    expect(last('prescribe').theme).toBe('dim');
  });

  it('leaves the palette to the OS when nothing is stored', async () => {
    await bootApp();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(last('prescribe').theme).toBeNull();
  });

  it('shows exactly one screen and scrolls to the top on the first paint', async () => {
    await bootApp();
    expect(visibleScreen()).toBe('prescribe');
    expect(scrollSpy).toHaveBeenCalledWith(0, 0);
  });

  it('does NOT focus the heading on the very first paint', async () => {
    await bootApp();
    expect(document.querySelector('#screen-title')).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus to the new heading on every subsequent screen change', async () => {
    await bootApp();
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
    expect(visibleScreen()).toBe('setup');
    expect((document.activeElement as HTMLElement).id).toBe('screen-title');
    expect(document.activeElement?.textContent).toBe('setup');
  });

  it('survives a screen that renders no heading', async () => {
    h.headless.add('setup');
    await bootApp();
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
    expect(visibleScreen()).toBe('setup');
    expect(document.querySelector('#screen-setup h1')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('survives a runtime with no scrollTo', async () => {
    await bootApp({ noScrollTo: true });
    expect(visibleScreen()).toBe('prescribe');
  });

  it('tracks the theme picker across re-renders via the delegated change listener', async () => {
    await bootApp();
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'theme';
    input.value = 'light';
    input.checked = true;
    document.body.appendChild(input);
    input.dispatchEvent(new Event('change', { bubbles: true }));

    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
    expect(last('setup').theme).toBe('light');
  });

  it('ignores a change from an unchecked theme radio and from a non-theme control', async () => {
    await bootApp();
    const theme = document.createElement('input');
    theme.type = 'radio';
    theme.name = 'theme';
    theme.value = 'light';
    theme.checked = false;
    const other = document.createElement('input');
    other.name = 'volume';
    other.value = 'dim';
    document.body.append(theme, other);
    theme.dispatchEvent(new Event('change', { bubbles: true }));
    other.dispatchEvent(new Event('change', { bubbles: true }));

    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
    expect(last('setup').theme).toBeNull();
  });

  it('ignores a change event that carries no target', async () => {
    await bootApp();
    const event = new Event('change', { bubbles: true });
    // A dispatched DOM event always has a target; the null guard is defensive,
    // so the property is shadowed to reach it.
    Object.defineProperty(event, 'target', { value: null, configurable: true });
    document.dispatchEvent(event);
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
    expect(last('setup').theme).toBeNull();
  });
});

// ===========================================================================
// Screen 1 → 2 → session start
// ===========================================================================

describe('main.ts — prescribe into setup', () => {
  it('builds the card from the submitted draft and hands it to setup', async () => {
    await bootApp();
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
    const card = last('setup').card as ProtocolCard;
    expect(card.frequencyBand.value).toEqual([1.7, 2.3]);
    expect(card.blockSeconds.value).toBe(60);
    expect(card.frequencyBand.source).toBe(EXAMPLE_SOURCE);
    expect(card.enteredBy).toBe('patient-from-clinician-handout');
    expect(last('setup').video).toBe(document.querySelector('#camera'));
  });

  it('starts and mutes audio from the setup screen without starting a session', async () => {
    await bootApp();
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
    (callback('setup', 'onAudioTest') as (v: number) => void)(0.25);
    (callback('setup', 'onAudioOff') as (off: boolean) => void)(true);
    expect(audioEngine().starts).toEqual([{ periodSec: 1 / 2, volume: 0.25 }]);
    expect(audioEngine().muted).toEqual([true]);
    expect(renders('gate')).toHaveLength(0);
  });

  it('re-renders setup in place when the screen asks for it', async () => {
    await bootApp();
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
    (callback('setup', 'rerender') as () => void)();
    expect(renders('setup')).toHaveLength(2);
    expect(visibleScreen()).toBe('setup');
  });

  it('announces through the polite live region', async () => {
    await bootApp();
    (callback('prescribe', 'announce') as (t: string) => void)('camera looks good');
    expect(statusText()).toBe('camera looks good');
  });

  it('returns to prescribe if setup is asked for without a card', async () => {
    // Defensive guard: `cardFromDraft` cannot return null in production — it
    // returns a card or throws — so the impossible state is forced here.
    await bootApp();
    h.cardMode = 'null';
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
    expect(visibleScreen()).toBe('prescribe');
    expect(renders('setup')).toHaveLength(0);
    expect(renders('prescribe')).toHaveLength(2);
  });
});

describe('main.ts — startSession', () => {
  it('loads the tracking model, starts audio, and opens the baseline gate', async () => {
    await bootApp();
    const card = await reachBaselineGate();
    expect(audioEngine().starts).toEqual([{ periodSec: 1 / 2, volume: 0.5 }]);
    expect(audioEngine().muted).toEqual([false]);
    const gate = last('gate');
    expect(gate.card).toBe(card);
    expect(gate.baseline).toBeNull();
    expect(gate.afterBlock).toBeNull();
    expect(gate.isFinal).toBe(false);
    expect(visibleScreen()).toBe('gate');
  });

  it('refuses to start and says why when the model does not download', async () => {
    vi.useFakeTimers();
    await bootApp();
    h.landmarkerError = new Error('offline');
    // "Loading the tracking model." went out first; the polite region coalesces
    // inside 2 s, so the clock steps past the floor while the load is in flight.
    h.duringModelLoad = pastAnnounceFloor;
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
    (callback('setup', 'onStart') as () => void)();
    await flush();
    expect(statusText()).toBe('Reload — the tracking model did not finish downloading.');
    expect(renders('gate')).toHaveLength(0);
    expect(visibleScreen()).toBe('setup');
  });

  it('does not re-download the model on a second session', async () => {
    await bootApp();
    await reachBaselineGate();
    h.landmarkerError = new Error('would be fatal if it were requested again');
    (callback('setup', 'rerender') as () => void)();
    (callback('setup', 'onStart') as () => void)();
    await flush();
    expect(renders('gate')).toHaveLength(2);
    expect(visibleScreen()).toBe('gate');
  });

  it('resets the accumulated session state on every start', async () => {
    await bootApp();
    await reachFirstBlock(4);
    runnerCallbacks().onFinish(blockResult());
    await flush();
    // Second run of the same card: the first run's rating must not survive.
    (callback('setup', 'rerender') as () => void)();
    (callback('setup', 'onStart') as () => void)();
    await flush();
    expect(last('gate').baseline).toBeNull();
    expect(last('gate').afterBlock).toBeNull();
  });

  it('does nothing at all when asked to start without a card', async () => {
    // Defensive guard — forced impossible state, as above.
    await bootApp();
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
    const onStart = callback('setup', 'onStart') as () => Promise<void>;
    h.cardMode = 'null';
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
    onStart();
    await flush();
    expect(renders('gate')).toHaveLength(0);
    expect(audioEngine().starts).toEqual([]);
  });
});

// ===========================================================================
// Screen 3 — the block
// ===========================================================================

describe('main.ts — the block screen', () => {
  it('records the baseline rating and opens block 1', async () => {
    await bootApp();
    const card = await reachFirstBlock(3);
    const block = last('block');
    expect(block.card).toBe(card);
    expect(block.blockIndex).toBe(0);
    expect(block.optoVmin).toBe(4);
    expect(block.hideVideo).toBe(false);
    expect(h.runners).toHaveLength(1);
    expect((h.runners[0] as unknown as { startCount: number }).startCount).toBe(1);
    expect(visibleScreen()).toBe('block');
  });

  it('forwards answers, pause toggles and interrupts to the runner', async () => {
    await bootApp();
    await reachFirstBlock();
    const runner = h.runners[0] as unknown as {
      answers: number[];
      pauseCount: number;
      resumeCount: number;
      interruptCount: number;
      paused: boolean;
    };
    (callback('block', 'onAnswer') as (o: number) => void)(1);
    expect(runner.answers).toEqual([1]);

    (callback('block', 'onPauseToggle') as () => void)();
    expect(runner.pauseCount).toBe(1);
    expect(audioEngine().suspends).toBe(1);

    (callback('block', 'onPauseToggle') as () => void)();
    await flush();
    await flush();
    expect(runner.resumeCount).toBe(1);
    expect(audioEngine().starts).toHaveLength(2);
    expect(audioEngine().muted).toEqual([false, false]);

    (callback('block', 'onInterrupt') as () => void)();
    expect(runner.interruptCount).toBe(1);
  });

  it('tolerates the three block handlers firing before the runner exists', async () => {
    h.probeNullRunner = true;
    await bootApp();
    await reachFirstBlock();
    // The probe fired inside renderBlock, i.e. one line before `runner` is
    // assigned: nothing throws, and the pause path still suspends audio.
    expect(audioEngine().suspends).toBe(1);
    expect((h.runners[0] as unknown as { pauseCount: number }).pauseCount).toBe(0);
  });

  it('paints frames, detunes on a finite ω and stays silent on a NaN one', async () => {
    await bootApp();
    const card = await reachFirstBlock();
    const frame = {
      tMs: 100,
      omega: -180,
      deliveredSeconds: 1.5,
      elapsedMs: 1000,
      facePresent: true,
      quality: 0.9,
      optotypeShown: 2,
      optotypeWindowOpen: true,
    };
    runnerCallbacks().onFrame(frame);
    expect(lastView().onFrame).toHaveBeenCalledWith(frame);
    expect(lastView().setOptotype).toHaveBeenCalledWith(2, true);
    expect(audioEngine().detunes).toEqual([detuneCents(180, card)]);

    runnerCallbacks().onFrame({ ...frame, omega: NaN });
    expect(audioEngine().detunes).toHaveLength(1);
  });

  it('announces and sounds a refusal, and does neither for a credited cycle', async () => {
    vi.useFakeTimers();
    await bootApp();
    await reachFirstBlock();
    const credited = scoredCycle();
    runnerCallbacks().onCycle(credited);
    expect(lastView().onCycle).toHaveBeenCalledWith(credited);
    expect(audioEngine().earcons).toBe(0);

    const refused = scoredCycle({ credited: false, reason: 'too-fast' });
    runnerCallbacks().onCycle(refused);
    expect(audioEngine().earcons).toBe(1);
    vi.advanceTimersByTime(2100);
    expect(statusText()).toBe(`1 rep not counted — ${refusalPhrase('too-fast')}.`);
  });

  it('passes pause state straight through to the view', async () => {
    await bootApp();
    await reachFirstBlock();
    runnerCallbacks().onPause(true);
    expect(lastView().setPaused).toHaveBeenCalledWith(true);
  });

  it('pauses the block when the tab is hidden, and only then', async () => {
    await bootApp();
    await reachFirstBlock();
    const runner = h.runners[0] as unknown as { pauseCount: number };

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(runner.pauseCount).toBe(0);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(runner.pauseCount).toBe(1);
    expect(audioEngine().suspends).toBe(1);
  });

  it('ignores a hidden tab when no block is running', async () => {
    await bootApp();
    await reachBaselineGate();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(audioEngine().suspends).toBe(0);
  });

  it('does not resume audio when the card has gone', async () => {
    // Defensive guard — forced impossible state.
    await bootApp();
    await reachFirstBlock();
    const runner = h.runners[0] as unknown as { paused: boolean; resumeCount: number };
    runner.paused = true;
    const startsBefore = audioEngine().starts.length;
    h.cardMode = 'null';
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
    (callback('block', 'onPauseToggle') as () => void)();
    await flush();
    expect(audioEngine().starts).toHaveLength(startsBefore);
    expect(runner.resumeCount).toBe(0);
  });

  it('does not open a block without a landmarker or a card', async () => {
    // Defensive guard — forced impossible state.
    await bootApp();
    await reachBaselineGate();
    const onRuling = callback('gate', 'onRuling') as (r: number, o: string | null) => void;
    h.cardMode = 'null';
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
    onRuling(3, null);
    expect(renders('block')).toHaveLength(0);
    expect(h.runners).toHaveLength(0);
  });
});

// ===========================================================================
// finishBlock, persistence and the gates
// ===========================================================================

describe('main.ts — finishing a block', () => {
  it('tears the view down, suspends audio, persists, and opens the final gate on a one-block card', async () => {
    await bootApp();
    await reachFirstBlock(2);
    const view = lastView();
    runnerCallbacks().onFinish(blockResult());
    await flush();

    expect(view.destroy).toHaveBeenCalledTimes(1);
    expect(audioEngine().suspends).toBe(1);
    const gate = last('gate');
    expect(gate.isFinal).toBe(true);
    expect(gate.afterBlock).toBe(0);
    expect(gate.baseline).toBe(2);

    const stored = JSON.parse(window.localStorage.getItem(SESSIONS_KEY) ?? '[]') as PersistedSession[];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.schema).toBe(SESSION_SCHEMA);
    expect(stored[0]?.provenance).toBe('live');
    expect(stored[0]?.appVersion).toBe(EXPECTED_APP_VERSION);
    expect(stored[0]?.methodsRev).toBe('METHODS.md@unreleased');
    expect(stored[0]?.cardId).toBe('clinician-entered');
    expect(stored[0]?.symptom.baseline).toBe(2);
    expect(stored[0]?.blocks[0]?.cyclesAttempted).toBe(2);
    expect(stored[0]?.blocks[0]?.cyclesCredited).toBe(1);
    expect(stored[0]?.blocks[0]?.deliveredSeconds).toBe(0.5);
    expect(stored[0]?.blocks[0]?.refusals['too-slow']).toBe(1);
    expect(stored[0]?.blocks[0]?.peakVelocityScale).toBe(VELOCITY_SCALE);
    expect(stored[0]?.blocks[0]?.fHatBinWidthHz).toBeCloseTo(30 / 256, 6);
    expect(stored[0]?.totals).toEqual({ prescribedSeconds: 60, deliveredSeconds: 0.5, ratio: 0.008 });
  });

  it('writes NaN for the bin width when the frame rate was never established', async () => {
    await bootApp();
    await reachFirstBlock();
    runnerCallbacks().onFinish(blockResult({ effectiveFpsMedian: NaN }));
    await flush();
    const stored = JSON.parse(window.localStorage.getItem(SESSIONS_KEY) ?? '[]') as PersistedSession[];
    // JSON has no NaN, so the round trip is the honest proof it was not a number.
    expect(stored[0]?.blocks[0]?.fHatBinWidthHz).toBeNull();
  });

  it('says so, and still shows the gate, when history cannot be written', async () => {
    vi.useFakeTimers();
    await bootApp();
    await reachFirstBlock();
    pastAnnounceFloor();
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => undefined,
    });
    runnerCallbacks().onFinish(blockResult());
    await flush();
    expect(statusText()).toBe('History could not be saved in this browser — your report still prints.');
    expect(last('gate').isFinal).toBe(true);
  });

  it('opens a mid-session gate when blocks remain', async () => {
    await bootApp();
    const draft = attestedDraft();
    draft.values = { ...draft.values, blockCount: 3 };
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(draft);
    (callback('setup', 'onStart') as () => void)();
    await flush();
    (callback('gate', 'onRuling') as (r: number, o: string | null) => void)(2, null);
    runnerCallbacks().onFinish(blockResult());
    await flush();
    expect(last('gate').isFinal).toBe(false);
    expect(last('gate').afterBlock).toBe(0);
  });

  it('ends the session on an interruption, with no mid-block resume', async () => {
    await bootApp();
    const draft = attestedDraft();
    draft.values = { ...draft.values, blockCount: 3 };
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(draft);
    (callback('setup', 'onStart') as () => void)();
    await flush();
    (callback('gate', 'onRuling') as (r: number, o: string | null) => void)(2, null);
    runnerCallbacks().onFinish(blockResult({ interrupted: true }));
    await flush();
    expect(last('gate').isFinal).toBe(true);
    expect(last('gate').afterBlock).toBe(0);
  });

  it('is re-entrant: a second finish with no live view does not throw', async () => {
    // The real runner latches `finished`, so this is a defensive path.
    await bootApp();
    await reachFirstBlock();
    const view = lastView();
    runnerCallbacks().onFinish(blockResult());
    await flush();
    runnerCallbacks().onFinish(blockResult({ index: 1 }));
    await flush();
    expect(view.destroy).toHaveBeenCalledTimes(1);
    expect(renders('gate')).toHaveLength(3);
  });

  it('persists a zero baseline when a late finish lands in a restarted session', async () => {
    // A restart clears the baseline; a finish arriving from the abandoned runner
    // must still write a number, because `baseline` is not nullable on paper.
    await bootApp();
    await reachFirstBlock(4);
    const staleFinish = runnerCallbacks().onFinish;
    (callback('setup', 'onStart') as () => void)();
    await flush();
    expect(last('gate').baseline).toBeNull();

    staleFinish(blockResult());
    await flush();
    const stored = JSON.parse(window.localStorage.getItem(SESSIONS_KEY) ?? '[]') as PersistedSession[];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.symptom.baseline).toBe(0);
    expect(stored[0]?.symptom.final).toBeNull();
  });

  it('does not persist or gate once the card has gone', async () => {
    // Defensive guard — forced impossible state.
    await bootApp();
    await reachFirstBlock();
    const onFinish = runnerCallbacks().onFinish;
    h.cardMode = 'null';
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
    const gatesBefore = renders('gate').length;
    onFinish(blockResult());
    await flush();
    expect(renders('gate')).toHaveLength(gatesBefore);
    expect(window.localStorage.getItem(SESSIONS_KEY)).toBeNull();
  });
});

describe('main.ts — the symptom gates', () => {
  it('advances to the next block on a continue ruling and records the gate', async () => {
    await bootApp();
    const draft = attestedDraft();
    draft.values = { ...draft.values, blockCount: 3 };
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(draft);
    (callback('setup', 'onStart') as () => void)();
    await flush();
    (callback('gate', 'onRuling') as (r: number, o: string | null) => void)(2, null);
    runnerCallbacks().onFinish(blockResult());
    await flush();

    (callback('gate', 'onRuling') as (r: number, o: string | null) => void)(4, 'continue');
    expect(last('block').blockIndex).toBe(1);
    const stored = JSON.parse(window.localStorage.getItem(SESSIONS_KEY) ?? '[]') as PersistedSession[];
    expect(stored[0]?.symptom.gates).toEqual([{ afterBlock: 0, rating: 4, ruling: 'continue' }]);
  });

  it('defaults a missing ruling to continue', async () => {
    await bootApp();
    const draft = attestedDraft();
    draft.values = { ...draft.values, blockCount: 3 };
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(draft);
    (callback('setup', 'onStart') as () => void)();
    await flush();
    (callback('gate', 'onRuling') as (r: number, o: string | null) => void)(2, null);
    runnerCallbacks().onFinish(blockResult());
    await flush();
    (callback('gate', 'onRuling') as (r: number, o: string | null) => void)(3, null);
    const stored = JSON.parse(window.localStorage.getItem(SESSIONS_KEY) ?? '[]') as PersistedSession[];
    expect(stored[0]?.symptom.gates[0]?.ruling).toBe('continue');
  });

  it('turns an end-session ruling into the final gate instead of another block', async () => {
    await bootApp();
    const draft = attestedDraft();
    draft.values = { ...draft.values, blockCount: 3 };
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(draft);
    (callback('setup', 'onStart') as () => void)();
    await flush();
    (callback('gate', 'onRuling') as (r: number, o: string | null) => void)(2, null);
    runnerCallbacks().onFinish(blockResult());
    await flush();

    (callback('gate', 'onRuling') as (r: number, o: string | null) => void)(9, 'end-session');
    expect(last('gate').isFinal).toBe(true);
    expect(renders('block')).toHaveLength(1);
  });

  it('routes the assertive stop-rule sentence to the alert region only', async () => {
    await bootApp();
    await reachBaselineGate();
    const politeBefore = statusText();
    (callback('gate', 'alertEndSession') as (t: string) => void)('Stop the session.');
    expect((document.querySelector('#live-alert') as HTMLElement).textContent).toBe('Stop the session.');
    // The assertive region is reserved: nothing was written to the polite one.
    expect(statusText()).toBe(politeBefore);
    expect(statusText()).not.toContain('Stop the session.');
  });

  it('does not render a gate without a card', async () => {
    // Defensive guard — forced impossible state: the end-session ruling asks for
    // one more gate, and the card it would be rendered against has gone.
    await bootApp();
    const draft = attestedDraft();
    draft.values = { ...draft.values, blockCount: 3 };
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(draft);
    (callback('setup', 'onStart') as () => void)();
    await flush();
    (callback('gate', 'onRuling') as (r: number, o: string | null) => void)(2, null);
    runnerCallbacks().onFinish(blockResult());
    await flush();

    const onRuling = callback('gate', 'onRuling') as (r: number, o: string | null) => void;
    const before = renders('gate').length;
    h.cardMode = 'null';
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
    onRuling(9, 'end-session');
    expect(renders('gate')).toHaveLength(before);
    expect(renders('block')).toHaveLength(1);
  });
});

// ===========================================================================
// The device signature
// ===========================================================================

describe('main.ts — the device signature', () => {
  function stubVideoMetrics(width: number, height: number): void {
    const video = document.querySelector('#camera') as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => width });
    Object.defineProperty(video, 'videoHeight', { configurable: true, get: () => height });
  }

  it('reads the live camera label, resolution and the block-0 frame rate', async () => {
    await bootApp();
    await reachFirstBlock();
    const video = document.querySelector('#camera') as HTMLVideoElement;
    video.srcObject = new FakeMediaStream([{ label: 'FaceTime HD Camera' }]) as unknown as MediaStream;
    stubVideoMetrics(1280, 720);

    runnerCallbacks().onFinish(blockResult({ effectiveFpsMedian: 29.7 }));
    await flush();
    const stored = JSON.parse(window.localStorage.getItem(SESSIONS_KEY) ?? '[]') as PersistedSession[];
    expect(stored[0]?.device.cameraLabel).toBe('FaceTime HD Camera');
    expect(stored[0]?.device.resolution).toBe('1280x720');
    expect(stored[0]?.device.medianFps).toBe(29.7);
    expect(stored[0]?.device.userAgent).toBe(navigator.userAgent);
    expect(stored[0]?.device.sigHash).toMatch(/^fnv1a:[0-9a-f]+$/);
  });

  it('names an unlabelled track, and falls back to 640x480 with no video metrics', async () => {
    await bootApp();
    await reachFirstBlock();
    const video = document.querySelector('#camera') as HTMLVideoElement;
    video.srcObject = new FakeMediaStream([{}]) as unknown as MediaStream;
    runnerCallbacks().onFinish(blockResult());
    await flush();
    const stored = JSON.parse(window.localStorage.getItem(SESSIONS_KEY) ?? '[]') as PersistedSession[];
    expect(stored[0]?.device.cameraLabel).toBe('unnamed camera');
    expect(stored[0]?.device.resolution).toBe('640x480');
  });

  it('names an empty track list an unnamed camera', async () => {
    await bootApp();
    await reachFirstBlock();
    const video = document.querySelector('#camera') as HTMLVideoElement;
    video.srcObject = new FakeMediaStream([]) as unknown as MediaStream;
    runnerCallbacks().onFinish(blockResult());
    await flush();
    const stored = JSON.parse(window.localStorage.getItem(SESSIONS_KEY) ?? '[]') as PersistedSession[];
    expect(stored[0]?.device.cameraLabel).toBe('unnamed camera');
  });

  it('reports 0 fps and an unnamed camera before any block has run', async () => {
    // The ledger is reachable from screen 1, where `setup.measuredFps` is NaN
    // and no stream has been attached.
    h.exampleOutcome = { ok: false, added: 0, reason: 'not recorded', sessions: [] };
    await bootApp();
    (callback('prescribe', 'onExampleReport') as () => void)();
    await flush();
    const device = last('ledger').device as { medianFps: number; cameraLabel: string; resolution: string };
    expect(device.medianFps).toBe(0);
    expect(device.cameraLabel).toBe('unnamed camera');
    expect(device.resolution).toBe('640x480');
  });
});

// ===========================================================================
// Screen 5 — the report
// ===========================================================================

describe('main.ts — the report', () => {
  async function reachReport(): Promise<void> {
    await bootApp();
    await reachFirstBlock(2);
    runnerCallbacks().onFinish(blockResult());
    await flush();
    (callback('gate', 'onRuling') as (r: number, o: string | null) => void)(5, null);
    await flush();
  }

  it('builds the report model from the persisted session and stops the audio', async () => {
    await reachReport();
    expect(visibleScreen()).toBe('report');
    const model = last('report').model as {
      appVersion: string;
      isExample: boolean;
      symptom: { final: number; baseline: number };
      totals: { deliveredSeconds: number };
      blocks: unknown[];
    };
    expect(model.appVersion).toBe(EXPECTED_APP_VERSION);
    expect(model.isExample).toBe(false);
    expect(model.symptom.final).toBe(5);
    expect(model.symptom.baseline).toBe(2);
    expect(model.totals.deliveredSeconds).toBe(0.5);
    expect(model.blocks).toHaveLength(1);
    expect(audioEngine().stops).toBe(1);
  });

  it('prints and downloads the very session it is showing', async () => {
    await reachReport();
    (callback('report', 'onPrint') as () => void)();
    expect(printSpy).toHaveBeenCalledTimes(1);
    (callback('report', 'onDownload') as () => void)();
    expect(h.downloads).toHaveLength(1);
    expect((h.downloads[0] as PersistedSession).schema).toBe(SESSION_SCHEMA);
    expect((h.downloads[0] as PersistedSession).symptom.final).toBe(5);
  });

  it('reaches the ledger from the report and comes back to the same report', async () => {
    await reachReport();
    (callback('report', 'onLedger') as () => void)();
    expect(visibleScreen()).toBe('ledger');
    expect(last('ledger').hasReport).toBe(true);
    (callback('ledger', 'onBack') as () => void)();
    await flush();
    expect(visibleScreen()).toBe('report');
    expect(renders('report')).toHaveLength(2);
  });

  /**
   * NOT REACHABLE, and recorded here rather than faked.
   *
   * `openReport()` opens with `viewingSession ?? toPersisted()` and then guards
   * `if (!session) return`. Both the right-hand operand and that early return
   * need `viewingSession` to still be null at a call site, and neither call site
   * can supply that:
   *
   *   · the final gate's ruling is the only route in, and every route to a final
   *     gate runs through `finishBlock`, whose unconditional `persist()` assigns
   *     `viewingSession` before the gate is ever rendered — and `persist()` only
   *     skips that assignment when the card is null, in which case `finishBlock`
   *     returns before rendering a gate at all;
   *   · the ledger's `[ Back to report ]` is itself guarded by `&& viewingSession`.
   *
   * `viewingSession` is never reassigned to null anywhere in the module, so no
   * ordering of real interactions produces the state. Two branch legs and one
   * `return;` therefore stay uncovered, and no substitute in this file can reach
   * them without also removing the thing that makes them unreachable.
   */
  it('always has a session to show by the time the report can be opened', async () => {
    await bootApp();
    await reachFirstBlock(2);
    // Before the block finishes there is nothing to view…
    expect(renders('report')).toHaveLength(0);
    runnerCallbacks().onFinish(blockResult());
    await flush();
    // …and the gate that offers the report only exists after `persist()` ran.
    expect(last('gate').isFinal).toBe(true);
    (callback('gate', 'onRuling') as (r: number, o: string | null) => void)(6, null);
    await flush();
    expect(renders('report')).toHaveLength(1);
  });

  it('scores a zero prescription as a zero ratio rather than dividing by it', async () => {
    // Defensive arithmetic: `blockSeconds` is range-checked at 10 s minimum, so
    // a zero-length prescription is not constructible through the form.
    await bootApp();
    h.cardMode = 'zero-dose';
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
    (callback('setup', 'onStart') as () => void)();
    await flush();
    (callback('gate', 'onRuling') as (r: number, o: string | null) => void)(2, null);
    runnerCallbacks().onFinish(blockResult());
    await flush();
    const stored = JSON.parse(window.localStorage.getItem(SESSIONS_KEY) ?? '[]') as PersistedSession[];
    expect(stored[0]?.totals).toEqual({ prescribedSeconds: 0, deliveredSeconds: 0.5, ratio: 0 });
  });
});

// ===========================================================================
// The zero-typing route: the example report
// ===========================================================================

describe('main.ts — the example report', () => {
  const exampleSession = (id: string): PersistedSession =>
    ({
      schema: SESSION_SCHEMA,
      id,
      provenance: 'example',
      capturedBy: 'developer',
      startedAt: '2026-08-01T10:00:00.000Z',
      cardId: 'clinician-entered',
      cardHash: 'abc',
      card: {
        schemaVersion: 1,
        exercise: 'vorx1-yaw',
        stage: { label: 'seated', selfAttested: true },
        frequencyBand: { value: [1.7, 2.3], source: EXAMPLE_SOURCE },
        peakVelocityFloor: { value: 150, source: EXAMPLE_SOURCE },
        peakVelocityCeiling: { value: 350, source: EXAMPLE_SOURCE },
        blockSeconds: { value: 60, source: EXAMPLE_SOURCE },
        blockCount: { value: 1, source: EXAMPLE_SOURCE },
        symptomStopRule: {
          baselineRise: { value: 3, source: EXAMPLE_SOURCE },
          absoluteCeiling: { value: 7, source: EXAMPLE_SOURCE },
        },
        enteredBy: 'patient-from-clinician-handout',
      },
      device: {
        userAgent: 'dev machine',
        cameraLabel: 'dev camera',
        resolution: '1280x720',
        medianFps: 30,
        sigHash: 'devhash',
      },
      blocks: [
        {
          index: 0,
          prescribedSeconds: 60,
          deliveredSeconds: 41.2,
          cyclesAttempted: 120,
          cyclesCredited: 90,
          refusals: { 'too-slow': 20, 'too-fast': 4, 'off-cadence': 3, 'low-confidence': 2, 'face-lost': 1 },
          fHatHz: 2.05,
          fHatBinWidthHz: 0.117,
          gaze: { correct: 7, total: 10, chance: 0.25 },
          peakVelocitiesQ: '',
          peakVelocityScale: VELOCITY_SCALE,
          saturatedCycles: 0,
          interruptions: [],
        },
      ],
      symptom: { baseline: 2, gates: [], final: 3 },
      totals: { prescribedSeconds: 60, deliveredSeconds: 41.2, ratio: 0.687 },
      appVersion: 'gimbal 0.1.0',
      methodsRev: 'METHODS.md@unreleased',
      audioOff: false,
    }) as unknown as PersistedSession;

  it('opens the first example session as a report, labelled as an example', async () => {
    h.exampleOutcome = { ok: true, added: 2, sessions: [exampleSession('ex-1'), exampleSession('ex-2')] };
    await bootApp();
    (callback('prescribe', 'onExampleReport') as () => void)();
    await flush();
    expect(statusText()).toBe('Example ledger loaded. 2 developer-recorded sessions added, labelled example.');
    expect(visibleScreen()).toBe('report');
    const model = last('report').model as { isExample: boolean; totals: { deliveredSeconds: number } };
    expect(model.isExample).toBe(true);
    expect(model.totals.deliveredSeconds).toBe(41.2);
  });

  it('prints, downloads and reaches the ledger from an example report', async () => {
    h.exampleOutcome = { ok: true, added: 1, sessions: [exampleSession('ex-1')] };
    await bootApp();
    (callback('prescribe', 'onExampleReport') as () => void)();
    await flush();
    (callback('report', 'onPrint') as () => void)();
    expect(printSpy).toHaveBeenCalledTimes(1);
    (callback('report', 'onDownload') as () => void)();
    expect((h.downloads[0] as PersistedSession).id).toBe('ex-1');
    (callback('report', 'onLedger') as () => void)();
    expect(visibleScreen()).toBe('ledger');
    expect(last('ledger').hasReport).toBe(true);
  });

  it('shows the loader failure on screen as well as announcing it', async () => {
    h.exampleOutcome = { ok: false, added: 0, reason: 'the example ledger is not a list of sessions', sessions: [] };
    await bootApp();
    (callback('prescribe', 'onExampleReport') as () => void)();
    await flush();
    expect(statusText()).toBe('the example ledger is not a list of sessions');
    expect(last('ledger').notice).toBe('the example ledger is not a list of sessions');
    expect(last('ledger').hasReport).toBe(false);
    expect(visibleScreen()).toBe('ledger');
  });

  it('supplies its own sentence when a failure arrives with no reason', async () => {
    // The real loader always attaches a reason; this is main.ts's backstop.
    h.exampleOutcome = { ok: false, added: 0, sessions: [] };
    await bootApp();
    (callback('prescribe', 'onExampleReport') as () => void)();
    await flush();
    expect(last('ledger').notice).toBe('The example ledger could not be loaded.');
  });

  it('falls back to the ledger when a successful load carries no sessions', async () => {
    // The real loader reports `ok: false` for an empty list; this is the backstop.
    h.exampleOutcome = { ok: true, added: 0, sessions: [] };
    await bootApp();
    (callback('prescribe', 'onExampleReport') as () => void)();
    await flush();
    expect(visibleScreen()).toBe('ledger');
    expect(last('ledger').notice).toBeNull();
    expect(renders('report')).toHaveLength(0);
  });

  it('is reachable from the setup screen too, and returns there', async () => {
    h.exampleOutcome = { ok: false, added: 0, reason: 'not recorded', sessions: [] };
    await bootApp();
    (callback('prescribe', 'onContinue') as (d: CardDraft) => void)(attestedDraft());
    (callback('setup', 'onExampleReport') as () => void)();
    await flush();
    expect(visibleScreen()).toBe('ledger');
    (callback('ledger', 'onBack') as () => void)();
    expect(visibleScreen()).toBe('prescribe');
  });
});

// ===========================================================================
// Screen 6 — the ledger
// ===========================================================================

describe('main.ts — the ledger', () => {
  it('surfaces rows this build cannot read rather than dropping them', async () => {
    h.exampleOutcome = { ok: false, added: 0, reason: 'not recorded', sessions: [] };
    window.localStorage.setItem(
      SESSIONS_KEY,
      JSON.stringify([{ schema: 'gimbal.session/99', provenance: 'live' }]),
    );
    await bootApp();
    (callback('prescribe', 'onExampleReport') as () => void)();
    await flush();
    expect(last('ledger').unknownSchemaCount).toBe(1);
    expect(last('ledger').sessions).toEqual([]);
    expect(last('ledger').storageUnavailable).toBe(false);
  });

  it('reports storage that is simply not there', async () => {
    h.exampleOutcome = { ok: false, added: 0, reason: 'not recorded', sessions: [] };
    await bootApp();
    vi.stubGlobal('localStorage', undefined);
    (callback('prescribe', 'onExampleReport') as () => void)();
    await flush();
    expect(last('ledger').storageUnavailable).toBe(true);
  });

  it('loads the examples from the ledger itself', async () => {
    h.exampleOutcome = { ok: false, added: 0, reason: 'not recorded', sessions: [] };
    await bootApp();
    (callback('prescribe', 'onExampleReport') as () => void)();
    await flush();
    (callback('ledger', 'onLoadExamples') as () => void)();
    await flush();
    await flush();
    expect(renders('ledger').length).toBeGreaterThanOrEqual(2);
  });

  it('clears every key Gimbal wrote, including the theme, and says so', async () => {
    vi.useFakeTimers();
    h.exampleOutcome = { ok: false, added: 0, reason: 'not recorded', sessions: [] };
    window.localStorage.setItem(THEME_KEY, 'light');
    await bootApp();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    window.localStorage.setItem(SESSIONS_KEY, '[]');
    (callback('prescribe', 'onExampleReport') as () => void)();
    await flush();
    pastAnnounceFloor();
    (callback('ledger', 'onClearAll') as () => void)();

    expect(window.localStorage.getItem(THEME_KEY)).toBeNull();
    expect(window.localStorage.getItem(SESSIONS_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(statusText()).toBe(
      'All Gimbal data cleared from this browser. Your theme returns to the system setting.',
    );
    expect(last('ledger').theme).toBeNull();
  });
});

// ===========================================================================
// src/landing/main.ts
// ===========================================================================

describe('landing/main.ts', () => {
  async function bootLanding(): Promise<void> {
    document.documentElement.removeAttribute('data-theme');
    document.body.innerHTML = LANDING_BODY;
    await import('../src/landing/main.ts');
  }

  it('commits the landing page to dark when nothing is stored, without persisting it', async () => {
    await bootLanding();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull();
    const checked = document.querySelector<HTMLInputElement>('#theme-slot input:checked');
    expect(checked?.value).toBe('dark');
  });

  it('lets a stored preference override the page default', async () => {
    window.localStorage.setItem(THEME_KEY, 'light');
    await bootLanding();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.querySelector<HTMLInputElement>('#theme-slot input:checked')?.value).toBe('light');
  });

  it('renders the two diagrams and mounts the replay into its two slots', async () => {
    await bootLanding();
    expect((document.querySelector('#band-figure') as HTMLElement).innerHTML).toContain('<svg');
    expect((document.querySelector('#report-figure') as HTMLElement).innerHTML).toContain('lp-rp-page');
    const mounted = h.downloads[0] as { mountReplay: HTMLElement[] };
    expect(mounted.mountReplay[0]).toBe(document.querySelector('#replay-slot'));
    expect(mounted.mountReplay[1]).toBe(document.querySelector('#chapter-slot'));
  });

  it('persists a deliberate pick so it travels into /app', async () => {
    await bootLanding();
    const dim = document.querySelector<HTMLInputElement>('#theme-slot input[value="dim"]') as HTMLInputElement;
    dim.checked = true;
    dim.dispatchEvent(new Event('change'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dim');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dim');
  });

  it('ignores a change event from a radio that is not the checked one', async () => {
    await bootLanding();
    const light = document.querySelector<HTMLInputElement>('#theme-slot input[value="light"]') as HTMLInputElement;
    light.checked = false;
    light.dispatchEvent(new Event('change'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull();
  });
});
