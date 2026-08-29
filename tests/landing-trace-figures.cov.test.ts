// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  TRACE,
  CREDITED_COUNT,
  CHAPTERS,
  ILLUSTRATION_CARD,
  chapterFor,
  peakLabel,
} from '../src/landing/trace.ts';
import { bandFigure, reportFigure } from '../src/landing/figures.ts';
import { refusalSentence, REPORT_FOOTER } from '../src/ui/copy.ts';
import { ALL_OUTCOMES } from '../src/dsp/types.ts';

/**
 * The two static figures on `/`, and the two trace helpers the page renders
 * them through.
 *
 * `tests/landing.test.ts` pins what the TRACE means. This file pins what the
 * page actually EMITS from it — every circle, every tick, every wireframe row —
 * because the landing figures are the only place those numbers become geometry,
 * and a picture that quietly stops agreeing with `scoreCycle` is exactly the
 * drift the module's own comments claim is impossible.
 *
 * Geometry is recomputed here from `ILLUSTRATION_CARD` and the viewBox the SVG
 * declares, never copied out of the emitted string, so a changed velocity floor
 * moves both the assertion and the drawing or the test fails.
 */

/* ── The plot's own geometry, restated from the emitted viewBox ───────────── */

const W = 340;
const H = 170;
const PLOT_TOP = 18;
const PLOT_BOTTOM = 152;
const FLOOR = ILLUSTRATION_CARD.peakVelocityFloor.value;
const CEILING = ILLUSTRATION_CARD.peakVelocityCeiling.value;
const V_MAX = CEILING + FLOOR;

const yFor = (v: number): number => PLOT_BOTTOM - (v / V_MAX) * (PLOT_BOTTOM - PLOT_TOP);

function render(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

describe('peakLabel — one rounding rule for the strip, the tooltip and the sentence', () => {
  it('is the same rounding refusalSentence prints, on every refused cycle', () => {
    // The docblock's claim is that the tooltip cannot disagree with the
    // sentence. That only holds if `peakLabel` reproduces the rounding
    // `refusalSentence` applies internally — so check it against the sentences
    // the real copy module produced, not against a remembered string.
    const velocityRefusals = TRACE.filter((c) => c.reason === 'too-slow' || c.reason === 'too-fast');
    expect(velocityRefusals.length).toBe(3);
    for (const c of velocityRefusals) {
      expect(c.sentence).toContain(`measured ${peakLabel(c.peakOmega)} °/s`);
    }
  });

  it('rounds to the whole degree, half away from zero', () => {
    expect(peakLabel(100.53096491487338)).toBe('101');
    expect(peakLabel(376.99111843077515)).toBe('377');
    expect(peakLabel(251.32741228718345)).toBe('251');
    expect(peakLabel(0.5)).toBe('1');
    expect(peakLabel(2.5)).toBe('3');
    expect(peakLabel(0)).toBe('0');
    // No unit, no decimal point, no thousands separator — the callers add the
    // unit, and a label that carried one would print "101 °/s °/s".
    expect(peakLabel(1234.5)).toBe('1235');
  });
});

describe('the trace takes its words from the shipped copy module', () => {
  it('reproduces refusalSentence exactly for every cycle, credited or not', () => {
    // `sentence` is not written in trace.ts; it is `refusalSentence` applied to
    // the same `Cycle` that went into `scoreCycle`. Re-deriving it here from
    // `src/ui/copy.ts` is what proves the words on `/` are the words on the
    // instrument rather than a landing-page paraphrase of them.
    for (const c of TRACE) {
      const expected = c.credited ? '' : refusalSentence(c.reason, c.scored, ILLUSTRATION_CARD);
      expect(c.sentence, `cycle ${c.index} (${c.reason})`).toBe(expected);
    }
    expect(TRACE.filter((c) => c.sentence === '').length).toBe(CREDITED_COUNT);
  });
});

describe('chapterFor — the narration is read off the dial, not off an index range', () => {
  it('returns the chapter for the outcome scoreCycle actually returned', () => {
    for (const c of TRACE) {
      // Identity, not deep equality: the panel must hand out the very object in
      // CHAPTERS, so there is no second copy of the narration to drift.
      expect(chapterFor(c.index), `cycle ${c.index}`).toBe(CHAPTERS[c.reason]);
    }
    // Every chapter in the record is reachable from some cycle, which is the
    // selector's precondition.
    const reached = new Set(TRACE.map((c) => chapterFor(c.index).title));
    expect(reached.size).toBe(ALL_OUTCOMES.length);
  });

  it('falls back to the first cycle rather than throwing on an out-of-range index', () => {
    // The replay drives this with a counter; a stale timer firing one tick past
    // the end must not take the page down.
    const first = CHAPTERS[(TRACE[0] as (typeof TRACE)[number]).reason];
    expect(first).toBe(CHAPTERS['too-slow']);
    expect(chapterFor(TRACE.length)).toBe(first);
    expect(chapterFor(TRACE.length + 99)).toBe(first);
    expect(chapterFor(-1)).toBe(first);
    expect(chapterFor(Number.NaN)).toBe(first);
    // And 0 itself goes through the found branch, not the fallback — same
    // answer, different path, so the two are pinned separately.
    expect(chapterFor(0)).toBe(first);
  });
});

describe('bandFigure — the plot is a view of TRACE, not a second drawing', () => {
  let fig: HTMLElement;
  let circles: SVGCircleElement[];

  beforeEach(() => {
    fig = render(bandFigure());
    circles = Array.from(fig.querySelectorAll('circle'));
  });

  it('plots exactly one dot per cycle, at the x-step the viewBox implies', () => {
    expect(circles.length).toBe(TRACE.length);
    const svg = fig.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${W} ${H}`);

    const step = (W - 46) / TRACE.length;
    circles.forEach((dot, i) => {
      expect(dot.getAttribute('cx')).toBe((34 + step * (i + 0.5)).toFixed(1));
      expect(dot.getAttribute('r')).toBe('6');
    });
    // Left-to-right, inside the axes, never touching them.
    const xs = circles.map((d) => Number(d.getAttribute('cx')));
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(Math.min(...xs)).toBeGreaterThan(34);
    expect(Math.max(...xs)).toBeLessThan(W - 12);
  });

  it('puts every dot at the height its own peakOmega maps to', () => {
    circles.forEach((dot, i) => {
      const c = TRACE[i] as (typeof TRACE)[number];
      expect(dot.getAttribute('cy'), `cycle ${i}`).toBe(yFor(c.peakOmega).toFixed(1));
    });
    // The mapping is the one that makes the picture argue: the two lazy reps
    // sit BELOW the floor line, the over-correction ABOVE the ceiling line,
    // and the in-band ones between them. (y grows downward.)
    const yFloor = yFor(FLOOR);
    const yCeiling = yFor(CEILING);
    expect(yCeiling).toBeLessThan(yFloor);
    for (const [i, dot] of circles.entries()) {
      const c = TRACE[i] as (typeof TRACE)[number];
      const y = Number(dot.getAttribute('cy'));
      if (c.peakOmega < FLOOR) expect(y, `cycle ${i}`).toBeGreaterThan(yFloor);
      else if (c.peakOmega > CEILING) expect(y, `cycle ${i}`).toBeLessThan(yCeiling);
      else {
        expect(y, `cycle ${i}`).toBeLessThanOrEqual(yFloor);
        expect(y, `cycle ${i}`).toBeGreaterThanOrEqual(yCeiling);
      }
    }
  });

  it('draws a refusal as an absence — an outlined ring, never a filled red dot', () => {
    const filled = circles.filter((d) => d.getAttribute('fill') === 'var(--zone-in)');
    const rings = circles.filter((d) => d.getAttribute('fill') === 'none');
    expect(filled.length).toBe(CREDITED_COUNT);
    expect(filled.length + rings.length).toBe(TRACE.length);

    circles.forEach((dot, i) => {
      const c = TRACE[i] as (typeof TRACE)[number];
      if (c.credited) {
        expect(dot.getAttribute('fill'), `cycle ${i}`).toBe('var(--zone-in)');
        expect(dot.getAttribute('stroke'), `cycle ${i}`).toBeNull();
      } else {
        expect(dot.getAttribute('fill'), `cycle ${i}`).toBe('none');
        expect(dot.getAttribute('stroke'), `cycle ${i}`).toBe('var(--refused)');
        expect(dot.getAttribute('stroke-width'), `cycle ${i}`).toBe('2');
      }
    });
    // Nothing in the plot is filled with the refusal hue anywhere.
    expect(bandFigure()).not.toContain('fill="var(--refused)"');
  });

  it('slashes only the doubted dot — the one that sits inside the band and is refused anyway', () => {
    const doubtedIndex = TRACE.findIndex((c) => c.reason === 'low-confidence');
    expect(doubtedIndex).toBeGreaterThanOrEqual(0);
    const doubted = TRACE[doubtedIndex] as (typeof TRACE)[number];

    // The slash is the only <line> that is not axis or band furniture: pick it
    // out by its own stroke width rather than by position in the string.
    const slashes = Array.from(fig.querySelectorAll('line')).filter(
      (l) => l.getAttribute('stroke-width') === '1.8',
    );
    expect(slashes.length).toBe(1);

    const slash = slashes[0] as SVGLineElement;
    const x = Number((circles[doubtedIndex] as SVGCircleElement).getAttribute('cx'));
    const y = yFor(doubted.peakOmega);
    expect(slash.getAttribute('x1')).toBe((x - 8).toFixed(1));
    expect(slash.getAttribute('y1')).toBe((y + 8).toFixed(1));
    expect(slash.getAttribute('x2')).toBe((x + 8).toFixed(1));
    expect(slash.getAttribute('y2')).toBe((y - 8).toFixed(1));
    expect(slash.getAttribute('stroke')).toBe('var(--refused)');

    // It earns the extra mark because it is indistinguishable by position: the
    // dot is inside the prescribed band and still refused.
    expect(doubted.peakOmega).toBeGreaterThan(FLOOR);
    expect(doubted.peakOmega).toBeLessThan(CEILING);
    // The other refusals are NOT slashed — their position already says why.
    expect(TRACE.filter((c) => !c.credited).length).toBeGreaterThan(1);
  });

  it('washes the two regions from the card values, at background opacity', () => {
    const rects = Array.from(fig.querySelectorAll('rect'));
    expect(rects.length).toBe(2);
    const [out, inBand] = rects as [SVGRectElement, SVGRectElement];

    // Below the floor, in the out-of-band hue, down to the baseline.
    expect(out.getAttribute('fill')).toBe('var(--zone-out)');
    expect(out.getAttribute('y')).toBe(yFor(FLOOR).toFixed(1));
    expect(out.getAttribute('height')).toBe((PLOT_BOTTOM - yFor(FLOOR)).toFixed(1));
    expect(out.getAttribute('opacity')).toBe('0.18');

    // The prescribed band, in the in-band hue, exactly floor-to-ceiling.
    expect(inBand.getAttribute('fill')).toBe('var(--zone-in)');
    expect(inBand.getAttribute('y')).toBe(yFor(CEILING).toFixed(1));
    expect(inBand.getAttribute('height')).toBe((yFor(FLOOR) - yFor(CEILING)).toFixed(1));
    expect(inBand.getAttribute('opacity')).toBe('0.14');

    // Both washes start at the y axis and stop at the plot's right edge.
    for (const r of rects) {
      expect(r.getAttribute('x')).toBe('34');
      expect(r.getAttribute('width')).toBe(String(W - 46));
    }

    // Neither is load-bearing: colour alone never carries the verdict, so both
    // band edges are also drawn as dashed rules.
    const dashed = Array.from(fig.querySelectorAll('line')).filter((l) => l.getAttribute('stroke-dasharray'));
    expect(dashed.map((l) => l.getAttribute('y1')).sort()).toEqual(
      [yFor(CEILING).toFixed(1), yFor(FLOOR).toFixed(1)].sort(),
    );
    for (const l of dashed) {
      expect(l.getAttribute('y1')).toBe(l.getAttribute('y2'));
      expect(l.getAttribute('stroke')).toBe('var(--zone-in)');
    }
  });

  it('positions the y ticks with the same yFor() the dots use, and marks the two band edges', () => {
    const ticks = Array.from(fig.querySelectorAll('.lp-plot-yaxis span'));
    expect(ticks.map((t) => t.textContent)).toEqual([String(V_MAX), String(CEILING), String(FLOOR), '0']);

    for (const t of ticks) {
      const v = Number(t.textContent);
      // A percentage of the viewBox height, so one number is right at 360 px
      // and at 1920 px.
      expect((t as HTMLElement).style.top).toBe(`${((yFor(v) / H) * 100).toFixed(2)}%`);
      expect(t.classList.contains('tnum')).toBe(true);
    }
    // Only the floor and the ceiling are emphasised — 0 and the top of the
    // scale are not thresholds and must not read as ones.
    const strong = ticks.filter((t) => t.classList.contains('lp-plot-edge')).map((t) => Number(t.textContent));
    expect(strong).toEqual([CEILING, FLOOR]);

    // The axis itself is decorative; the SVG's aria-label carries the content.
    expect(fig.querySelector('.lp-plot-yaxis')?.getAttribute('aria-hidden')).toBe('true');
    expect(fig.querySelector('.lp-plot-xaxis')?.getAttribute('aria-hidden')).toBe('true');
    expect(fig.querySelector('.lp-plot-ylabel')?.textContent).toBe('peak head velocity, °/s');
  });

  it('counts its alt text off TRACE instead of asserting numbers in prose', () => {
    const svg = fig.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('role')).toBe('img');
    const label = svg.getAttribute('aria-label') as string;

    const belowFloor = TRACE.filter((c) => c.peakOmega < FLOOR).length;
    const credited = TRACE.filter((c) => c.credited).length;
    const refusedInBand = TRACE.filter((c) => !c.credited && c.peakOmega >= FLOOR && c.peakOmega <= CEILING).length;

    expect(label).toContain(`${TRACE.length} consecutive cycles`);
    expect(label).toContain(`band of ${FLOOR} to ${CEILING} degrees per second`);
    expect(label).toContain(`${belowFloor} cycles fall below the floor`);
    expect(label).toContain(`${credited} fall inside the band and are credited`);
    expect(label).toContain(`${refusedInBand} fall inside the band but are refused anyway`);
    expect(credited).toBe(CREDITED_COUNT);

    // The blind reader's count of credited dots is the SIGHTED reader's count
    // of filled dots. That is the only reason the alt text is derived at all.
    expect(circles.filter((d) => d.getAttribute('fill') === 'var(--zone-in)').length).toBe(credited);

    // THE REGRESSION THIS TEST EXISTS FOR. `refusedInBand` counts every refusal
    // inside the band — off cadence, low confidence, face lost — and the
    // sentence used to attribute all of them to "low tracking confidence",
    // which is true of exactly one. A sighted reader saw three differently
    // marked dots; a blind reader was told they were the same thing. The clause
    // must now split the total by reason, and the split must add up.
    const lowConfidenceInBand = TRACE.filter(
      (c) => !c.credited && c.reason === 'low-confidence' && c.peakOmega >= FLOOR && c.peakOmega <= CEILING,
    ).length;
    expect(refusedInBand).toBeGreaterThan(lowConfidenceInBand);
    expect(label).toContain(`${lowConfidenceInBand} for low tracking confidence`);
    expect(label).toContain(`${refusedInBand - lowConfidenceInBand} for cadence or a lost face`);
    // ...and it never again claims the whole in-band total is one reason.
    expect(label).not.toContain(`${refusedInBand} inside the band is refused for low tracking confidence`);
    // Plurals are derived too, so "3 ... is" cannot come back.
    expect(label).not.toMatch(/\b(?!1\b)\d+ cycles? inside the band is\b/);
  });

  it('carries no <text> node — every label is real HTML beside the drawing', () => {
    // An SVG text node's font size is in user units, which the 15 px floor
    // cannot see, and it reaches a screen reader as a floating string.
    expect(fig.querySelectorAll('text').length).toBe(0);
    expect(bandFigure()).not.toContain('<text');
    // The visible labels are HTML, and there are the four ticks plus the three
    // x-axis spans plus the three-key legend.
    expect(fig.querySelectorAll('.lp-plot-xaxis span').length).toBe(3);
    expect(fig.querySelectorAll('.lp-legend li').length).toBe(3);
  });

  it('names the series length in the x axis from TRACE, not from a literal', () => {
    const spans = Array.from(fig.querySelectorAll('.lp-plot-xaxis span')).map((s) => s.textContent);
    expect(spans).toEqual(['rep 1', `${TRACE.length} consecutive reps`, `rep ${TRACE.length}`]);
  });

  it('is deterministic — two renders of the same trace are byte-identical', () => {
    expect(bandFigure()).toBe(bandFigure());
  });
});

describe('reportFigure — a wireframe, because a screenshot would carry numbers', () => {
  let fig: HTMLElement;

  beforeEach(() => {
    fig = render(reportFigure());
  });

  it('lists the six report sections, each tagged with how it is drawn', () => {
    const rows = Array.from(fig.querySelectorAll('.lp-rp-row'));
    expect(rows.length).toBe(6);
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual([
      'bar',
      'table',
      'plain', // no `kind` on the gaze row — the `?? 'plain'` default
      'table',
      'plain',
      'body',
    ]);
    expect(rows.map((r) => r.querySelector('.lp-rp-label')?.textContent)).toEqual([
      'Delivered vs prescribed, per block',
      'Refusal histogram',
      'Gaze tally',
      'Symptom entries',
      '“Why?” on every criterion',
      'What this does not measure',
    ]);
    expect(rows.map((r) => r.querySelector('.lp-rp-note')?.textContent)).toEqual([
      'solid fill inside an outlined track',
      'six rows — one per outcome',
      'with chance = 25 % printed beside it',
      "against the card's own stop-rule thresholds",
      'forced open by the print stylesheet',
      'at body size, never fine print',
    ]);

    // One row per gate outcome is what the histogram promises, and the promise
    // is checked against the gate rather than against the word "six".
    expect(ALL_OUTCOMES.length).toBe(6);
    expect(rows[1]?.querySelector('.lp-rp-note')?.textContent).toContain('one per outcome');
  });

  it('carries no numbers a session would have to own', () => {
    // The whole reason this is a wireframe: the only digits allowed are the
    // fixed chance level of the 4-alternative task.
    const text = fig.textContent as string;
    expect(text.match(/\d+/g)).toEqual(['25']);
  });

  it('prints the shipped report footer verbatim, not a landing-page paraphrase', () => {
    const foot = fig.querySelector('.lp-rp-foot .lp-rp-note');
    // Drift check against `src/ui/copy.ts`: the promise the printed report
    // makes about privacy must be the promise `/` shows a reader.
    expect(foot?.textContent).toBe(REPORT_FOOTER);
    expect(REPORT_FOOTER).toContain('no data left this device');
  });

  it('is one labelled image to a screen reader, and the label names every row', () => {
    const page = fig.querySelector('.lp-rp-page') as HTMLElement;
    expect(page.getAttribute('role')).toBe('img');
    const label = page.getAttribute('aria-label') as string;
    for (const fragment of [
      'delivered-versus-prescribed bar',
      'six-row refusal histogram',
      'gaze tally',
      'symptom entries',
      'Why disclosure on every criterion',
      'limitations at body size',
    ]) {
      expect(label, fragment).toContain(fragment);
    }
    expect(fig.querySelector('.wordmark')?.textContent).toBe('Gimbal');
    expect(fig.querySelector('.lp-rp-head .lp-rp-note')?.textContent).toBe(
      'session report · one letter page · monochrome-safe',
    );
  });

  it('escapes every label it interpolates, and is deterministic', () => {
    // No row text is HTML: the rendered document contains exactly the elements
    // the template declares, and nothing a label smuggled in.
    expect(fig.querySelectorAll('*').length).toBe(1 + 1 + 2 + 6 * 3 + 2);
    expect(reportFigure()).toBe(reportFigure());
  });
});
