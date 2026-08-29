// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import type { PersistedSession } from '../src/store/session.ts';
import type { CycleOutcome, ScoredCycle } from '../src/dsp/types.ts';
import { REFUSAL_REASONS } from '../src/dsp/types.ts';
import { sparklineSvg, sparklineLegend } from '../src/ui/sparkline.ts';
import { CycleStrip, STRIP_DEFS, stripSvg } from '../src/ui/strip.ts';
import { testCycle } from './helpers.ts';

/**
 * The sparkline and the cycle strip are the two places where a refusal becomes
 * a picture. Both encode by SHAPE and ABSENCE, never by colour alone, so the
 * assertions below are on emitted geometry and markup — the thing a photocopier
 * and a deuteranope actually receive.
 */

/** Only `provenance` and `totals.ratio` reach the sparkline; the rest is inert. */
function session(provenance: 'live' | 'example', ratio: number): PersistedSession {
  return {
    provenance,
    totals: { prescribedSeconds: 120, deliveredSeconds: 120 * ratio, ratio },
  } as unknown as PersistedSession;
}

function scored(credited: boolean, reason: CycleOutcome): ScoredCycle {
  return { ...testCycle(), credited, reason };
}

/** Every literal colour token that would read as "you did something wrong". */
const RED = /\b(red|crimson|firebrick|tomato|#f00\b|#ff0000|#e0\d|rgb\(\s*2[0-5]\d\s*,\s*[0-4]?\d\s*,)/i;

/** Pull `attr="value"` off the i-th occurrence of a tag in a markup string. */
function attrs(markup: string, tag: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const m of markup.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'g'))) {
    const bag: Record<string, string> = {};
    for (const a of (m[1] as string).matchAll(/([\w:-]+)="([^"]*)"/g)) {
      bag[a[1] as string] = a[2] as string;
    }
    out.push(bag);
  }
  return out;
}

describe('sparklineSvg', () => {
  it('emits an inert, aria-hidden placeholder for an empty history', () => {
    const svg = sparklineSvg([]);
    expect(svg).toBe('<svg class="sparkline" aria-hidden="true" viewBox="0 0 100 40"></svg>');
    // No polyline, no dots, and nothing for a screen reader to announce.
    expect(svg).not.toContain('<polyline');
    expect(svg).not.toContain('<circle');
    expect(svg).not.toContain('role="img"');
  });

  it('centres a single session horizontally instead of pinning it to the pad', () => {
    const svg = sparklineSvg([session('live', 0.5)]);
    const [poly] = attrs(svg, 'polyline');
    // n === 1: x = w / 2, not x = pad. y = h - pad - 0.5 * (h - 2 * pad) = 20.
    expect(poly?.points).toBe('50.00,20.00');
    const [dot] = attrs(svg, 'circle');
    expect(dot?.cx).toBe('50.00');
    expect(dot?.cy).toBe('20.00');
    expect(svg).toContain('aria-label="Delivered dose ratio across 1 sessions on this device"');
  });

  it('spreads n > 1 sessions from pad to w - pad and maps ratio to height', () => {
    const svg = sparklineSvg([
      session('live', 0),
      session('live', 0.5),
      session('live', 1),
    ]);
    const [poly] = attrs(svg, 'polyline');
    // pad = 4, w = 100 => x ∈ {4, 50, 96}; h = 40 => y ∈ {36, 20, 4}.
    expect(poly?.points).toBe('4.00,36.00 50.00,20.00 96.00,4.00');
    expect(poly?.fill).toBe('none');
    expect(poly?.stroke).toBe('var(--ink-2)');
    expect(poly?.['stroke-width']).toBe('0.8');
  });

  it('clamps out-of-range ratios into the plot box rather than drawing outside it', () => {
    const svg = sparklineSvg([session('live', -0.5), session('live', 4)]);
    const [poly] = attrs(svg, 'polyline');
    // Math.max(0, …) floors at the baseline (y = 36); Math.min(1, …) caps at the
    // ceiling (y = 4). A 400 % ratio must not escape the viewBox.
    expect(poly?.points).toBe('4.00,36.00 96.00,4.00');
  });

  it('draws live points SOLID and leaves the connector undashed', () => {
    const svg = sparklineSvg([session('live', 0.9), session('live', 1)]);
    const circles = attrs(svg, 'circle');
    expect(circles).toHaveLength(2);
    for (const c of circles) {
      expect(c.fill).toBe('var(--ink-1)');
      expect(c.stroke).toBe('var(--ink-1)');
      expect(c.r).toBe('1.8');
      expect(c['stroke-width']).toBe('0.7');
    }
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('draws example points HOLLOW and dashes the connector when any point is an example', () => {
    const svg = sparklineSvg([session('example', 0.4), session('live', 0.8)]);
    const [ex, live] = attrs(svg, 'circle');
    // Hollow: fill none, ink-2 outline. Encoded by fill, not by hue.
    expect(ex?.fill).toBe('none');
    expect(ex?.stroke).toBe('var(--ink-2)');
    expect(live?.fill).toBe('var(--ink-1)');
    // One example is enough to dash the whole connector.
    expect(attrs(svg, 'polyline')[0]?.['stroke-dasharray']).toBe('2 1.5');
  });

  it('labels itself for a screen reader with the session count', () => {
    const svg = sparklineSvg([session('example', 1), session('example', 1)]);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('across 2 sessions on this device');
    expect(svg).not.toContain('aria-hidden');
    expect(attrs(svg, 'circle').every((c) => c.fill === 'none')).toBe(true);
  });
});

describe('sparklineLegend', () => {
  it('says nothing when there is nothing to disambiguate', () => {
    expect(sparklineLegend([])).toBe('');
  });

  it('names only the live encoding when every point is the user’s own', () => {
    expect(sparklineLegend([session('live', 1)])).toBe('solid point = your own session');
  });

  it('discloses developer-recorded rows when every point is an example', () => {
    expect(sparklineLegend([session('example', 1)])).toBe(
      'hollow point on a dashed line = EXAMPLE, recorded by the developer',
    );
  });

  it('joins both encodings, live first, when the history is mixed', () => {
    const legend = sparklineLegend([session('example', 0.2), session('live', 0.9)]);
    expect(legend).toBe(
      'solid point = your own session · hollow point on a dashed line = EXAMPLE, recorded by the developer',
    );
    expect(legend.indexOf('solid')).toBeLessThan(legend.indexOf('hollow'));
  });
});

describe('STRIP_DEFS', () => {
  it('defines a 45° hatch in the refusal token, and nothing red', () => {
    expect(STRIP_DEFS).toContain('id="refused-hatch"');
    expect(STRIP_DEFS).toContain('patternTransform="rotate(45)"');
    expect(STRIP_DEFS).toContain('stroke="var(--refused)"');
    expect(STRIP_DEFS).not.toMatch(RED);
  });
});

describe('CycleStrip', () => {
  let svg: SVGSVGElement;

  beforeEach(() => {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    document.body.replaceChildren(svg);
  });

  const rects = (): SVGRectElement[] =>
    Array.from(svg.querySelectorAll('rect')) as SVGRectElement[];

  it('configures the viewBox from maxCells and hides itself from the a11y tree', () => {
    const strip = new CycleStrip(svg, 60, true);
    expect(strip).toBeInstanceOf(CycleStrip);
    expect(svg.getAttribute('viewBox')).toBe('0 0 60 20');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelector('pattern#refused-hatch')).not.toBeNull();
  });

  it('defaults to 240 cells and motion enabled when the extra args are omitted', () => {
    const strip = new CycleStrip(svg);
    expect(svg.getAttribute('viewBox')).toBe('0 0 240 20');
    strip.add(scored(true, 'ok'));
    // reducedMotion defaults to false, so the height transition is armed.
    expect(rects()[0]?.getAttribute('style') ?? '').toContain('transition');
  });

  it('paints a credited cycle as a FULL-height filled cell', () => {
    const strip = new CycleStrip(svg, 10, true);
    strip.add(scored(true, 'ok'));
    const [r] = rects();
    expect(r?.getAttribute('x')).toBe('0');
    expect(r?.getAttribute('y')).toBe('0');
    expect(r?.getAttribute('width')).toBe('0.85');
    expect(r?.getAttribute('height')).toBe('20');
    expect(r?.getAttribute('fill')).toBe('var(--zone-in)');
    expect(r?.getAttribute('stroke')).toBe('none');
    expect(r?.getAttribute('data-reason')).toBe('ok');
  });

  it('paints a refused cycle as a short hatched GAP, never as a red mark', () => {
    const strip = new CycleStrip(svg, 10, true);
    strip.add(scored(false, 'low-confidence'));
    const [r] = rects();
    // 45 % height, vertically centred: y = 5.5, height = 9 — a hole in the row,
    // not a full cell. The dose numeral does not advance.
    expect(r?.getAttribute('y')).toBe('5.5');
    expect(r?.getAttribute('height')).toBe('9');
    expect(r?.getAttribute('fill')).toBe('url(#refused-hatch)');
    expect(r?.getAttribute('stroke')).toBe('var(--refused)');
    expect(r?.getAttribute('stroke-width')).toBe('0.15');
    // Not red — the refusal token is the grey/slate one, and no red literal
    // appears anywhere in the emitted cell.
    expect(r?.outerHTML).not.toMatch(RED);
    expect(r?.getAttribute('fill')).not.toBe('var(--zone-in)');
  });

  it('carries every refusal reason through in words on the cell itself', () => {
    const strip = new CycleStrip(svg, 10, true);
    for (const reason of REFUSAL_REASONS) strip.add(scored(false, reason));
    const reasons = rects().map((r) => r.getAttribute('data-reason'));
    expect(reasons).toEqual([...REFUSAL_REASONS]);
    // Words, not codes: each reason is human-readable and none of them blames
    // the patient with a colour.
    for (const r of rects()) {
      expect(r.getAttribute('data-reason')).toMatch(/^[a-z-]+$/);
      expect(r.outerHTML).not.toMatch(RED);
    }
  });

  it('advances x by one per cell so refusals leave their slot visible', () => {
    const strip = new CycleStrip(svg, 10, true);
    strip.add(scored(true, 'ok'));
    strip.add(scored(false, 'face-lost'));
    strip.add(scored(true, 'ok'));
    expect(rects().map((r) => r.getAttribute('x'))).toEqual(['0', '1', '2']);
    expect(rects().map((r) => r.getAttribute('height'))).toEqual(['20', '9', '20']);
  });

  it('omits the transition when the user asked for reduced motion', () => {
    const strip = new CycleStrip(svg, 10, true);
    strip.add(scored(true, 'ok'));
    expect(rects()[0]?.getAttribute('style') ?? '').not.toContain('transition');
  });

  it('stops appending once maxCells is reached instead of overflowing the viewBox', () => {
    const strip = new CycleStrip(svg, 2, true);
    strip.add(scored(true, 'ok'));
    strip.add(scored(false, 'too-fast'));
    strip.add(scored(true, 'ok'));
    strip.add(scored(true, 'ok'));
    expect(rects()).toHaveLength(2);
    expect(rects().map((r) => r.getAttribute('x'))).toEqual(['0', '1']);
  });

  it('clear() restores the defs and frees the cell budget again', () => {
    const strip = new CycleStrip(svg, 2, true);
    strip.add(scored(true, 'ok'));
    strip.add(scored(true, 'ok'));
    strip.clear();
    expect(rects()).toHaveLength(0);
    expect(svg.querySelector('pattern#refused-hatch')).not.toBeNull();
    strip.add(scored(false, 'off-cadence'));
    expect(rects()).toHaveLength(1);
    expect(rects()[0]?.getAttribute('x')).toBe('0');
  });
});

describe('stripSvg', () => {
  it('keeps a minimum viewBox width of 1 for an empty series', () => {
    const svg = stripSvg([]);
    expect(svg).toContain('viewBox="0 0 1 20"');
    expect(attrs(svg, 'rect')).toHaveLength(0);
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('id="refused-hatch"');
  });

  it('sizes the viewBox to the cycle count', () => {
    expect(stripSvg([scored(true, 'ok'), scored(true, 'ok'), scored(true, 'ok')])).toContain(
      'viewBox="0 0 3 20"',
    );
  });

  it('renders credited cycles full height and refusals as an unfilled gap', () => {
    const svg = stripSvg([scored(true, 'ok'), scored(false, 'too-slow')]);
    const [ok, refused] = attrs(svg, 'rect');
    expect(ok).toMatchObject({
      x: '0',
      y: '0',
      width: '0.85',
      height: '20',
      fill: 'var(--zone-in)',
      stroke: 'var(--zone-in)',
      'stroke-width': '0.1',
    });
    expect(refused).toMatchObject({
      x: '1',
      y: '5.5',
      width: '0.85',
      height: '9',
      fill: 'none',
      stroke: 'var(--refused)',
      'stroke-width': '0.15',
    });
    // An ABSENCE: unfilled and shorter than the credited cell.
    expect(Number(refused?.height)).toBeLessThan(Number(ok?.height));
    expect(refused?.fill).toBe('none');
    expect(svg).not.toMatch(RED);
  });

  it('never paints a refusal red, for any of the five refusal reasons', () => {
    const svg = stripSvg(REFUSAL_REASONS.map((r) => scored(false, r)));
    const cells = attrs(svg, 'rect');
    expect(cells).toHaveLength(REFUSAL_REASONS.length);
    for (const c of cells) {
      expect(c.fill).toBe('none');
      expect(c.stroke).toBe('var(--refused)');
    }
    expect(svg).not.toMatch(RED);
  });
});
