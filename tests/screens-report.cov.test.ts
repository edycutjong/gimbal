// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderReport } from '../src/ui/screens/report.ts';
import type { ReportProps } from '../src/ui/screens/report.ts';
import type { BlockRow, Criterion, ReportModel } from '../src/report/report.ts';
import { ALL_OUTCOMES } from '../src/dsp/types.ts';
import { LIMITATIONS_LINES, LIMITATIONS_HEADING } from '../src/report/limitations.ts';
import {
  REASON_LABELS,
  GAZE_CHANCE_LINE,
  GAZE_HONESTY_LINE,
  REPORT_FOOTER,
  AUDIO_OFF_REPORT_LINE,
  deliveredSentence,
} from '../src/ui/copy.ts';
import { EXAMPLE_SOURCE } from '../src/protocol/exampleParameters.ts';
import { THEME_KEY } from '../src/store/local.ts';

/**
 * Screen 5 — the report, rendered.
 *
 * The report model is already covered as data by `report.cov.test.ts`; this file
 * is about the ONE PRINTABLE PAGE that comes out of it. Every assertion reads
 * real DOM state out of jsdom — text content, attributes, drawn SVG geometry —
 * rather than substring-matching the template, because the invariants the page
 * carries (delivered against prescribed per block, a refusal histogram, a gaze
 * tally, symptom entries, a "Why?" on every criterion, limitations at body size)
 * are properties of the rendered document, not of the string that produced it.
 */

/* ---------------------------------------------------------------- fixtures */

const SRC = 'synthetic value for a unit test; not a clinical parameter';

function criterion(label: string, value: string, source: string = SRC): Criterion {
  return { label, value, source };
}

function blockRow(overrides: Partial<BlockRow> = {}): BlockRow {
  return {
    index: 0,
    prescribedSeconds: 120,
    deliveredSeconds: 96,
    ratio: 0.8,
    cyclesAttempted: 40,
    cyclesCredited: 30,
    fHatHz: 2.05,
    fHatBinWidthHz: 0.0625,
    gaze: { correct: 8, total: 10, chance: 0.25, binomialP: 0.0004158, demonstrated: true },
    pauseNote: null,
    interrupted: false,
    ...overrides,
  };
}

const COUNTS = [30, 4, 3, 2, 1, 0];

function model(overrides: Partial<ReportModel> = {}): ReportModel {
  return {
    startedAt: '2026-01-01T09:07:00.000Z',
    cardId: 'card-abc',
    appVersion: '1.3.0',
    methodsRev: 'methods-7',
    prescription: [
      criterion('Frequency band', '1.7–2.3 Hz'),
      criterion('Peak velocity floor', '150 °/s'),
      criterion('Block length', '120 s'),
    ],
    blocks: [blockRow()],
    totals: { prescribedSeconds: 120, deliveredSeconds: 96, ratio: 0.8 },
    outcomes: ALL_OUTCOMES.map((reason, i) => ({
      reason,
      count: COUNTS[i] as number,
      share: (COUNTS[i] as number) / 40,
    })),
    symptom: { baseline: 2, gates: [{ afterBlock: 0, rating: 3, ruling: 'continue' }], final: 4 },
    conditions: { medianFps: 29.7, cameraLabel: 'Integrated Camera', resolution: '640x480' },
    audioOff: false,
    isExample: false,
    saturatedCycles: 0,
    ...overrides,
  };
}

interface Rendered {
  host: HTMLElement;
  print: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
  ledger: ReturnType<typeof vi.fn>;
}

function render(overrides: Partial<ReportModel> = {}, theme: ReportProps['theme'] = null): Rendered {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const print = vi.fn();
  const download = vi.fn();
  const ledger = vi.fn();
  renderReport(host, { model: model(overrides), theme, onPrint: print, onDownload: download, onLedger: ledger });
  return { host, print, download, ledger };
}

/** Collapses the template's own indentation so assertions state sentences, not whitespace. */
const squish = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();

const texts = (root: ParentNode, selector: string): string[] =>
  Array.from(root.querySelectorAll(selector)).map((n) => squish(n.textContent));

/** The `<section>` whose `<h2>` is exactly this heading. */
function band(host: HTMLElement, heading: string): HTMLElement {
  const found = Array.from(host.querySelectorAll<HTMLElement>('section.report-band')).find(
    (s) => squish(s.querySelector('h2')?.textContent) === heading,
  );
  if (!found) throw new Error(`no report band headed "${heading}"`);
  return found;
}

/** The width of a `<rect>` a browser would paint, as the template wrote it. */
const rectWidths = (svg: Element): string[] =>
  Array.from(svg.querySelectorAll('rect')).map((r) => r.getAttribute('width') ?? '');

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
  globalThis.localStorage?.clear();
});

/* ------------------------------------------------------------- the document */

describe('renderReport — the document', () => {
  it('renders one report article under a settings row, with the title focusable for the router', () => {
    const { host } = render();
    expect(host.querySelectorAll('article.report')).toHaveLength(1);
    expect(host.querySelectorAll('.settings-row')).toHaveLength(1);
    const h1 = host.querySelector('h1');
    expect(h1?.id).toBe('screen-title');
    expect(h1?.getAttribute('tabindex')).toBe('-1');
    expect(squish(h1?.textContent)).toBe('Gaze stabilization (VORx1, yaw) — home session report');
    expect(squish(host.querySelector('.eyebrow')?.textContent)).toBe('For your clinician');
  });

  it('splits the ISO start time into a printed date and a printed clock time', () => {
    const { host } = render({ startedAt: '2026-01-01T09:07:00.000Z' });
    const caption = squish(host.querySelector('article.report > .caption')?.textContent);
    expect(caption).toBe('2026-01-01 09:07 · card card-abc · 1.3.0 · methods-7');
    expect(squish(host.querySelector('article.report code')?.textContent)).toBe('card-abc');
  });

  it('states on its own face that no parameter on the page originated in Gimbal', () => {
    const { host } = render();
    expect(texts(host, 'article.report > .caption')).toContain(
      "Parameters entered by the patient from their clinician's handout. Gimbal did not originate any parameter on this page.",
    );
  });

  it('escapes identity fields rather than letting them become markup', () => {
    const { host } = render({ cardId: '<img src=x>&"', appVersion: '<b>1.0</b>', methodsRev: 'rev "7"' });
    expect(host.querySelector('article.report img')).toBeNull();
    expect(host.querySelector('article.report b')).toBeNull();
    expect(squish(host.querySelector('article.report code')?.textContent)).toBe('<img src=x>&"');
    expect(squish(host.querySelector('article.report > .caption')?.textContent)).toContain('<b>1.0</b> · rev "7"');
  });

  it('prints the footer that disclaims the device and the network', () => {
    const { host } = render();
    expect(texts(host, '.caption')).toContain(REPORT_FOOTER);
  });

  it('marks only the chrome as no-print, so the article itself is the printable page', () => {
    const { host } = render();
    expect(texts(host, '.no-print')).toHaveLength(2);
    expect(host.querySelector('.settings-row')?.classList.contains('no-print')).toBe(true);
    expect(host.querySelector('.button-row')?.classList.contains('no-print')).toBe(true);
    expect(host.querySelector('article.report')?.classList.contains('no-print')).toBe(false);
    expect(host.querySelector('article.report .no-print')).toBe(host.querySelector('.button-row'));
  });

  it('shows the EXAMPLE banner only for an example session', () => {
    const shown = render({ isExample: true }).host;
    expect(squish(shown.querySelector('.example-banner .chip')?.textContent)).toBe('EXAMPLE');
    expect(squish(shown.querySelector('.example-banner')?.textContent)).toBe(
      'EXAMPLE This report is from a session recorded by the developer while building Gimbal. ' +
        'It is a real recording of real exercise — not patient data, and not a clinical trial.',
    );

    document.body.innerHTML = '';
    expect(render({ isExample: false }).host.querySelector('.example-banner')).toBeNull();
  });
});

/* ------------------------------------------------------------- prescription */

describe('renderReport — prescription table', () => {
  it('gives every criterion a value, a numbered citation marker and a "Why?" disclosure', () => {
    const { host } = render({
      prescription: [criterion('Frequency band', '1.7–2.3 Hz'), criterion('Block length', '120 s')],
    });
    const rows = Array.from(band(host, 'Prescription').querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => squish(r.querySelector('th')?.textContent))).toEqual([
      'Frequency band1',
      'Block length1',
    ]);
    expect(rows.map((r) => squish(r.querySelector('th sup')?.textContent))).toEqual(['1', '1']);
    expect(rows.map((r) => squish(r.querySelector('td.num')?.textContent))).toEqual(['1.7–2.3 Hz', '120 s']);
    for (const row of rows) {
      const details = row.querySelector('details');
      expect(squish(details?.querySelector('summary')?.textContent)).toBe('Why?');
      expect(squish(details?.querySelector('.disclosure-body')?.textContent)).toBe(SRC);
    }
  });

  it('numbers the markers by distinct source, so two criteria from one source share a citation', () => {
    const { host } = render({
      prescription: [
        criterion('A', '1', 'source one'),
        criterion('B', '2', 'source two'),
        criterion('C', '3', 'source one'),
      ],
    });
    expect(texts(band(host, 'Prescription'), 'tbody th sup')).toEqual(['1', '2', '1']);
    expect(texts(host, '.citations li')).toEqual(['source one', 'source two']);
  });

  it('is a real table: scoped header cells, a caption, and a column header row', () => {
    const { host } = render();
    const table = band(host, 'Prescription').querySelector('table');
    expect(squish(table?.querySelector('caption')?.textContent)).toBe(
      "Every number here was typed in from a clinician's handout, with its source.",
    );
    expect(texts(table as ParentNode, 'thead th[scope="col"]')).toEqual(['Parameter', 'Value', 'Source']);
    expect(table?.querySelectorAll('tbody th[scope="row"]')).toHaveLength(3);
  });

  it('carries the EXAMPLE source string onto the paper, in the disclosure and in the source list', () => {
    const { host } = render({
      isExample: true,
      prescription: [criterion('Frequency band', '1.7–2.3 Hz', EXAMPLE_SOURCE)],
    });
    expect(squish(host.querySelector('.disclosure-body')?.textContent)).toBe(squish(EXAMPLE_SOURCE));
    expect(texts(host, '.citations li')).toEqual([squish(EXAMPLE_SOURCE)]);
    expect(squish(host.querySelector('.citations li')?.textContent)).toContain('EXAMPLE —');
  });

  it('escapes a criterion label, value and source', () => {
    const { host } = render({ prescription: [criterion('<b>label</b>', '<i>9</i>', '<script>x</script>')] });
    const row = band(host, 'Prescription').querySelector('tbody tr');
    expect(row?.querySelector('b')).toBeNull();
    expect(row?.querySelector('i')).toBeNull();
    expect(host.querySelector('script')).toBeNull();
    expect(squish(row?.querySelector('td.num')?.textContent)).toBe('<i>9</i>');
    expect(squish(row?.querySelector('.disclosure-body')?.textContent)).toBe('<script>x</script>');
  });
});

/* -------------------------------------------------- delivered vs prescribed */

describe('renderReport — delivered against prescribed', () => {
  it('draws one block row per block with the delivered sentence and the achieved percentage', () => {
    const { host } = render({
      blocks: [
        blockRow({ index: 0, prescribedSeconds: 120, deliveredSeconds: 96, ratio: 0.8 }),
        blockRow({ index: 1, prescribedSeconds: 120, deliveredSeconds: 30, ratio: 0.25 }),
      ],
    });
    expect(texts(band(host, 'Delivered against prescribed'), '.block-row p')).toEqual([
      'Block 1 — delivered 1.6 of the prescribed 2.0 minutes (80 %)',
      'Block 2 — delivered 0.5 of the prescribed 2.0 minutes (25 %)',
    ]);
  });

  it('names an interrupted block and a paused block, and stays silent when neither happened', () => {
    const { host } = render({
      blocks: [
        blockRow({ index: 0, interrupted: true, pauseNote: null }),
        blockRow({ index: 1, interrupted: false, pauseNote: 'paused 2× (15 s)' }),
        blockRow({ index: 2, interrupted: true, pauseNote: 'paused 1× (4 s)' }),
        blockRow({ index: 3, interrupted: false, pauseNote: null }),
      ],
    });
    const rows = texts(band(host, 'Delivered against prescribed'), '.block-row p');
    expect(rows[0]).toBe('Block 1 — delivered 1.6 of the prescribed 2.0 minutes (80 %) · interrupted');
    expect(rows[1]).toBe('Block 2 — delivered 1.6 of the prescribed 2.0 minutes (80 %) · paused 2× (15 s)');
    expect(rows[2]).toBe(
      'Block 3 — delivered 1.6 of the prescribed 2.0 minutes (80 %) · interrupted · paused 1× (4 s)',
    );
    expect(rows[3]).toBe('Block 4 — delivered 1.6 of the prescribed 2.0 minutes (80 %)');
    expect(band(host, 'Delivered against prescribed').querySelectorAll('.block-row p strong')).toHaveLength(6);
  });

  it('escapes the pause note', () => {
    const { host } = render({ blocks: [blockRow({ pauseNote: 'paused <b>2×</b>' })] });
    expect(host.querySelector('.block-row b')).toBeNull();
    expect(texts(host, '.block-row p')[0]).toContain('· paused <b>2×</b>');
  });

  it('draws the delivered fill inside the prescribed track, with an end tick and no colour dependence', () => {
    const { host } = render({ blocks: [blockRow({ deliveredSeconds: 96, prescribedSeconds: 120 })] });
    const svg = host.querySelector('svg.dose-bar');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe(deliveredSentence(96, 120));
    // Outlined prescribed track first, then the solid delivered fill: 0.8 × 99.
    expect(rectWidths(svg as Element)).toEqual(['99', '79.20']);
    expect(svg?.querySelector('rect')?.getAttribute('fill')).toBe('none');
    expect(svg?.querySelectorAll('line')).toHaveLength(1);
    expect(svg?.querySelector('line')?.getAttribute('x1')).toBe('99');
  });

  it('draws an empty bar rather than a NaN one when nothing was prescribed', () => {
    const { host } = render({ blocks: [blockRow({ deliveredSeconds: 0, prescribedSeconds: 0, ratio: 0 })] });
    expect(rectWidths(host.querySelector('svg.dose-bar') as Element)).toEqual(['99', '0.00']);
  });

  it('clamps the fill to the prescribed track when more was delivered than prescribed', () => {
    const { host } = render({
      blocks: [blockRow({ deliveredSeconds: 300, prescribedSeconds: 120, ratio: 2.5 })],
    });
    expect(rectWidths(host.querySelector('svg.dose-bar') as Element)).toEqual(['99', '99.00']);
    expect(texts(host, '.block-row p')[0]).toContain('(250 %)');
  });

  it('clamps a negative delivered figure to an empty fill', () => {
    const { host } = render({
      blocks: [blockRow({ deliveredSeconds: -10, prescribedSeconds: 120, ratio: 0 })],
    });
    expect(rectWidths(host.querySelector('svg.dose-bar') as Element)).toEqual(['99', '0.00']);
  });

  it('totals the session in the same sentence and refuses to quote a confidence interval for it', () => {
    const { host } = render({ totals: { prescribedSeconds: 240, deliveredSeconds: 96, ratio: 0.4 } });
    const section = band(host, 'Delivered against prescribed');
    expect(squish(section.querySelector('.dose-total')?.textContent)).toBe(deliveredSentence(96, 240));
    expect(section.querySelector('.dose-total')?.classList.contains('tnum')).toBe(true);
    expect(squish(section.querySelector('.caption')?.textContent)).toBe(
      'Delivered dose is a count of credited cycle seconds. It is exact by construction, ' +
        'so no confidence interval is quoted for it.',
    );
  });
});

/* ------------------------------------------------------------ the histogram */

describe('renderReport — refusal histogram', () => {
  it('prints all six outcome rows with counts, shares and a bar', () => {
    const { host } = render();
    const section = band(host, 'Every cycle, and what happened to it');
    const rows = Array.from(section.querySelectorAll('tr.histogram-row'));
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => squish(r.querySelector('th')?.textContent))).toEqual(
      ALL_OUTCOMES.map((r) => REASON_LABELS[r]),
    );
    expect(rows.map((r) => squish(r.querySelectorAll('td.num')[0]?.textContent))).toEqual(
      COUNTS.map((c) => String(c)),
    );
    expect(rows.map((r) => squish(r.querySelectorAll('td.num')[1]?.textContent))).toEqual([
      '75.0 %',
      '10.0 %',
      '7.5 %',
      '5.0 %',
      '2.5 %',
      '0.0 %',
    ]);
    expect(rows.map((r) => rectWidths(r.querySelector('svg.histogram-bar') as Element)[0])).toEqual([
      '74.25',
      '9.90',
      '7.42',
      '4.95',
      '2.48',
      '0.00',
    ]);
    expect(section.querySelector('svg.histogram-bar')?.getAttribute('aria-hidden')).toBe('true');
    expect(squish(section.querySelector('caption')?.textContent)).toBe(
      'Six outcome rows. Five of them are refusals. A refused cycle added exactly 0.000 seconds.',
    );
  });

  it('names the two instrument conditions and says nothing about saturation when none occurred', () => {
    const { host } = render({ saturatedCycles: 0 });
    expect(squish(band(host, 'Every cycle, and what happened to it').querySelector('.caption')?.textContent)).toBe(
      '“Tracking unreliable” and “face left the frame” are instrument conditions, not patient performance.',
    );
  });

  it('reports a single saturated cycle in the singular', () => {
    const { host } = render({ saturatedCycles: 1 });
    expect(squish(band(host, 'Every cycle, and what happened to it').querySelector('.caption')?.textContent)).toBe(
      '“Tracking unreliable” and “face left the frame” are instrument conditions, not patient performance. ' +
        "1 cycle exceeded the instrument's measurable range and was refused rather than clipped.",
    );
  });

  it('reports several saturated cycles in the plural', () => {
    const { host } = render({ saturatedCycles: 3 });
    expect(squish(band(host, 'Every cycle, and what happened to it').querySelector('.caption')?.textContent)).toBe(
      '“Tracking unreliable” and “face left the frame” are instrument conditions, not patient performance. ' +
        "3 cycles exceeded the instrument's measurable range and were refused rather than clipped.",
    );
  });
});

/* ---------------------------------------------------------------- gaze */

describe('renderReport — gaze verification', () => {
  it('tallies correct over shown per block and states the ruling in words, not colour', () => {
    const { host } = render({
      blocks: [
        blockRow({ index: 0, gaze: { correct: 8, total: 10, chance: 0.25, binomialP: 0.0004, demonstrated: true } }),
        blockRow({ index: 1, gaze: { correct: 0, total: 0, chance: 0.25, binomialP: 1, demonstrated: false } }),
      ],
    });
    const rows = Array.from(band(host, 'Gaze verification').querySelectorAll('tbody tr'));
    expect(rows.map((r) => squish(r.querySelector('th[scope="row"]')?.textContent))).toEqual(['Block 1', 'Block 2']);
    expect(rows.map((r) => squish(r.querySelectorAll('td.num')[0]?.textContent))).toEqual(['8', '0']);
    expect(rows.map((r) => squish(r.querySelectorAll('td.num')[1]?.textContent))).toEqual(['10', '0']);
    expect(rows.map((r) => squish(r.querySelectorAll('td')[2]?.textContent))).toEqual([
      'distinguishable from guessing',
      'gaze verification not demonstrated for this block',
    ]);
  });

  it('prints the chance rate as the table caption and the honesty line beneath it', () => {
    const { host } = render();
    const section = band(host, 'Gaze verification');
    expect(squish(section.querySelector('caption')?.textContent)).toBe(GAZE_CHANCE_LINE);
    expect(squish(section.querySelector('.caption')?.textContent)).toBe(GAZE_HONESTY_LINE);
    expect(GAZE_HONESTY_LINE).toContain('does not measure eye movement');
  });
});

/* ----------------------------------------------------------- frequency */

describe('renderReport — frequency compliance', () => {
  it('prints the measured frequency with the resolution it carries', () => {
    const { host } = render({ blocks: [blockRow({ fHatHz: 2.05, fHatBinWidthHz: 0.0625 })] });
    const cells = texts(band(host, 'Frequency compliance'), 'tbody td.num');
    expect(cells).toEqual(['2.05 Hz', '± 0.063 Hz']);
  });

  it('prints an em dash rather than NaN when no frequency could be estimated', () => {
    const { host } = render({
      blocks: [
        blockRow({ index: 0, fHatHz: Number.NaN, fHatBinWidthHz: 0.0625 }),
        blockRow({ index: 1, fHatHz: Number.POSITIVE_INFINITY, fHatBinWidthHz: 0.125 }),
      ],
    });
    const cells = texts(band(host, 'Frequency compliance'), 'tbody td.num');
    expect(cells).toEqual(['— Hz', '± 0.063 Hz', '— Hz', '± 0.125 Hz']);
  });
});

/* ------------------------------------------------------------- symptoms */

describe('renderReport — symptom entries', () => {
  it('prints the baseline, every gate ruling and the end-of-session rating', () => {
    const { host } = render({
      symptom: {
        baseline: 2,
        gates: [
          { afterBlock: 0, rating: 3, ruling: 'continue' },
          { afterBlock: 1, rating: 6, ruling: 'stopped: rose 4 over baseline' },
        ],
        final: 4,
      },
    });
    const rows = Array.from(band(host, 'Symptom entries').querySelectorAll('tbody tr'));
    expect(rows.map((r) => squish(r.querySelector('th')?.textContent))).toEqual([
      'Before the session',
      'After block 1',
      'After block 2',
      'End of session',
    ]);
    expect(rows.map((r) => squish(r.querySelector('td.num')?.textContent))).toEqual(['2/10', '3/10', '6/10', '4/10']);
    expect(rows.map((r) => squish(r.querySelectorAll('td')[1]?.textContent))).toEqual([
      'baseline',
      'continue',
      'stopped: rose 4 over baseline',
      'recorded',
    ]);
  });

  it('records a final rating of zero rather than dropping the row', () => {
    const { host } = render({ symptom: { baseline: 0, gates: [], final: 0 } });
    const rows = Array.from(band(host, 'Symptom entries').querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(2);
    expect(squish(rows[1]?.textContent)).toBe('End of session0/10recorded');
  });

  it('omits the end-of-session row when no final rating was given', () => {
    const { host } = render({
      symptom: { baseline: 2, gates: [{ afterBlock: 0, rating: 3, ruling: 'continue' }], final: null },
    });
    const rows = Array.from(band(host, 'Symptom entries').querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(2);
    expect(texts(band(host, 'Symptom entries'), 'tbody th')).toEqual(['Before the session', 'After block 1']);
  });

  it('escapes a gate ruling', () => {
    const { host } = render({
      symptom: { baseline: 1, gates: [{ afterBlock: 0, rating: 9, ruling: '<em>stopped</em>' }], final: null },
    });
    expect(band(host, 'Symptom entries').querySelector('em')).toBeNull();
    expect(texts(band(host, 'Symptom entries'), 'tbody tr')[1]).toBe('After block 1 9/10<em>stopped</em>');
  });
});

/* ------------------------------------------------------------ conditions */

describe('renderReport — measured conditions', () => {
  it('prints the measured frame rate, camera and capture resolution', () => {
    const { host } = render({
      conditions: { medianFps: 29.74, cameraLabel: 'Integrated Camera', resolution: '640x480' },
    });
    expect(squish(band(host, 'Measured conditions').querySelector('p')?.textContent)).toBe(
      'Effective frame rate 29.7 fps (median inter-frame interval, measured — not the rate the camera reports). ' +
        'Camera Integrated Camera, capture 640x480.',
    );
  });

  it('escapes the camera label and resolution', () => {
    const { host } = render({
      conditions: { medianFps: 30, cameraLabel: '<img src=x onerror=1>', resolution: '"640x480"' },
    });
    expect(band(host, 'Measured conditions').querySelector('img')).toBeNull();
    expect(squish(band(host, 'Measured conditions').querySelector('p')?.textContent)).toContain(
      'Camera <img src=x onerror=1>, capture "640x480".',
    );
  });

  it('says the session was coached without audio only when it was, and says it in bold', () => {
    const { host } = render({ audioOff: true });
    const strong = band(host, 'Measured conditions').querySelector('p strong');
    expect(squish(strong?.textContent)).toBe(AUDIO_OFF_REPORT_LINE);

    document.body.innerHTML = '';
    const off = render({ audioOff: false }).host;
    expect(band(off, 'Measured conditions').querySelectorAll('p')).toHaveLength(1);
    expect(squish(off.textContent)).not.toContain('coached without audio');
  });
});

/* -------------------------------------------------- limitations and sources */

describe('renderReport — limitations and sources', () => {
  it('prints the canonical limitations verbatim, one paragraph per line, under its own heading', () => {
    const { host } = render();
    const box = host.querySelector('.honesty-box');
    expect(squish(box?.querySelector('h2')?.textContent)).toBe(LIMITATIONS_HEADING);
    const paragraphs = Array.from(box?.querySelectorAll('p') ?? []).map((p) => p.textContent ?? '');
    // Byte-identical to the canonical array — U-LIMITS compares five copies of it.
    expect(paragraphs).toEqual([...LIMITATIONS_LINES]);
    expect(paragraphs).toHaveLength(11);
  });

  it('renders the limitations at body size — no paragraph is marked as caption or small print', () => {
    const { host } = render();
    const box = host.querySelector('.honesty-box') as HTMLElement;
    expect(box.classList.contains('report-band')).toBe(true);
    for (const p of Array.from(box.querySelectorAll('p'))) {
      expect(p.className).toBe('');
      expect(p.querySelector('small')).toBeNull();
      expect(p.closest('.caption')).toBeNull();
    }
    expect(box.querySelectorAll('small')).toHaveLength(0);
  });

  it('lists each distinct source once, in first-use order, at body size', () => {
    const { host } = render({
      prescription: [
        criterion('A', '1', 'source two'),
        criterion('B', '2', 'source one'),
        criterion('C', '3', 'source two'),
      ],
    });
    const list = host.querySelector('ol.citations') as HTMLElement;
    expect(texts(list, 'li')).toEqual(['source two', 'source one']);
    for (const li of Array.from(list.querySelectorAll('li'))) {
      expect(li.className).toBe('');
      expect(li.querySelector('small')).toBeNull();
    }
    expect(squish(band(host, 'Sources').querySelector('.caption')?.textContent)).toBe(
      'The full reference list, with author, year, title and section for every source, is in METHODS.md.',
    );
  });

  it('escapes a source in the citation list', () => {
    const { host } = render({ prescription: [criterion('A', '1', '<b>Author</b> & co')] });
    expect(host.querySelector('.citations b')).toBeNull();
    expect(texts(host, '.citations li')).toEqual(['<b>Author</b> & co']);
  });

  it('caps the printed reference list at the eight-citation budget', () => {
    const prescription = Array.from({ length: 9 }, (_, i) => criterion(`Field ${i}`, String(i), `source ${i}`));
    const { host } = render({ prescription });
    expect(texts(host, '.citations li')).toEqual([
      'source 0',
      'source 1',
      'source 2',
      'source 3',
      'source 4',
      'source 5',
      'source 6',
      'source 7',
    ]);
    // The ninth source is off the printed list, so it gets NO marker at all.
    // It used to render `<sup>0</sup>` — a footnote reference to an entry that
    // is not in the list, on a page a clinician reads on paper, where the
    // reader cannot tell whether the source was dropped or the number is wrong.
    // Eight markers for nine criteria is the correct shape: absent, not zero.
    expect(texts(band(host, 'Prescription'), 'tbody th sup')).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
    ]);
    expect(texts(band(host, 'Prescription'), 'tbody th sup')).not.toContain('0');
    // Every criterion still shows its own source in full, budget or not.
    expect(texts(band(host, 'Prescription'), '.disclosure-body')).toHaveLength(9);
    expect(texts(band(host, 'Prescription'), '.disclosure-body')[8]).toBe('source 8');
  });
});

/* ---------------------------------------------------------------- controls */

describe('renderReport — controls', () => {
  it('wires print, download and session history to their callbacks, each fired once per click', () => {
    const { host, print, download, ledger } = render();
    const printButton = host.querySelector('#print-report') as HTMLButtonElement;
    expect(printButton.type).toBe('button');
    expect(printButton.classList.contains('primary')).toBe(true);
    expect(squish(printButton.textContent)).toBe('Print report');

    printButton.click();
    expect(print).toHaveBeenCalledTimes(1);
    expect(download).not.toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();

    (host.querySelector('#download-json') as HTMLButtonElement).click();
    (host.querySelector('#session-history') as HTMLButtonElement).click();
    expect(download).toHaveBeenCalledTimes(1);
    expect(ledger).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledTimes(1);

    expect(texts(host, '.button-row button')).toEqual(['Print report', 'Download JSON', 'Session history']);
  });

  it('renders the theme picker with the passed theme checked and wires it to the document', () => {
    const { host } = render({}, 'light');
    const radios = Array.from(host.querySelectorAll<HTMLInputElement>('input[name="theme"]'));
    expect(radios.map((r) => r.value)).toEqual(['dim', 'dark', 'light']);
    expect(radios.filter((r) => r.checked).map((r) => r.value)).toEqual(['light']);

    const dim = radios[0] as HTMLInputElement;
    dim.checked = true;
    dim.dispatchEvent(new Event('change'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dim');
    expect(globalThis.localStorage.getItem(THEME_KEY)).toBe('dim');
  });

  it('falls back to the effective theme when no theme has been stored', () => {
    const { host } = render({}, null);
    const radios = Array.from(host.querySelectorAll<HTMLInputElement>('input[name="theme"]'));
    expect(radios.filter((r) => r.checked)).toHaveLength(1);
  });

  it('replaces the host on a second render rather than appending a second report', () => {
    const { host } = render();
    renderReport(host, {
      model: model({ isExample: true }),
      theme: 'dark',
      onPrint: vi.fn(),
      onDownload: vi.fn(),
      onLedger: vi.fn(),
    });
    expect(host.querySelectorAll('article.report')).toHaveLength(1);
    expect(host.querySelectorAll('.example-banner')).toHaveLength(1);
    expect(host.querySelectorAll('#print-report')).toHaveLength(1);
  });
});

/* ---------------------------------------------------------- the whole page */

describe('renderReport — the printable one-pager', () => {
  it('carries every band a clinician reads, in order, with real headings', () => {
    const { host } = render();
    expect(texts(host, 'section h2')).toEqual([
      'Prescription',
      'Delivered against prescribed',
      'Every cycle, and what happened to it',
      'Gaze verification',
      'Frequency compliance',
      'Symptom entries',
      'Measured conditions',
      LIMITATIONS_HEADING,
      'Sources',
    ]);
    expect(host.querySelectorAll('h1')).toHaveLength(1);
  });

  it('puts every table in a scroll container so a wide table never scrolls the page', () => {
    const { host } = render();
    const tables = Array.from(host.querySelectorAll('table'));
    expect(tables).toHaveLength(5);
    for (const table of tables) {
      expect(table.parentElement?.classList.contains('table-scroll')).toBe(true);
      expect(table.querySelector('caption')).not.toBeNull();
      expect(table.querySelectorAll('thead th[scope="col"]').length).toBeGreaterThan(0);
    }
  });

  it('gives every prescribed criterion a "Why?" citation — no criterion without a source', () => {
    const { host } = render();
    const rows = Array.from(band(host, 'Prescription').querySelectorAll('tbody tr'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const body = row.querySelector('details .disclosure-body');
      expect(squish(body?.textContent).length).toBeGreaterThan(0);
    }
    expect(host.querySelectorAll('details summary')).toHaveLength(rows.length);
  });

  it('renders an empty session without throwing and without inventing rows', () => {
    const { host } = render({
      prescription: [],
      blocks: [],
      outcomes: [],
      symptom: { baseline: 0, gates: [], final: null },
      totals: { prescribedSeconds: 0, deliveredSeconds: 0, ratio: 0 },
    });
    expect(host.querySelectorAll('.block-row')).toHaveLength(0);
    expect(host.querySelectorAll('tr.histogram-row')).toHaveLength(0);
    expect(host.querySelectorAll('.citations li')).toHaveLength(0);
    expect(host.querySelectorAll('svg.dose-bar')).toHaveLength(0);
    expect(band(host, 'Symptom entries').querySelectorAll('tbody tr')).toHaveLength(1);
    // The limitations do not depend on the session and print regardless.
    expect(host.querySelectorAll('.honesty-box p')).toHaveLength(LIMITATIONS_LINES.length);
    expect(squish(host.querySelector('.dose-total')?.textContent)).toBe(deliveredSentence(0, 0));
  });
});
