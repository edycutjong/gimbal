// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderBlock, type BlockProps, type BlockView } from '../src/ui/screens/block.ts';
import type { BlockFrameState } from '../src/session/blockRunner.ts';
import type { ScoredCycle } from '../src/dsp/types.ts';
import { doseReadout, blockProgress, refusalSentence } from '../src/ui/copy.ts';
import { prescribedSeconds } from '../src/protocol/card.ts';
import { testCard, testCycle } from './helpers.ts';

/**
 * Screen 3 — the block screen, exercised against a real DOM.
 *
 * The invariants this file exists to hold, none of which are cosmetic:
 *
 *   · THE KEYBOARD IS THE ONLY INPUT. The screen renders no button, no link and
 *     no focusable control, because every piece of interface furniture above the
 *     fold is a candidate saccade away from the optotype the patient is being
 *     scored on.
 *   · THE LANDOLT C IS ANSWERED WITH AN ARROW KEY DURING MOTION — four keys,
 *     four orientations, mapped spatially.
 *   · `Esc` ENDS THE SESSION INSTANTLY: one call, no confirmation dialog, no
 *     pause, and no penalty written anywhere on screen.
 *   · THE DIAL IS `aria-hidden` — an SVG rewritten 30 times a second is hostile
 *     to assistive technology — so the information is carried in WORDS by the
 *     text line the polite live region reads.
 *   · A REFUSAL IS NEVER RED. It is an absence: a hatched hole in the strip, a
 *     slate tick on the ring, and a sentence that names the reason.
 *
 * Every assertion reads state back off the DOM the render actually wrote.
 */

const dialControl = vi.hoisted(() => ({ breakBinding: false }));

// The only reachable path to `throw new Error('dial failed to bind')` is a dial
// template that does not carry the four elements `bindDial` requires — the
// screen writes that template itself, so the failure is provoked from the
// module boundary rather than faked at the call site.
vi.mock('../src/ui/dial.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/dial.ts')>();
  return {
    ...actual,
    createDial: (card: Parameters<typeof actual.createDial>[0]) =>
      dialControl.breakBinding
        ? { html: '<svg class="ring" aria-hidden="true"></svg>', max: 500 }
        : actual.createDial(card),
  };
});

const CARD = testCard();
const TOTAL = prescribedSeconds(CARD); // 120 s × 3 blocks = 360 s
const BLOCK_MS = CARD.blockSeconds.value * 1000;

const live = new Set<BlockView>();

function mount(over: Partial<BlockProps> = {}): {
  host: HTMLElement;
  view: BlockView;
  props: BlockProps;
} {
  const host = document.createElement('main');
  document.body.appendChild(host);
  const props: BlockProps = {
    card: CARD,
    blockIndex: 0,
    video: document.createElement('video'),
    optoVmin: 12,
    hideVideo: false,
    onAnswer: vi.fn(),
    onPauseToggle: vi.fn(),
    onInterrupt: vi.fn(),
    ...over,
  };
  const view = renderBlock(host, props);
  live.add(view);
  return { host, view, props };
}

function frame(over: Partial<BlockFrameState> = {}): BlockFrameState {
  return {
    tMs: 0,
    omega: 250,
    deliveredSeconds: 0,
    elapsedMs: 0,
    facePresent: true,
    quality: 0.9,
    optotypeShown: null,
    optotypeWindowOpen: false,
    ...over,
  };
}

function cycle(over: Partial<ScoredCycle> = {}): ScoredCycle {
  return { ...testCycle(), credited: true, reason: 'ok', ...over };
}

/** Returns the event, so a test can read `defaultPrevented` off it. */
function press(key: string, code = key): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, code, cancelable: true, bubbles: true });
  globalThis.dispatchEvent(e);
  return e;
}

function liveArc(host: HTMLElement): SVGCircleElement {
  return host.querySelector('.ring-live') as SVGCircleElement;
}

beforeEach(() => {
  dialControl.breakBinding = false;
  document.body.innerHTML = '';
});

afterEach(() => {
  for (const v of live) v.destroy();
  live.clear();
  document.body.innerHTML = '';
});

describe('block screen — the still frame', () => {
  it('renders one centred stack and no chrome, with the block number as the only heading', () => {
    const { host } = mount({ blockIndex: 1 });

    const h1 = host.querySelector('#screen-title') as HTMLHeadingElement;
    expect(h1.tagName).toBe('H1');
    expect(h1.textContent).toBe('Block 2');
    expect(h1.className).toBe('visually-hidden');
    expect(h1.getAttribute('tabindex')).toBe('-1');

    // No header, no nav, no chrome above the fold.
    expect(host.querySelector('header')).toBeNull();
    expect(host.querySelector('nav')).toBeNull();
    expect(host.querySelector('.settings-row')).toBeNull();
  });

  it('offers no pointer target at all — the keyboard is the only input', () => {
    const { host } = mount();
    expect(host.querySelectorAll('button, a, input, select, textarea, [role="button"]')).toHaveLength(0);
    // …and nothing but the off-screen title is reachable by Tab.
    const focusable = Array.from(host.querySelectorAll<HTMLElement>('[tabindex]'));
    expect(focusable.map((n) => n.id)).toEqual(['screen-title']);
    expect(focusable.every((n) => n.getAttribute('tabindex') === '-1')).toBe(true);
  });

  it('sizes the optotype from the props and seeds every readout from the card', () => {
    const { host } = mount({ blockIndex: 0 });

    expect(host.getAttribute('style') ?? '').toContain('--opto-d: 12vmin');
    expect((host.querySelector('#dose-readout') as HTMLElement).textContent).toBe(
      doseReadout(0, TOTAL),
    );
    expect((host.querySelector('#dose-sub') as HTMLElement).textContent).toBe(
      blockProgress(0, CARD.blockCount.value, BLOCK_MS),
    );
    expect((host.querySelector('#dose-sub') as HTMLElement).textContent).toBe('Block 1 of 3 · 2:00 left');
    expect((host.querySelector('.key-legend') as HTMLElement).textContent).toBe(
      '← → answer · ␣ pause · esc end session',
    );
    expect((host.querySelector('#status-line') as HTMLElement).textContent).toBe('');
    expect((host.querySelector('#paused-overlay') as HTMLElement).hidden).toBe(true);
  });

  it('hides the dial and the strip from assistive technology, and starts the C at orientation 0', () => {
    const { host } = mount();

    expect((host.querySelector('svg.ring') as SVGSVGElement).getAttribute('aria-hidden')).toBe('true');
    expect((host.querySelector('#cycle-strip') as SVGSVGElement).getAttribute('aria-hidden')).toBe('true');

    const opto = host.querySelector('#quiet-field svg') as SVGSVGElement;
    expect(opto.getAttribute('style')).toContain('rotate(0deg)');
    expect(opto.getAttribute('aria-label')).toBe('target');
  });

  it('refuses to render a dial it cannot bind rather than driving a half-built ring', () => {
    dialControl.breakBinding = true;
    const host = document.createElement('main');
    document.body.appendChild(host);
    expect(() =>
      renderBlock(host, {
        card: CARD,
        blockIndex: 0,
        video: document.createElement('video'),
        optoVmin: 12,
        hideVideo: false,
        onAnswer: vi.fn(),
        onPauseToggle: vi.fn(),
        onInterrupt: vi.fn(),
      }),
    ).toThrow('dial failed to bind');
  });
});

describe('block screen — the presence tile', () => {
  it('mounts the video as the presence tile when it is shown', () => {
    const video = document.createElement('video');
    const { host } = mount({ video, hideVideo: false });
    expect(video.className).toBe('presence-tile');
    expect(video.hidden).toBe(false);
    expect(video.parentElement).toBe(host);
  });

  it('keeps the video out of the frame — and out of the tree — when it is hidden', () => {
    const video = document.createElement('video');
    const { host } = mount({ video, hideVideo: true });
    expect(video.hidden).toBe(true);
    expect(video.parentElement).toBeNull();
    expect(host.querySelector('video')).toBeNull();
    expect(video.className).toBe('');
  });
});

describe('block screen — the keyboard is the whole interface', () => {
  it('answers the Landolt C with the four arrow keys, mapped spatially', () => {
    const { props } = mount();
    for (const [key, orientation] of [
      ['ArrowRight', 0],
      ['ArrowDown', 1],
      ['ArrowLeft', 2],
      ['ArrowUp', 3],
    ] as const) {
      const e = press(key);
      expect(props.onAnswer).toHaveBeenLastCalledWith(orientation);
      // Arrow keys never scroll the block screen out from under the optotype.
      expect(e.defaultPrevented).toBe(true);
    }
    expect(props.onAnswer).toHaveBeenCalledTimes(4);
    expect(props.onPauseToggle).not.toHaveBeenCalled();
    expect(props.onInterrupt).not.toHaveBeenCalled();
  });

  it('pauses on space, by key and by physical code, and never lets the page scroll', () => {
    const { props } = mount();

    const byKey = press(' ', 'Space');
    expect(byKey.defaultPrevented).toBe(true);
    expect(props.onPauseToggle).toHaveBeenCalledTimes(1);

    // A layout that reports a different `key` for the space bar still pauses.
    const byCode = press('Unidentified', 'Space');
    expect(byCode.defaultPrevented).toBe(true);
    expect(props.onPauseToggle).toHaveBeenCalledTimes(2);

    expect(props.onAnswer).not.toHaveBeenCalled();
    expect(props.onInterrupt).not.toHaveBeenCalled();
  });

  it('ends the session on Esc instantly — one call, no confirmation, no penalty', () => {
    const { host, props } = mount();
    const doseBefore = (host.querySelector('#dose-readout') as HTMLElement).textContent;

    const e = press('Escape');

    expect(props.onInterrupt).toHaveBeenCalledTimes(1);
    expect((props.onInterrupt as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([]);
    expect(e.defaultPrevented).toBe(true);

    // No confirmation surface of any kind appeared…
    expect(document.querySelector('dialog')).toBeNull();
    expect(host.querySelectorAll('button, [role="dialog"], [role="alertdialog"]')).toHaveLength(0);
    // …the screen did not pause on the way out…
    expect(props.onPauseToggle).not.toHaveBeenCalled();
    expect((host.querySelector('#paused-overlay') as HTMLElement).hidden).toBe(true);
    // …and nothing was taken away from what was already delivered.
    expect((host.querySelector('#dose-readout') as HTMLElement).textContent).toBe(doseBefore);
    expect((host.querySelector('#status-line') as HTMLElement).textContent).toBe('');
  });

  it('ignores every other key', () => {
    const { props } = mount();
    for (const key of ['a', 'Enter', 'Tab', 'ArrowRight2', 'Shift']) {
      const e = press(key);
      expect(e.defaultPrevented).toBe(false);
    }
    expect(props.onAnswer).not.toHaveBeenCalled();
    expect(props.onPauseToggle).not.toHaveBeenCalled();
    expect(props.onInterrupt).not.toHaveBeenCalled();
  });

  it('stops listening once the screen is destroyed', () => {
    const { view, props } = mount();
    press('ArrowLeft');
    expect(props.onAnswer).toHaveBeenCalledTimes(1);

    view.destroy();
    live.delete(view);

    press('ArrowLeft');
    press(' ', 'Space');
    press('Escape');
    expect(props.onAnswer).toHaveBeenCalledTimes(1);
    expect(props.onPauseToggle).not.toHaveBeenCalled();
    expect(props.onInterrupt).not.toHaveBeenCalled();
  });
});

describe('block screen — onFrame', () => {
  it('colours the live arc in-band only between the card floor and ceiling', () => {
    const { host, view } = mount();

    view.onFrame(frame({ omega: 250, tMs: 0 }));
    expect(liveArc(host).getAttribute('stroke')).toBe('var(--zone-in)');

    view.onFrame(frame({ omega: CARD.peakVelocityFloor.value - 1, tMs: 33 }));
    expect(liveArc(host).getAttribute('stroke')).toBe('var(--zone-out)');

    view.onFrame(frame({ omega: CARD.peakVelocityCeiling.value + 1, tMs: 66 }));
    expect(liveArc(host).getAttribute('stroke')).toBe('var(--zone-out)');

    // Both edges of the band are IN. A rep exactly at the floor is a rep.
    view.onFrame(frame({ omega: CARD.peakVelocityFloor.value, tMs: 99 }));
    expect(liveArc(host).getAttribute('stroke')).toBe('var(--zone-in)');
    view.onFrame(frame({ omega: CARD.peakVelocityCeiling.value, tMs: 132 }));
    expect(liveArc(host).getAttribute('stroke')).toBe('var(--zone-in)');
  });

  it('rewrites the text readouts at 10 Hz, not once per frame', () => {
    const { host, view } = mount();
    const dose = host.querySelector('#dose-readout') as HTMLElement;
    const sub = host.querySelector('#dose-sub') as HTMLElement;

    // t = 0 is inside the 100 ms floor measured from block start: no write.
    view.onFrame(frame({ tMs: 0, deliveredSeconds: 30, elapsedMs: 0 }));
    expect(dose.textContent).toBe(doseReadout(0, TOTAL));

    view.onFrame(frame({ tMs: 99, deliveredSeconds: 30, elapsedMs: 99 }));
    expect(dose.textContent).toBe(doseReadout(0, TOTAL));

    view.onFrame(frame({ tMs: 100, deliveredSeconds: 30, elapsedMs: 100 }));
    expect(dose.textContent).toBe(doseReadout(30, TOTAL));
    expect(dose.textContent).toBe('0.5 / 6.0 min in zone');
    expect(sub.textContent).toBe(blockProgress(0, CARD.blockCount.value, BLOCK_MS - 100));

    // The clock resets from the last WRITE, so 199 is still inside the floor.
    view.onFrame(frame({ tMs: 199, deliveredSeconds: 45, elapsedMs: 199 }));
    expect(dose.textContent).toBe(doseReadout(30, TOTAL));

    view.onFrame(frame({ tMs: 200, deliveredSeconds: 45, elapsedMs: 60_000 }));
    expect(dose.textContent).toBe(doseReadout(45, TOTAL));
    expect(sub.textContent).toBe('Block 1 of 3 · 1:00 left');
  });

  it('flags the presence tile when the face is lost or the tracking quality falls', () => {
    const video = document.createElement('video');
    const { view } = mount({ video, hideVideo: false });

    view.onFrame(frame({ tMs: 100, facePresent: true, quality: 0.9 }));
    expect(video.dataset.alert).toBe('false');

    view.onFrame(frame({ tMs: 200, facePresent: false, quality: 0.9 }));
    expect(video.dataset.alert).toBe('true');

    view.onFrame(frame({ tMs: 300, facePresent: true, quality: 0.39 }));
    expect(video.dataset.alert).toBe('true');

    view.onFrame(frame({ tMs: 400, facePresent: true, quality: 0.4 }));
    expect(video.dataset.alert).toBe('false');
  });

  it('never touches the tile when the video is hidden', () => {
    const video = document.createElement('video');
    const { host, view } = mount({ video, hideVideo: true });

    view.onFrame(frame({ tMs: 100, facePresent: false, quality: 0 }));
    view.onFrame(frame({ tMs: 200, facePresent: true, quality: 1 }));

    expect(video.dataset.alert).toBeUndefined();
    // The ring still runs: hiding the tile hides the camera, not the measurement.
    expect(liveArc(host).getAttribute('stroke-dasharray')).not.toBe('0 263.894');
  });
});

describe('block screen — onCycle', () => {
  it('credits a rep silently: the strip fills, the tick goes to zone colour, no sentence', () => {
    const { host, view } = mount();

    view.onCycle(cycle({ peakOmega: 250, credited: true, reason: 'ok' }));

    // Nothing happens. That is the point — no celebration, no colour burst.
    expect((host.querySelector('#status-line') as HTMLElement).textContent).toBe('');
    const rects = host.querySelectorAll('#cycle-strip rect');
    expect(rects).toHaveLength(1);
    expect(rects[0]?.getAttribute('fill')).toBe('var(--zone-in)');
    expect(rects[0]?.getAttribute('height')).toBe('20');
    expect((host.querySelector('.ring-marker') as SVGLineElement).getAttribute('stroke')).toBe(
      'var(--zone-in)',
    );
  });

  it('names a refusal in words, draws it as a hole, and never draws it red', () => {
    const { host, view } = mount();
    const c = cycle({ peakOmega: 110, credited: false, reason: 'too-slow' });

    view.onCycle(c);

    const status = host.querySelector('#status-line') as HTMLElement;
    expect(status.textContent).toBe(refusalSentence('too-slow', c, CARD));
    expect(status.textContent).toBe('Rep not counted — too slow (below 150 °/s; measured 110 °/s).');
    // The words carry the ring's information, since the ring is aria-hidden.
    expect(status.textContent).toContain('°/s');

    const rect = host.querySelector('#cycle-strip rect') as SVGRectElement;
    expect(rect.getAttribute('fill')).toBe('url(#refused-hatch)');
    expect(rect.getAttribute('stroke')).toBe('var(--refused)');
    expect(Number(rect.getAttribute('height'))).toBeLessThan(20); // an absence, not a mark
    expect((host.querySelector('.ring-marker') as SVGLineElement).getAttribute('stroke')).toBe(
      'var(--refused)',
    );

    // A refusal is never red — not literally, and not by any hard-coded value.
    expect(host.innerHTML).not.toMatch(/\bred\b|crimson|#f00\b|#ff0000|rgb\(\s*255\s*,\s*0\s*,\s*0\s*\)/i);
  });

  it('replaces the status sentence and never appends to it', () => {
    const { host, view } = mount();
    const status = host.querySelector('#status-line') as HTMLElement;

    const slow = cycle({ peakOmega: 110, credited: false, reason: 'too-slow' });
    view.onCycle(slow);
    const fast = cycle({ peakOmega: 480, credited: false, reason: 'too-fast' });
    view.onCycle(fast);
    expect(status.textContent).toBe(refusalSentence('too-fast', fast, CARD));
    expect(status.textContent).not.toContain('too slow');

    // …and a credited rep clears it rather than leaving a stale complaint up.
    view.onCycle(cycle({ credited: true, reason: 'ok' }));
    expect(status.textContent).toBe('');
    expect(host.querySelectorAll('#cycle-strip rect')).toHaveLength(3);
  });
});

describe('block screen — pause', () => {
  it('shows the overlay and dims the ring, then restores both', () => {
    const { host, view } = mount();
    const overlay = host.querySelector('#paused-overlay') as HTMLElement;

    view.setPaused(true);
    expect(overlay.hidden).toBe(false);
    expect(overlay.textContent).toBe('Paused. Press space to continue.');
    expect(liveArc(host).getAttribute('stroke')).toBe('var(--edge)');

    view.setPaused(false);
    expect(overlay.hidden).toBe(true);
    expect(liveArc(host).getAttribute('stroke')).toBe('var(--zone-out)');
  });
});

describe('block screen — the optotype', () => {
  it('redraws only when the orientation actually changes', () => {
    const { host, view } = mount();
    const field = host.querySelector('#quiet-field') as HTMLElement;

    const first = field.querySelector('svg') as SVGSVGElement;
    view.setOptotype(2, true);
    const shown = field.querySelector('svg') as SVGSVGElement;
    expect(shown).not.toBe(first);
    expect(shown.getAttribute('style')).toContain('rotate(180deg)');
    expect(shown.getAttribute('data-window')).toBe('open');

    // Same orientation again: the node is NOT replaced. Re-parsing the C
    // mid-window would flash the target the patient is holding fixation on.
    view.setOptotype(2, true);
    expect(field.querySelector('svg')).toBe(shown);

    view.setOptotype(3, true);
    expect((field.querySelector('svg') as SVGSVGElement).getAttribute('style')).toContain(
      'rotate(270deg)',
    );
  });

  it('closes the response window without disturbing the drawn C', () => {
    const { host, view } = mount();
    const field = host.querySelector('#quiet-field') as HTMLElement;

    view.setOptotype(1, true);
    const shown = field.querySelector('svg') as SVGSVGElement;
    expect(shown.getAttribute('data-window')).toBe('open');

    // `null` means "no new presentation" — the last C stays exactly where it is.
    view.setOptotype(null, false);
    expect(field.querySelector('svg')).toBe(shown);
    expect(shown.getAttribute('data-window')).toBe('closed');
    expect(shown.getAttribute('style')).toContain('rotate(90deg)');
  });

  it('is inert when the quiet field holds no target', () => {
    const { host, view } = mount();
    const field = host.querySelector('#quiet-field') as HTMLElement;
    field.innerHTML = '';

    expect(() => view.setOptotype(null, true)).not.toThrow();
    expect(field.innerHTML).toBe('');
  });
});
