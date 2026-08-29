// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountReplay } from '../src/landing/replay.ts';
import {
  TRACE,
  CREDITED_COUNT,
  OUTCOME_STOPS,
  ILLUSTRATION_CARD,
  REPLAY_MS_PER_CYCLE,
  deliveredAfter,
  peakLabel,
  chapterFor,
  type TraceCycle,
} from '../src/landing/trace.ts';
import { createDial, arcAngleDeg, markerRotationDeg } from '../src/ui/dial.ts';
import { scoreCycle } from '../src/dsp/score.ts';
import { refusalSentence, REASON_LABELS } from '../src/ui/copy.ts';
import { INSTRUMENT_LIMITS } from '../src/dsp/limits.ts';

/**
 * The hero replay is the first thing on `/` and the only moving thing on it, in
 * a product for people whose presenting symptom is visually-induced dizziness.
 * These tests exist to hold four properties that are easy to lose in a redraw:
 *
 *   1. THE PANEL IS THE INSTRUMENT'S OWN PARTS. The ring markup is `createDial`
 *      byte for byte, the marker angle is `markerRotationDeg`, the plate ticks
 *      are `arcAngleDeg`, the verdicts are `scoreCycle` and the sentences are
 *      `refusalSentence` — so `/` cannot drift away from `/app`.
 *   2. MOTION IS PAUSED BY DEFAULT under `prefers-reduced-motion`, and the
 *      paused frame is already the refusal the page argues about.
 *   3. EVERYONE ELSE CAN PAUSE IT, from a control that is present on first paint.
 *   4. NOTHING FLASHES, and nothing is triggered by scrolling: every entry into
 *      the resting state produces the identical frame, and the only viewport
 *      wiring is an IntersectionObserver that stops motion rather than starting
 *      it behind the reader's back.
 */

/* ── The doubles. All of them live here; `src/` has none. ─────────────────── */

interface FakeEntry {
  isIntersecting: boolean;
}
interface FakeObserver {
  callback: (entries: FakeEntry[]) => void;
  targets: Element[];
  options: { threshold?: number } | undefined;
}

let observers: FakeObserver[] = [];
let frames: { id: number; cb: (now: number) => void }[] = [];
let lastFrameCb: ((now: number) => void) | null = null;
let cancelledFrames: number[] = [];
let nextFrameId = 1;
let prefersReduced = false;
let documentHidden = false;
let clockMs = 5_000;

/** Runs the one scheduled animation frame. The replay never queues two. */
function pump(now: number): void {
  const next = frames.shift();
  if (!next) throw new Error('no animation frame was scheduled');
  clockMs = now;
  next.cb(now);
}

/** Calls the frame callback the replay last scheduled, even if it was cancelled. */
function pumpDetached(now: number): void {
  if (!lastFrameCb) throw new Error('no animation frame callback was ever scheduled');
  clockMs = now;
  lastFrameCb(now);
}

let host: HTMLElement;
let chapterHost: HTMLElement;

function sel<T extends Element>(selector: string): T {
  const found = host.querySelector<T>(selector);
  if (!found) throw new Error(`missing element: ${selector}`);
  return found;
}

const cells = (): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>('.lp-strip li'));
const states = (): string[] => cells().map((c) => c.dataset.state ?? '');
const outcomeButtons = (): HTMLButtonElement[] =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.lp-outcome-btn'));
const playBtn = (): HTMLButtonElement => sel<HTMLButtonElement>('#rp-play');
const stepBtn = (): HTMLButtonElement => sel<HTMLButtonElement>('#rp-step');
const restartBtn = (): HTMLButtonElement => sel<HTMLButtonElement>('#rp-reset');
const statusText = (): string => sel<HTMLElement>('#rp-status').textContent ?? '';
const doseText = (): string => sel<HTMLElement>('#rp-dose').textContent ?? '';
const liveArc = (): SVGCircleElement => sel<SVGCircleElement>('.ring-live');
const marker = (): SVGLineElement => sel<SVGLineElement>('.ring-marker');
const liveLength = (): number => Number((liveArc().getAttribute('stroke-dasharray') ?? '0 0').split(' ')[0]);

/** Every visible fact the panel carries, for frame-to-frame comparison. */
function snapshot(): string {
  return JSON.stringify({
    strip: states(),
    dose: doseText(),
    credited: sel<HTMLElement>('#rp-credited').textContent,
    status: statusText(),
    refused: sel<HTMLElement>('#rp-status').dataset.refused,
    quality: sel<HTMLElement>('#rp-q').textContent,
    marker: marker().getAttribute('transform'),
    markerStroke: marker().getAttribute('stroke'),
    markerOpacity: marker().getAttribute('opacity'),
    deficit: sel<HTMLElement>('#rp-deficit').textContent,
    gap: sel<SVGPathElement>('#rp-gap').getAttribute('opacity'),
    chapter: chapterHost.textContent,
  });
}

function mount(reduced = false): void {
  prefersReduced = reduced;
  mountReplay(host, chapterHost);
}

beforeEach(() => {
  vi.useFakeTimers();
  observers = [];
  frames = [];
  cancelledFrames = [];
  lastFrameCb = null;
  nextFrameId = 1;
  prefersReduced = false;
  documentHidden = false;
  clockMs = 5_000;

  document.body.innerHTML = '<div id="slot"></div><div id="chapter"></div>';
  host = document.getElementById('slot') as HTMLElement;
  chapterHost = document.getElementById('chapter') as HTMLElement;

  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void): number => {
    const id = nextFrameId++;
    frames.push({ id, cb });
    lastFrameCb = cb;
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    cancelledFrames.push(id);
    frames = frames.filter((f) => f.id !== id);
  });
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: query.includes('prefers-reduced-motion') ? prefersReduced : false,
    onchange: null,
    addEventListener: (): void => undefined,
    removeEventListener: (): void => undefined,
    addListener: (): void => undefined,
    removeListener: (): void => undefined,
    dispatchEvent: (): boolean => false,
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      readonly targets: Element[] = [];
      constructor(
        callback: (entries: FakeEntry[]) => void,
        options?: { threshold?: number },
      ) {
        observers.push({ callback, targets: this.targets, options });
      }
      observe(target: Element): void {
        this.targets.push(target);
      }
      unobserve(): void {
        /* the replay never calls this */
      }
      disconnect(): void {
        /* the replay never calls this */
      }
    },
  );
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => documentHidden });
  vi.spyOn(performance, 'now').mockImplementation(() => clockMs);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock('../src/landing/trace.ts');
  vi.resetModules();
  document.body.innerHTML = '';
});

/** The trace indices this suite refers to by name, found rather than written. */
const idx = (reason: string): number => TRACE.findIndex((c) => c.reason === reason);
const cycleAt = (i: number): TraceCycle => TRACE[i] as TraceCycle;

/* ── 1. Built from the instrument's own parts ─────────────────────────────── */

describe('the hero replay is drawn with the instrument, not redrawn beside it', () => {
  it('renders the REAL dial markup at the real card geometry', () => {
    mount();
    const reference = document.createElement('div');
    reference.innerHTML = createDial(ILLUSTRATION_CARD).html;

    // The track is the one part of the ring `Dial` never writes to at runtime,
    // so it can be compared byte for byte: if the panel ever drew its own ring,
    // this is where the copy would show.
    expect(sel<SVGCircleElement>('.ring-track').outerHTML).toBe(
      (reference.querySelector('.ring-track') as SVGCircleElement).outerHTML,
    );
    // The prescribed band's dasharray is geometry too, and also comes from there.
    const refBand = reference.querySelector('.ring-band') as SVGCircleElement;
    expect(sel<SVGCircleElement>('.ring-band').getAttribute('stroke-dasharray')).toBe(
      refBand.getAttribute('stroke-dasharray'),
    );
    const refSvg = reference.querySelector('svg.ring') as SVGSVGElement;
    expect(sel<SVGSVGElement>('svg.ring').getAttribute('viewBox')).toBe(refSvg.getAttribute('viewBox'));
    expect(sel<SVGSVGElement>('svg.ring').getAttribute('aria-hidden')).toBe('true');
    // And the ring the panel binds to is that same element, not a copy beside it.
    expect(host.querySelectorAll('svg.ring').length).toBe(1);
    // The dial's own maximum labels the scale, rather than a number typed here.
    expect(sel<HTMLElement>('.lp-dial-end-max').textContent).toBe(String(createDial(ILLUSTRATION_CARD).max));
  });

  it('positions the committed marker with dial.ts own markerRotationDeg', () => {
    mount(true);
    const first = cycleAt(0);
    const max = createDial(ILLUSTRATION_CARD).max;
    const expected = markerRotationDeg(first.peakOmega / max).toFixed(2);
    expect(marker().getAttribute('transform')).toBe(`rotate(${expected} 50 50)`);
    // A refused cycle: slate marker, and the band arc NOT promoted to --zone-in.
    expect(first.credited).toBe(false);
    expect(marker().getAttribute('stroke')).toBe('var(--refused)');
    expect(sel<SVGCircleElement>('.ring-band').getAttribute('stroke')).toBe('var(--edge-strong)');
  });

  it('lays the scale plate out with arcAngleDeg, the same function the arc uses', () => {
    mount();
    const ringMax = ILLUSTRATION_CARD.peakVelocityFloor.value + ILLUSTRATION_CARD.peakVelocityCeiling.value;
    const lines = Array.from(host.querySelectorAll<SVGLineElement>('.lp-dial-plate line'));
    // One tick every 50 °/s across the whole sweep, endpoints included.
    expect(lines.length).toBe(ringMax / 50 + 1);

    const point = (fraction: number, radius: number): [string, string] => {
      const radians = (arcAngleDeg(fraction) * Math.PI) / 180;
      return [(50 + radius * Math.cos(radians)).toFixed(2), (50 + radius * Math.sin(radians)).toFixed(2)];
    };
    // The floor tick is a MAJOR one, and it sits exactly where arcAngleDeg puts it.
    const floorTick = lines[ILLUSTRATION_CARD.peakVelocityFloor.value / 50] as SVGLineElement;
    const [x1, y1] = point(ILLUSTRATION_CARD.peakVelocityFloor.value / ringMax, 46);
    expect(floorTick.getAttribute('x1')).toBe(x1);
    expect(floorTick.getAttribute('y1')).toBe(y1);
    expect(floorTick.getAttribute('stroke')).toBe('var(--lp-line-2)');
    // A minor tick starts further in and is drawn in the quieter token.
    const minor = lines[1] as SVGLineElement;
    expect(minor.getAttribute('x1')).toBe(point(50 / ringMax, 47.2)[0]);
    expect(minor.getAttribute('stroke')).toBe('var(--lp-track)');
  });

  it('prints the sentence refusalSentence returns for the verdict scoreCycle returns', () => {
    mount(true);
    const first = cycleAt(0);
    const scored = scoreCycle(first.scored, ILLUSTRATION_CARD, INSTRUMENT_LIMITS);
    // Re-derived here from the shipped scorer and the shipped copy: the panel is
    // printing /app's words about /app's verdict, not a landing-page paraphrase.
    expect(scored.reason).toBe(first.reason);
    expect(scored.credited).toBe(false);
    expect(statusText()).toBe(refusalSentence(scored.reason, first.scored, ILLUSTRATION_CARD));
    expect(statusText()).toContain('too slow');
    expect(sel<HTMLElement>('#rp-status').dataset.refused).toBe('true');
  });

  it('names outcomes and strip cells with REASON_LABELS from the app copy module', () => {
    mount(true);
    const labels = outcomeButtons().map((b) => b.textContent);
    expect(labels).toEqual(OUTCOME_STOPS.map((s) => REASON_LABELS[s.reason]));
    expect(outcomeButtons().map((b) => b.dataset.jump)).toEqual(OUTCOME_STOPS.map((s) => String(s.index)));
    const cell = cells()[0] as HTMLElement;
    expect(cell.title).toBe(`Rep 1 · ${peakLabel(cycleAt(0).peakOmega)} °/s · ${REASON_LABELS[cycleAt(0).reason]}`);
  });

  it('takes its totals from the trace helpers rather than counting by hand', () => {
    mount();
    expect(host.querySelector('.lp-transcript')?.children.length).toBe(TRACE.length);
    const text = host.textContent ?? '';
    expect(text).toContain(`${CREDITED_COUNT} of ${TRACE.length} reps credited`);
    expect(text).toContain(`${deliveredAfter(TRACE.length).toFixed(1)} seconds`);
    expect(text).toContain(`The ${TRACE.length - CREDITED_COUNT} refused reps contribute exactly zero`);
    expect(text).toContain(`floor ${INSTRUMENT_LIMITS.qFloor}`);
    expect(Number.parseFloat(sel<HTMLElement>('.lp-quality-floor').style.left)).toBeCloseTo(
      INSTRUMENT_LIMITS.qFloor * 100,
      6,
    );
  });
});

/* ── 2. Reduced motion: paused, and already showing the argument ──────────── */

describe('under prefers-reduced-motion the replay is paused and already seeded', () => {
  it('starts paused, with no frame ever requested', () => {
    mount(true);
    expect(frames.length).toBe(0);
    expect(playBtn().getAttribute('aria-pressed')).toBe('false');
    expect(playBtn().textContent).toBe('Play the illustration');
    expect(host.textContent).toContain('Motion is off because your system asks for reduced motion.');
  });

  it('holds the refusal it depicts on the very first frame — not an empty ring', () => {
    mount(true);
    const first = cycleAt(0);
    expect(first.credited).toBe(false);
    expect(states()[0]).toBe('refused');
    expect(states().slice(1)).toEqual(new Array(TRACE.length - 1).fill('pending'));
    expect(statusText()).toBe(first.sentence);
    expect(statusText()).not.toBe('Waiting for the first full cycle.');
    expect(doseText()).toBe('0.0');
    expect(sel<HTMLElement>('#rp-credited').textContent).toBe('0');
    expect(marker().getAttribute('opacity')).toBe('1');
    // The narration under the panel names the verdict that is on the dial.
    expect(chapterHost.textContent).toContain(chapterFor(0).title);
  });

  it('re-issues the seeding frame once, so the throttled first write cannot lose the arc', () => {
    // `Dial` starts its 10 Hz throttle stamp at 0, so a mount inside the first
    // 100 ms of a document discards its own first setLive. Under reduced motion
    // there is no next frame to save it — the arc would simply be missing.
    clockMs = 50;
    mount(true);
    expect(liveLength()).toBe(0);

    clockMs = 250;
    vi.advanceTimersByTime(150);
    expect(liveLength()).toBeGreaterThan(0);
    // And it is the committed peak, not some point of a sweep.
    const expected = (cycleAt(0).peakOmega / createDial(ILLUSTRATION_CARD).max) * 2 * Math.PI * 42 * 0.75;
    expect(liveLength()).toBeCloseTo(expected, 3);
  });

  it('does not re-issue over a frame the reader has already stepped past', () => {
    clockMs = 50;
    mount(true);
    clockMs = 120;
    stepBtn().click();
    const after = liveArc().getAttribute('stroke-dasharray');
    clockMs = 400;
    vi.advanceTimersByTime(150);
    expect(liveArc().getAttribute('stroke-dasharray')).toBe(after);
    expect(states()[1]).toBe(cycleAt(1).credited ? 'credited' : 'refused');
  });

  it('lands the first write immediately when the throttle window has already passed', () => {
    clockMs = 9_000;
    mount(true);
    expect(liveLength()).toBeGreaterThan(0);
  });
});

/* ── 3. Everyone else gets a pause control, in the first row ──────────────── */

describe('the pause control', () => {
  it('autoplays for everyone else, and the pause button is inside the panel head', () => {
    mount();
    expect(frames.length).toBe(1);
    expect(playBtn().getAttribute('aria-pressed')).toBe('true');
    expect(playBtn().textContent).toBe('Pause the illustration');
    expect(playBtn().closest('.lp-replay-head')).not.toBeNull();
    expect(host.textContent).not.toContain('Motion is off because your system');
  });

  it('stops the frame loop on click and holds the last committed peak', () => {
    mount();
    pump(1_000);
    // Half way through the cycle |ω| is back at zero — the instant a click is
    // most likely to land on, and the one a frozen arc would strand the reader at.
    pump(1_000 + REPLAY_MS_PER_CYCLE / 2);
    const midSweep = liveLength();
    expect(midSweep).toBeCloseTo(0, 6);
    clockMs = 9_000;
    playBtn().click();

    expect(playBtn().getAttribute('aria-pressed')).toBe('false');
    expect(frames.length).toBe(0);
    expect(cancelledFrames.length).toBeGreaterThan(0);
    const held = (cycleAt(0).peakOmega / createDial(ILLUSTRATION_CARD).max) * 2 * Math.PI * 42 * 0.75;
    expect(liveLength()).toBeCloseTo(held, 3);
    expect(liveLength()).not.toBeCloseTo(midSweep, 3);
  });

  it('ignores a frame that fires after the pause', () => {
    mount();
    pump(1_000);
    playBtn().click();
    const before = snapshot();
    pumpDetached(1_000 + REPLAY_MS_PER_CYCLE * 4);
    expect(snapshot()).toBe(before);
    expect(frames.length).toBe(0);
  });

  it('resumes on a second click', () => {
    mount();
    playBtn().click();
    playBtn().click();
    expect(playBtn().getAttribute('aria-pressed')).toBe('true');
    expect(frames.length).toBe(1);
  });
});

/* ── 4. The frame loop itself ─────────────────────────────────────────────── */

describe('the frame loop', () => {
  it('sweeps the live arc without committing until the cycle completes', () => {
    mount();
    const start = 2_000;
    pump(start);
    expect(liveLength()).toBe(0); // |sin 0| = 0
    expect(states()[1]).toBe('pending');

    pump(start + REPLAY_MS_PER_CYCLE / 4);
    const peakOfCycleTwo = cycleAt(1).peakOmega;
    const expected = (peakOfCycleTwo / createDial(ILLUSTRATION_CARD).max) * 2 * Math.PI * 42 * 0.75;
    expect(liveLength()).toBeCloseTo(expected, 3);
    expect(states()[1]).toBe('pending');

    pump(start + REPLAY_MS_PER_CYCLE);
    expect(states()[1]).toBe(cycleAt(1).credited ? 'credited' : 'refused');
    expect(doseText()).toBe(deliveredAfter(2).toFixed(1));
  });

  it('paints the arc green only while the sweep is inside the band AND trusted', () => {
    mount();
    // Walk to the credited cycle: the arc goes --zone-in at its peak.
    const okAt = idx('ok');
    for (let i = 1; i < okAt; i++) stepBtn().click();
    playBtn().click(); // step paused it; play again
    pump(10_000);
    pump(10_000 + REPLAY_MS_PER_CYCLE / 4);
    expect(cycleAt(okAt).credited).toBe(true);
    expect(liveArc().getAttribute('stroke')).toBe('var(--zone-in)');
  });

  it('keeps the arc amber above the ceiling and below the confidence floor', () => {
    mount();
    const fastAt = idx('too-fast');
    for (let i = 1; i < fastAt; i++) stepBtn().click();
    playBtn().click();
    pump(20_000); // start of the cycle
    pump(20_000 + REPLAY_MS_PER_CYCLE / 4); // its peak: |sin(π/2)| = 1
    expect(cycleAt(fastAt).peakOmega).toBeGreaterThan(ILLUSTRATION_CARD.peakVelocityCeiling.value);
    const overCeiling =
      (cycleAt(fastAt).peakOmega / createDial(ILLUSTRATION_CARD).max) * 2 * Math.PI * 42 * 0.75;
    expect(liveLength()).toBeCloseTo(overCeiling, 3); // the sweep really is past the ceiling
    expect(liveArc().getAttribute('stroke')).toBe('var(--zone-out)');

    // The doubted cycle: velocity squarely in the band, confidence below floor,
    // and the arc still refuses to go green. That is the whole argument.
    const doubtAt = idx('low-confidence');
    playBtn().click();
    for (let i = fastAt; i < doubtAt; i++) stepBtn().click();
    playBtn().click();
    pump(30_000);
    pump(30_000 + REPLAY_MS_PER_CYCLE / 4);
    const doubted = cycleAt(doubtAt);
    expect(doubted.peakOmega).toBeGreaterThan(ILLUSTRATION_CARD.peakVelocityFloor.value);
    expect(doubted.peakOmega).toBeLessThan(ILLUSTRATION_CARD.peakVelocityCeiling.value);
    expect(doubted.qMin).toBeLessThan(INSTRUMENT_LIMITS.qFloor);
    const inTheBand = (doubted.peakOmega / createDial(ILLUSTRATION_CARD).max) * 2 * Math.PI * 42 * 0.75;
    expect(liveLength()).toBeCloseTo(inTheBand, 3); // velocity is not the problem
    expect(liveArc().getAttribute('stroke')).toBe('var(--zone-out)');
  });

  it('loops back to the SAME resting frame at the end of the trace', () => {
    mount(true);
    const resting = snapshot();
    for (let i = 1; i < TRACE.length; i++) stepBtn().click();
    expect(states().every((s) => s !== 'pending')).toBe(true);

    playBtn().click(); // start playing from a finished trace
    pump(40_000); // no cycle left: holds
    expect(states().every((s) => s !== 'pending')).toBe(true);
    pump(40_000 + REPLAY_MS_PER_CYCLE * 2 + 1); // ... then starts over
    expect(snapshot()).toBe(resting);
    expect(frames.length).toBe(1);
  });
});

/* ── 5. Step, Restart and the six-outcome selector ────────────────────────── */

describe('the step, restart and outcome controls', () => {
  it('steps one cycle at a time and pauses a running replay first', () => {
    mount();
    expect(playBtn().getAttribute('aria-pressed')).toBe('true');
    stepBtn().click();
    expect(playBtn().getAttribute('aria-pressed')).toBe('false');
    expect(states()[1]).not.toBe('pending');
    expect(doseText()).toBe(deliveredAfter(2).toFixed(1));
    stepBtn().click();
    expect(states()[2]).not.toBe('pending');
    expect(doseText()).toBe(deliveredAfter(3).toFixed(1));
    // The hero's own sentence: the dose numeral has not moved for three cycles.
    expect(doseText()).toBe('0.0');
  });

  it('wraps around when stepped past the end of the trace', () => {
    mount(true);
    for (let i = 1; i < TRACE.length; i++) stepBtn().click();
    expect(states().includes('pending')).toBe(false);

    stepBtn().click();
    // The strip is emptied back to the seeded refusal and the walk continues
    // from there — the ledger never carries cells from two runs at once.
    expect(states().slice(2)).toEqual(new Array(TRACE.length - 2).fill('pending'));
    expect(states()[0]).toBe('refused');
    expect(doseText()).toBe(deliveredAfter(2).toFixed(1));
    expect(statusText()).toBe(cycleAt(1).sentence);
  });

  it('restarts to that same frame, playing or paused', () => {
    mount(true);
    const resting = snapshot();
    stepBtn().click();
    stepBtn().click();
    restartBtn().click();
    expect(snapshot()).toBe(resting);

    mount(); // a fresh, playing instance
    const playingRest = snapshot();
    pump(50_000);
    pump(50_000 + REPLAY_MS_PER_CYCLE);
    expect(states()[1]).not.toBe('pending');
    restartBtn().click();
    expect(snapshot()).toBe(playingRest);
    expect(playBtn().getAttribute('aria-pressed')).toBe('true');
  });

  it('REPLAYS to a chosen outcome rather than teleporting to it', () => {
    mount();
    const lostAt = idx('face-lost');
    const button = outcomeButtons().find((b) => b.dataset.outcome === 'face-lost') as HTMLButtonElement;
    button.click();

    expect(playBtn().getAttribute('aria-pressed')).toBe('false'); // it pauses first
    // Every preceding cycle is committed, so the strip carries the real run.
    expect(states().slice(0, lostAt + 1).some((s) => s === 'pending')).toBe(false);
    expect(states()[lostAt]).toBe('refused');
    expect(states()[lostAt + 1]).toBe('pending');
    expect(doseText()).toBe(deliveredAfter(lostAt + 1).toFixed(1));
    expect(Number(doseText())).toBeGreaterThan(0);
    expect(statusText()).toBe(cycleAt(lostAt).sentence);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(outcomeButtons().filter((b) => b.getAttribute('aria-pressed') === 'true').length).toBe(1);
  });

  it('reports the verdict on the dial even when the replay arrived there by itself', () => {
    mount(true);
    const pressed = (): string[] =>
      outcomeButtons()
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.dataset.outcome ?? '');
    expect(pressed()).toEqual(['too-slow']);
    for (let i = 1; i <= idx('too-fast'); i++) stepBtn().click();
    expect(pressed()).toEqual(['too-fast']);
  });

  it('ignores a jump target outside the trace', () => {
    mount(true);
    const button = outcomeButtons()[0] as HTMLButtonElement;
    const before = snapshot();
    button.dataset.jump = '-1';
    button.click();
    expect(snapshot()).toBe(before);
    button.dataset.jump = String(TRACE.length);
    button.click();
    expect(snapshot()).toBe(before);
  });
});

/* ── 6. The gap annotation ────────────────────────────────────────────────── */

describe('the gap between where the rep landed and the band', () => {
  it('draws and names the shortfall below the floor', () => {
    mount(true);
    const slow = cycleAt(idx('too-slow'));
    const floor = ILLUSTRATION_CARD.peakVelocityFloor.value;
    expect(sel<SVGPathElement>('#rp-gap').getAttribute('opacity')).toBe('1');
    expect(sel<SVGPathElement>('#rp-gap').getAttribute('d')).toMatch(/^M [\d.]+ [\d.]+ L /);
    expect(sel<HTMLElement>('#rp-deficit').textContent).toBe(
      `${peakLabel(floor - slow.peakOmega)} °/s short of the ${floor} °/s floor`,
    );
    // Rounded through the same helper the sentence uses — never a raw subtraction.
    expect(sel<HTMLElement>('#rp-deficit').textContent).not.toContain('.');
  });

  it('names the overshoot past the ceiling', () => {
    mount(true);
    const fastAt = idx('too-fast');
    for (let i = 1; i <= fastAt; i++) stepBtn().click();
    const ceiling = ILLUSTRATION_CARD.peakVelocityCeiling.value;
    expect(sel<HTMLElement>('#rp-deficit').textContent).toBe(
      `${peakLabel(cycleAt(fastAt).peakOmega - ceiling)} °/s past the ${ceiling} °/s ceiling`,
    );
  });

  it('draws NO gap for a refusal that is not a velocity gap', () => {
    mount(true);
    const doubtAt = idx('low-confidence');
    for (let i = 1; i <= doubtAt; i++) stepBtn().click();
    expect(statusText()).toBe(cycleAt(doubtAt).sentence);
    // Refused, in the band, and the panel invents no shortfall.
    expect(sel<SVGPathElement>('#rp-gap').getAttribute('opacity')).toBe('0');
    expect(sel<HTMLElement>('#rp-deficit').textContent).toBe('');
  });

  it('tracks the quality meter and flags it below the floor', () => {
    mount(true);
    expect(sel<HTMLElement>('#rp-q').textContent).toBe(cycleAt(0).qMin.toFixed(2));
    expect(sel<HTMLElement>('#rp-qfill').dataset.below).toBe('false');
    const doubtAt = idx('low-confidence');
    for (let i = 1; i <= doubtAt; i++) stepBtn().click();
    expect(sel<HTMLElement>('#rp-qfill').dataset.below).toBe('true');
    expect(sel<HTMLElement>('#rp-qfill').style.width).toBe(`${(cycleAt(doubtAt).qMin * 100).toFixed(1)}%`);
  });
});

/* ── 7. Viewport and tab wiring: it stops motion, it never starts it ──────── */

describe('the replay stops itself off screen, and does not sneak back', () => {
  it('registers no scroll-driven motion of any kind', () => {
    // Every listener the component adds, on any target: window, document, the
    // panel or its buttons. A scroll-driven animation on this page would be a
    // symptom trigger the reader never asked for.
    const registrations: { target: EventTarget; type: string }[] = [];
    const original = EventTarget.prototype.addEventListener;
    vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): void {
      registrations.push({ target: this, type });
      original.call(this, type, listener, options);
    });

    mount();

    const types = registrations.map((r) => r.type);
    for (const motionTrigger of ['scroll', 'wheel', 'touchmove', 'resize', 'mousemove']) {
      expect(types, `${motionTrigger} listener registered`).not.toContain(motionTrigger);
    }
    expect(types.filter((t) => t === 'click').length).toBe(3 + OUTCOME_STOPS.length);
    expect(registrations.filter((r) => r.target === document).map((r) => r.type)).toEqual(['visibilitychange']);
    expect(registrations.filter((r) => r.target === window).length).toBe(0);
    // The only viewport wiring is one observer, on the panel itself.
    expect(observers.length).toBe(1);
    expect((observers[0] as FakeObserver).targets).toEqual([host]);
    expect((observers[0] as FakeObserver).options).toEqual({ threshold: 0.2 });
  });

  it('pauses when it leaves the viewport and resumes when it comes back', () => {
    mount();
    const observer = observers[0] as FakeObserver;
    observer.callback([{ isIntersecting: false }]);
    expect(playBtn().getAttribute('aria-pressed')).toBe('false');
    observer.callback([{ isIntersecting: false }]); // already paused: nothing to do
    expect(playBtn().getAttribute('aria-pressed')).toBe('false');
    observer.callback([{ isIntersecting: true }, { isIntersecting: false }]);
    expect(playBtn().getAttribute('aria-pressed')).toBe('true');
    observer.callback([{ isIntersecting: true }]); // already playing: nothing to do
    expect(playBtn().getAttribute('aria-pressed')).toBe('true');
    expect(frames.length).toBe(1);
  });

  it('never restarts a replay the READER stopped', () => {
    mount();
    playBtn().click();
    const observer = observers[0] as FakeObserver;
    observer.callback([{ isIntersecting: false }]);
    observer.callback([{ isIntersecting: true }]);
    expect(playBtn().getAttribute('aria-pressed')).toBe('false');
    expect(frames.length).toBe(0);
  });

  it('never restarts one the reader stopped with Step, either', () => {
    mount();
    stepBtn().click();
    const observer = observers[0] as FakeObserver;
    observer.callback([{ isIntersecting: true }]);
    expect(playBtn().getAttribute('aria-pressed')).toBe('false');
  });

  it('stops when the tab is hidden and stays stopped when it returns', () => {
    mount();
    documentHidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(playBtn().getAttribute('aria-pressed')).toBe('false');
    documentHidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(playBtn().getAttribute('aria-pressed')).toBe('false');
    // And a hidden event on an already-paused replay changes nothing.
    documentHidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(playBtn().getAttribute('aria-pressed')).toBe('false');
  });
});

/* ── 8. Structure the page depends on, and the defensive paths ────────────── */

describe('the panel structure', () => {
  it('carries the illustration label at body size, permanently', () => {
    mount();
    const head = sel<HTMLElement>('.lp-replay-head-text');
    expect(head.querySelector('.chip')?.textContent).toBe('Illustration');
    expect(head.textContent).toContain('Not a measurement');
    expect(head.textContent).toContain('scoreCycle()');
    // Not a tooltip, not a footnote: it is in the flow of the panel's first row.
    expect(head.closest('.lp-replay-head')).not.toBeNull();
  });

  it('hides the moving panel from assistive tech behind one label, and ships a transcript', () => {
    mount();
    const stage = sel<HTMLElement>('.lp-replay-stage');
    expect(stage.getAttribute('role')).toBe('img');
    expect(stage.getAttribute('aria-label')).toContain('text equivalent is below');
    const rows = Array.from(host.querySelectorAll('.lp-transcript li')).map((r) => r.textContent ?? '');
    expect(rows.length).toBe(TRACE.length);
    for (const c of TRACE) {
      const row = rows[c.index] as string;
      expect(row).toContain(`Rep ${c.index + 1}`);
      expect(row).toContain(`${peakLabel(c.peakOmega)} °/s`);
      expect(row).toContain(c.credited ? `credited · +${c.doseSeconds.toFixed(1)} s` : `refused · ${c.sentence}`);
    }
  });

  it('bails out cleanly when the host cannot hold the dial', () => {
    // A `<script>` host parses the template as text, so `bindDial` finds nothing.
    // The component must return rather than throw at the reader.
    const scriptHost = document.createElement('script');
    document.body.append(scriptHost);
    expect(() => mountReplay(scriptHost, chapterHost)).not.toThrow();
    expect(scriptHost.querySelector('svg.ring')).toBeNull();
    expect(frames.length).toBe(0);
    expect(observers.length).toBe(0);
    // The chapter card was written before the bail-out, and is still coherent.
    expect(chapterHost.textContent).toContain(chapterFor(0).title);
  });
});

/* ── 9. Degenerate traces: the defensive branches, exercised honestly ─────── */

/**
 * These mount the component against a SUBSTITUTED trace so the guards in
 * `replay.ts` are executed rather than asserted about. The doubles live here;
 * `src/landing/trace.ts` is untouched and every other test in this file runs
 * against the real ten cycles.
 */
async function mountWithTrace(trace: unknown, reduced = false): Promise<void> {
  vi.resetModules();
  vi.doMock('../src/landing/trace.ts', async () => {
    const actual = await vi.importActual<typeof import('../src/landing/trace.ts')>('../src/landing/trace.ts');
    return { ...actual, TRACE: trace };
  });
  const module = await import('../src/landing/replay.ts');
  prefersReduced = reduced;
  module.mountReplay(host, chapterHost);
}

describe('a trace the component was not written for', () => {
  it('renders an empty panel instead of throwing when the trace is empty', async () => {
    await mountWithTrace([], true);
    expect(cells().length).toBe(0);
    expect(statusText()).toBe('Waiting for the first full cycle.');
    expect(sel<HTMLElement>('#rp-q').textContent).toBe('0.90');
    expect(doseText()).toBe('0.0');
    expect(marker().getAttribute('opacity')).toBe('0');
    expect(playBtn().getAttribute('aria-pressed')).toBe('false');
    // No seeding re-issue fires, and no timer is left behind.
    vi.advanceTimersByTime(500);
    expect(marker().getAttribute('opacity')).toBe('0');
    // The narration falls back to the first chapter rather than to undefined.
    expect(chapterHost.textContent).toContain(chapterFor(0).title);
  });

  it('holds a one-cycle trace when stepped past its end', async () => {
    await mountWithTrace([cycleAt(idx('too-slow'))], true);
    expect(cells().length).toBe(1);
    const resting = snapshot();
    stepBtn().click();
    expect(snapshot()).toBe(resting);
  });

  it('commits a cycle that has no strip cell without touching the strip', async () => {
    // A trace whose `map` yields fewer cells than it has cycles — the exact
    // shape the `if (cell)` guard exists for.
    const two = [cycleAt(0), cycleAt(idx('ok'))] as TraceCycle[];
    const short = Object.assign(two.slice(), {
      map: <U,>(fn: (c: TraceCycle, i: number, a: readonly TraceCycle[]) => U): U[] => [
        fn(two[0] as TraceCycle, 0, two),
      ],
    });
    await mountWithTrace(short, true);
    expect(cells().length).toBe(1);
    stepBtn().click();
    expect(cells().length).toBe(1);
    expect(statusText()).toBe('In the band. Nothing to report.');
    expect(sel<HTMLElement>('#rp-credited').textContent).toBe('1');
  });

  it('jumps to an index the trace has no cycle for without moving the arc', async () => {
    const holed = [cycleAt(0)] as TraceCycle[];
    holed.length = 2; // index 1 exists for `length`, holds nothing
    await mountWithTrace(holed, true);
    const before = liveArc().getAttribute('stroke-dasharray');
    const button = outcomeButtons()[0] as HTMLButtonElement;
    button.dataset.jump = '1';
    clockMs = 60_000;
    button.click();
    expect(liveArc().getAttribute('stroke-dasharray')).toBe(before);
    expect(states()).toEqual(['refused']);
  });

  it('draws the long way round for a peak far outside the ring', async () => {
    const wild: TraceCycle = { ...cycleAt(idx('too-fast')), peakOmega: 700 };
    await mountWithTrace([wild], true);
    const ceiling = ILLUSTRATION_CARD.peakVelocityCeiling.value;
    expect(sel<HTMLElement>('#rp-deficit').textContent).toBe(
      `${700 - ceiling} °/s past the ${ceiling} °/s ceiling`,
    );
    const d = sel<SVGPathElement>('#rp-gap').getAttribute('d') ?? '';
    // large-arc-flag 1, sweep-flag 0: the bracket spans more than half a turn.
    expect(d).toContain('0 1 0');
    expect(sel<SVGPathElement>('#rp-gap').getAttribute('opacity')).toBe('1');
  });
});
