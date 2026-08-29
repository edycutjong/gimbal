// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import {
  arcAngleDeg,
  bindDial,
  createDial,
  Dial,
  markerRotationDeg,
  type DialElements,
} from '../src/ui/dial.ts';
import { velocityCentre } from '../src/protocol/card.ts';
import { testCard } from './helpers.ts';

/**
 * The ring, exercised against a real DOM.
 *
 * `tests/dial.test.ts` proves the two angle functions agree as ARITHMETIC. This
 * file proves the markup they are supposed to drive actually carries those
 * angles: that the emitted `stroke-dasharray` lengths land the arc tip and the
 * committed tick where `arcAngleDeg` says they land, that the ring stays
 * `aria-hidden`, and that a refused rep is drawn as slate that HOLDS rather than
 * as a red flash.
 *
 * Nothing here is a screenshot. Every assertion is a number read back off an
 * attribute the render actually wrote.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The ring's authored radius — see `createDial`. */
const R = 42;
const C = 2 * Math.PI * R;
const ARC = C * 0.75; // the 270° sweep

const CARD = testCard(); // floor 150 °/s, ceiling 350 °/s
const MAX = velocityCentre(CARD) * 2; // 500 °/s

function mount(): { root: HTMLDivElement; els: DialElements; max: number } {
  const { html, max } = createDial(CARD);
  const root = document.createElement('div');
  root.innerHTML = html;
  const els = bindDial(root);
  if (!els) throw new Error('bindDial refused the markup createDial just produced');
  return { root, els, max };
}

/** `"98.960 263.894"` → `[98.96, 263.894]`. */
function dash(el: Element): number[] {
  return (el.getAttribute('stroke-dasharray') ?? '')
    .trim()
    .split(/\s+/)
    .map(Number);
}

/** Screen position of a dasharray length, in degrees clockwise from three o'clock. */
function tipDeg(len: number): number {
  return ((arcAngleDeg(len / ARC) % 360) + 360) % 360;
}

describe('createDial markup', () => {
  it('scales the ring to twice the card’s velocity band centre', () => {
    expect(createDial(CARD).max).toBe(500);
    expect(createDial(testCard({ floor: 100, ceiling: 300 })).max).toBe(400);
  });

  it('is aria-hidden and unreachable — an SVG rewritten 30x/sec is hostile to AT', () => {
    const { root, els } = mount();
    expect(els.svg.getAttribute('aria-hidden')).toBe('true');
    expect(els.svg.getAttribute('focusable')).toBe('false');
    // No competing accessible name, and nothing inside is tabbable: the ring's
    // information is carried in words by the polite status region.
    expect(els.svg.getAttribute('role')).toBeNull();
    expect(els.svg.getAttribute('aria-label')).toBeNull();
    expect(root.querySelectorAll('[tabindex], [aria-label], [role]')).toHaveLength(0);
  });

  it('draws the unfilled sweep in --edge, not in a surface token', () => {
    // Regression: `--surface-2` on `--surface-1` is 1.03:1 on the warm-paper
    // palette, so the track simply did not exist in Light.
    const { els } = mount();
    expect(els.track.getAttribute('stroke')).toBe('var(--edge)');
    expect(els.track.getAttribute('fill')).toBe('none');
    const [len, gap] = dash(els.track);
    expect(len).toBeCloseTo(ARC, 2); // 270° drawn...
    expect(gap).toBeCloseTo(C, 2); // ...and a full circumference of gap, so the last 90° stays blank
  });

  it('centres the prescribed band on twelve o’clock', () => {
    const { els } = mount();
    const [lead, start, bandLen, gap] = dash(els.band);
    expect(lead).toBe(0);
    expect(gap).toBeCloseTo(C, 2);
    // floor 150 / 500 = 0.3 of the sweep; ceiling 350 / 500 = 0.7.
    expect(start).toBeCloseTo(0.3 * ARC, 2);
    expect(bandLen).toBeCloseTo(0.4 * ARC, 2);
    const bandStartDeg = tipDeg(start as number);
    const bandEndDeg = tipDeg((start as number) + (bandLen as number));
    // Precision 3, not more: the dasharray is emitted at three decimals, which
    // is a fifth of a thousandth of a degree on this ring.
    expect((bandStartDeg + bandEndDeg) / 2).toBeCloseTo(270, 3); // twelve o'clock
  });

  it('starts with an empty live arc and a marker that has not been committed yet', () => {
    const { els } = mount();
    const [len, gap] = dash(els.live);
    expect(len).toBe(0);
    expect(gap).toBeCloseTo(C, 2);
    expect(els.live.getAttribute('stroke')).toBe('var(--zone-out)');
    expect(els.marker.getAttribute('opacity')).toBe('0');
    expect(els.marker.getAttribute('y1')).toBe(String(50 - R - 5));
    expect(els.marker.getAttribute('y2')).toBe(String(50 - R + 8));
  });

  it('puts every ring part concentric on the same circle', () => {
    const { els } = mount();
    for (const el of [els.track, els.band, els.live]) {
      expect(el.getAttribute('cx')).toBe('50');
      expect(el.getAttribute('cy')).toBe('50');
      expect(el.getAttribute('r')).toBe(String(R));
      expect(el.getAttribute('stroke-width')).toBe('6');
    }
    expect(els.marker.getAttribute('x1')).toBe('50');
    expect(els.marker.getAttribute('x2')).toBe('50');
  });
});

describe('Dial live arc', () => {
  let els: DialElements;
  beforeEach(() => {
    els = mount().els;
  });

  it('reads its radius from the DOM and tweens unless motion is reduced', () => {
    const dial = new Dial(els, MAX, false);
    expect(els.live.style.transition).toBe('stroke-dasharray 100ms linear');
    dial.setLive(MAX, false, 0);
    expect(dash(els.live)[1]).toBeCloseTo(C, 2);

    const small = document.createElementNS(SVG_NS, 'circle') as SVGCircleElement;
    small.setAttribute('r', '20');
    new Dial({ ...els, live: small }, MAX, false).setLive(MAX, false, 0);
    const [len, gap] = dash(small);
    expect(gap).toBeCloseTo(2 * Math.PI * 20, 2);
    expect(len).toBeCloseTo(2 * Math.PI * 20 * 0.75, 2);
  });

  it('falls back to r=42 when the element carries no radius', () => {
    const bare = document.createElementNS(SVG_NS, 'circle') as SVGCircleElement;
    expect(bare.getAttribute('r')).toBeNull();
    new Dial({ ...els, live: bare }, MAX, false).setLive(MAX, false, 0);
    expect(dash(bare)[1]).toBeCloseTo(C, 2);
  });

  it('does not install a transition under reduced motion', () => {
    new Dial(els, MAX, true);
    expect(els.live.style.transition).toBe('');
  });

  it('lands band centre exactly on twelve o’clock and the maximum at the sweep end', () => {
    const dial = new Dial(els, MAX, false);

    dial.setLive(250, true, 0); // band centre = half of max
    expect(tipDeg(dash(els.live)[0] as number)).toBeCloseTo(270, 3);

    dial.setLive(MAX, false, 16);
    expect(dash(els.live)[0]).toBeCloseTo(ARC, 2);
    expect(tipDeg(dash(els.live)[0] as number)).toBeCloseTo(45, 3); // 405° = half past four

    dial.setLive(0, false, 32);
    expect(dash(els.live)[0]).toBe(0);
    expect(tipDeg(0)).toBeCloseTo(135, 6); // half past seven
  });

  it('treats a leftward turn as the same speed, and clamps beyond the ring maximum', () => {
    const dial = new Dial(els, MAX, false);
    dial.setLive(180, true, 0);
    const right = dash(els.live)[0];
    dial.setLive(-180, true, 16);
    expect(dash(els.live)[0]).toBe(right);

    dial.setLive(MAX * 10, false, 32);
    expect(dash(els.live)[0]).toBeCloseTo(ARC, 2); // never past the end of the sweep
  });

  it('draws a lost or non-finite velocity as zero rather than as NaN markup', () => {
    const dial = new Dial(els, MAX, false);
    dial.setLive(400, false, 0);
    expect(dash(els.live)[0]).toBeGreaterThan(0);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      dial.setLive(bad, false, 16);
      expect(els.live.getAttribute('stroke-dasharray')).not.toMatch(/NaN|Infinity/);
      expect(dash(els.live)[0]).toBe(0);
    }
  });

  it('switches between the two zone hues and nothing else', () => {
    const dial = new Dial(els, MAX, false);
    dial.setLive(250, true, 0);
    expect(els.live.getAttribute('stroke')).toBe('var(--zone-in)');
    dial.setLive(600, false, 16);
    expect(els.live.getAttribute('stroke')).toBe('var(--zone-out)');
  });

  it('writes attributes only — never markup — in the loop', () => {
    const dial = new Dial(els, MAX, false);
    const before = els.live.outerHTML;
    const names = new Set(Array.from(els.live.attributes, (a) => a.name));
    for (let i = 0; i < 60; i++) dial.setLive(100 + i, i % 2 === 0, i * 16);
    expect(els.live.children).toHaveLength(0);
    expect(new Set(Array.from(els.live.attributes, (a) => a.name))).toEqual(names);
    expect(els.live.outerHTML).not.toBe(before); // it did in fact repaint
  });

  it('throttles to 10 Hz under reduced motion, and not at all otherwise', () => {
    const reduced = new Dial(els, MAX, true);

    reduced.setLive(250, true, 0); // 0 - 0 < 100: the very first frame is suppressed too
    expect(dash(els.live)[0]).toBe(0);
    reduced.setLive(250, true, 50);
    expect(dash(els.live)[0]).toBe(0);

    reduced.setLive(250, true, 100); // first frame past the 100 ms gate
    expect(dash(els.live)[0]).toBeCloseTo(0.5 * ARC, 2);

    reduced.setLive(MAX, false, 150); // 50 ms later: suppressed, arc holds
    expect(dash(els.live)[0]).toBeCloseTo(0.5 * ARC, 2);
    expect(els.live.getAttribute('stroke')).toBe('var(--zone-in)');

    reduced.setLive(MAX, false, 250);
    expect(dash(els.live)[0]).toBeCloseTo(ARC, 2);

    // The same frame times, unthrottled, when motion is not reduced.
    const fresh = mount().els;
    const smooth = new Dial(fresh, MAX, false);
    smooth.setLive(250, true, 0);
    expect(dash(fresh.live)[0]).toBeCloseTo(0.5 * ARC, 2);
    smooth.setLive(MAX, false, 16);
    expect(dash(fresh.live)[0]).toBeCloseTo(ARC, 2);
  });
});

describe('Dial committed marker', () => {
  let els: DialElements;
  let dial: Dial;
  beforeEach(() => {
    els = mount().els;
    dial = new Dial(els, MAX, false);
  });

  it('points the tick at the same place the live arc tip would reach', () => {
    for (const peak of [0, 125, 250, 375, MAX]) {
      dial.setCommitted(peak, true);
      const rotation = Number(
        /rotate\((-?[\d.]+) 50 50\)/.exec(els.marker.getAttribute('transform') ?? '')?.[1],
      );
      expect(rotation).toBeCloseTo(markerRotationDeg(peak / MAX), 2);
      // The tick is authored at the element's own twelve o'clock (270°) and
      // inherits the stylesheet's 135° element rotation.
      const onScreen = (((270 + rotation + 135) % 360) + 360) % 360;
      expect(onScreen).toBeCloseTo(tipDeg((peak / MAX) * ARC), 1);
    }
  });

  it('puts band centre at twelve o’clock and clamps a wild peak to the sweep end', () => {
    dial.setCommitted(250, true);
    expect(els.marker.getAttribute('transform')).toBe('rotate(-135.00 50 50)');
    dial.setCommitted(MAX * 4, true);
    expect(els.marker.getAttribute('transform')).toBe('rotate(0.00 50 50)');
    dial.setCommitted(Number.NaN, true);
    expect(els.marker.getAttribute('transform')).toBe('rotate(-270.00 50 50)');
  });

  it('paints a credited rep in --zone-in, on both the tick and the band', () => {
    dial.setCommitted(250, true);
    expect(els.marker.getAttribute('stroke')).toBe('var(--zone-in)');
    expect(els.band.getAttribute('stroke')).toBe('var(--zone-in)');
    expect(els.marker.getAttribute('opacity')).toBe('1');
  });

  it('paints a refusal in slate and lets the band fall back to its neutral edge', () => {
    dial.setCommitted(90, false);
    expect(els.marker.getAttribute('stroke')).toBe('var(--refused)');
    expect(els.band.getAttribute('stroke')).toBe('var(--edge-strong)');
    // Not the halt hue, and not any of the banned alarm tokens: a refused rep is
    // the INSTRUMENT declining, not the patient failing.
    for (const el of [els.marker, els.band]) {
      expect(el.getAttribute('stroke')).not.toMatch(/--halt|--error|--danger|--warning|red/);
    }
  });

  it('never flashes and never shakes — a refusal is a steady state', () => {
    dial.setCommitted(90, false);
    const first = els.marker.getAttribute('transform');
    expect(els.marker.getAttribute('opacity')).toBe('1');
    // Repeated refusals must not pulse the tick back to transparent, and must
    // not move it off the velocity it is reporting.
    for (let i = 0; i < 5; i++) {
      dial.setCommitted(90, false);
      expect(els.marker.getAttribute('opacity')).toBe('1');
      expect(els.marker.getAttribute('transform')).toBe(first);
    }
    // A pure rotation about the ring centre: no translate, no scale, no keyframes.
    expect(first).toMatch(/^rotate\(-?\d+\.\d\d 50 50\)$/);
    expect(els.marker.style.length).toBe(0);
    expect(els.marker.getAttribute('class')).toBe('ring-marker');
    expect(els.marker.outerHTML).not.toMatch(/animate|animation|transition/);
  });
});

describe('Dial pause', () => {
  it('dims the live arc and HOLDS the last committed value', () => {
    const els = mount().els;
    const dial = new Dial(els, MAX, false);
    dial.setLive(250, true, 0);
    dial.setCommitted(250, true);
    const held = els.marker.getAttribute('transform');
    const heldArc = els.live.getAttribute('stroke-dasharray');

    dial.setPaused(true);
    expect(els.live.getAttribute('stroke')).toBe('var(--edge)');
    expect(els.marker.getAttribute('transform')).toBe(held);
    expect(els.marker.getAttribute('opacity')).toBe('1');
    expect(els.band.getAttribute('stroke')).toBe('var(--zone-in)');
    expect(els.live.getAttribute('stroke-dasharray')).toBe(heldArc);

    dial.setPaused(false);
    expect(els.live.getAttribute('stroke')).toBe('var(--zone-out)');
  });
});

describe('bindDial', () => {
  it('binds every part of a well-formed ring', () => {
    const { root, els } = mount();
    expect(els.svg.tagName.toLowerCase()).toBe('svg');
    expect(els.svg).toBe(root.querySelector('svg.ring'));
    expect(els.track.getAttribute('class')).toBe('ring-track');
    expect(els.band.getAttribute('class')).toBe('ring-band');
    expect(els.live.getAttribute('class')).toBe('ring-live');
    expect(els.marker.getAttribute('class')).toBe('ring-marker');
  });

  it('refuses — rather than half-binds — when any single part is missing', () => {
    for (const selector of ['svg.ring', '.ring-track', '.ring-band', '.ring-live', '.ring-marker']) {
      const root = document.createElement('div');
      root.innerHTML = createDial(CARD).html;
      root.querySelector(selector)?.remove();
      expect(bindDial(root), `missing ${selector}`).toBeNull();
    }
    expect(bindDial(document.createElement('div'))).toBeNull();
  });
});

/**
 * The palette invariants the ring depends on, asserted against the stylesheet
 * that actually ships rather than against a screenshot.
 *
 * The stylesheet is read off disk rather than imported: Vitest stubs `.css`
 * requests to the empty string, `?raw` and `?inline` included, and there is no
 * `@types/node` among the four dev dependencies — the dependency count is
 * greppable evidence in this project — so the builtin is reached through a
 * specifier TypeScript cannot try to resolve.
 */
const readTextFile = async (path: string): Promise<string> => {
  const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as {
    readFileSync: (p: string, enc: string) => string;
  };
  return fs.readFileSync(path, 'utf8');
};

describe('ring palette', () => {
  const THEMES = 'src/styles/themes.css'; // relative to the Vitest root, which is this package

  const hexes = (css: string, token: string): string[] =>
    Array.from(css.matchAll(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`, 'g')), (m) => m[1] as string);

  const luminance = (hex: string): number => {
    const n = Number.parseInt(hex.slice(1), 16);
    const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (channels[0] as number) + 0.7152 * (channels[1] as number) + 0.0722 * (channels[2] as number);
  };

  it('keeps the two zone hues near iso-luminant, so the ring reads by HUE not brightness', async () => {
    // The live arc changes colour in place while the eye is on the optotype.
    // A brightness step there would read as a flash in the periphery, which is
    // exactly what this population must not be given.
    const css = await readTextFile(THEMES);
    const ins = hexes(css, 'zone-in');
    const outs = hexes(css, 'zone-out');
    expect(ins.length).toBeGreaterThanOrEqual(3); // dark, dim, light
    expect(outs).toHaveLength(ins.length);
    ins.forEach((hexIn, i) => {
      const a = luminance(hexIn) + 0.05;
      const b = luminance(outs[i] as string) + 0.05;
      const ratio = Math.max(a, b) / Math.min(a, b);
      expect(ratio, `${hexIn} vs ${outs[i]}`).toBeLessThan(1.5); // far below the 3:1 "different brightness" step
    });
  });

  it('keeps the refusal hue cool — a refused rep is never painted red', async () => {
    const refused = hexes(await readTextFile(THEMES), 'refused');
    expect(refused.length).toBeGreaterThanOrEqual(3);
    for (const hex of refused) {
      const n = Number.parseInt(hex.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      expect(b, hex).toBeGreaterThanOrEqual(r as number); // slate, never warm
      expect(g, hex).toBeGreaterThanOrEqual(r as number);
    }
  });
});
