import { TRACE, ILLUSTRATION_CARD } from './trace.ts';
import { esc } from '../ui/dom.ts';

/**
 * Two static diagrams.
 *
 * NO `<text>` ELEMENTS INSIDE THE SVGs, deliberately. Every label here is real
 * HTML positioned beside or over the drawing, for two reasons: an SVG text node
 * carries a font size in user units that the 15 px floor cannot see, and a
 * screen reader gets a proper label rather than a floating string with no
 * relationship to anything.
 */

const V_MAX = ILLUSTRATION_CARD.peakVelocityCeiling.value + ILLUSTRATION_CARD.peakVelocityFloor.value;
const FLOOR = ILLUSTRATION_CARD.peakVelocityFloor.value;
const CEILING = ILLUSTRATION_CARD.peakVelocityCeiling.value;

/** Plot geometry, in viewBox units. */
const W = 340;
const H = 170;
const PLOT_TOP = 18;
const PLOT_BOTTOM = 152;

const yFor = (v: number): number => PLOT_BOTTOM - (v / V_MAX) * (PLOT_BOTTOM - PLOT_TOP);

/**
 * Peak velocity per cycle against the prescribed band — the plot that says why a
 * rep count cannot be a dose. Driven by the same trace the hero replays, so the
 * two figures on this page are two views of one series rather than two
 * drawings.
 */
export function bandFigure(): string {
  const step = (W - 46) / TRACE.length;
  const dots = TRACE.map((c, i) => {
    const x = 34 + step * (i + 0.5);
    const y = yFor(c.peakOmega);
    if (c.credited) {
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="var(--zone-in)" />`;
    }
    // A refusal is an ABSENCE, here as everywhere: an outlined ring, never a
    // filled red dot. The tracking-unreliable one also gets a slash, because it
    // sits inside the band and would otherwise look like a drawing error.
    const slash =
      c.reason === 'low-confidence'
        ? `<line x1="${(x - 8).toFixed(1)}" y1="${(y + 8).toFixed(1)}" x2="${(x + 8).toFixed(1)}" y2="${(y - 8).toFixed(1)}" stroke="var(--refused)" stroke-width="1.8" />`
        : '';
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="none" stroke="var(--refused)" stroke-width="2" />${slash}`;
  }).join('');

  const bandY = yFor(CEILING);
  const bandH = yFor(FLOOR) - bandY;

  /*
   * The y labels are positioned from the SAME `yFor()` the dots use, as a
   * percentage of the viewBox height, rather than by flexing four spans apart
   * and hoping. The SVG keeps its aspect ratio at every width, so one number is
   * correct at 360 px and at 1920 px — where `space-between` was wrong at both.
   */
  const tick = (v: number, strong: boolean): string =>
    `<span class="tnum${strong ? ' lp-plot-edge' : ''}" style="top:${((yFor(v) / H) * 100).toFixed(2)}%">${v}</span>`;

  /*
   * COUNTED, NOT TYPED. The alt text used to assert "three below the floor, six
   * inside, one refused inside the band" as literal words in a module where
   * every other number is derived from TRACE — so changing the velocity floor
   * would have silently made the only description a blind reader gets wrong.
   */
  const belowFloor = TRACE.filter((c) => c.peakOmega < FLOOR).length;
  const credited = TRACE.filter((c) => c.credited).length;
  const refusedInBand = TRACE.filter((c) => !c.credited && c.peakOmega >= FLOOR && c.peakOmega <= CEILING).length;

  return `
  <div class="lp-plot">
    <p class="lp-plot-ylabel">peak head velocity, °/s</p>
    <div class="lp-plot-yaxis" aria-hidden="true">
      ${tick(V_MAX, false)}${tick(CEILING, true)}${tick(FLOOR, true)}${tick(0, false)}
    </div>
    <div class="lp-plot-body">
      <svg viewBox="0 0 ${W} ${H}" class="lp-plot-svg" role="img"
           aria-label="Peak head velocity for ${TRACE.length} consecutive cycles plotted against a prescribed band of ${FLOOR} to ${CEILING} degrees per second. ${belowFloor} cycles fall below the floor, ${credited} fall inside the band and are credited, and ${refusedInBand} inside the band is refused for low tracking confidence.">
        <!-- TWO REGIONS, TWO HUES, AND THEY ARE THE ONLY TWO SEMANTICS THERE ARE.
             Below the floor is out-of-band, so it is washed in the out-of-band
             hue; the prescribed band is in-band, so it is washed in the in-band
             one. Both are backgrounds behind the same series, and neither is
             load-bearing on its own: every dot also carries fill, outline and
             slash. -->
        <rect x="34" y="${yFor(FLOOR).toFixed(1)}" width="${W - 46}" height="${(PLOT_BOTTOM - yFor(FLOOR)).toFixed(1)}"
              fill="var(--zone-out)" opacity="0.18" />
        <rect x="34" y="${bandY.toFixed(1)}" width="${W - 46}" height="${bandH.toFixed(1)}"
              fill="var(--zone-in)" opacity="0.14" />
        <line x1="34" y1="${bandY.toFixed(1)}" x2="${W - 12}" y2="${bandY.toFixed(1)}"
              stroke="var(--zone-in)" stroke-width="1.2" stroke-dasharray="5 4" />
        <line x1="34" y1="${yFor(FLOOR).toFixed(1)}" x2="${W - 12}" y2="${yFor(FLOOR).toFixed(1)}"
              stroke="var(--zone-in)" stroke-width="1.2" stroke-dasharray="5 4" />
        <line x1="34" y1="${PLOT_BOTTOM}" x2="${W - 12}" y2="${PLOT_BOTTOM}" stroke="var(--lp-line-2)" stroke-width="1" />
        <line x1="34" y1="${PLOT_TOP}" x2="34" y2="${PLOT_BOTTOM}" stroke="var(--lp-line-2)" stroke-width="1" />
        ${dots}
      </svg>
    </div>
    <!-- The x axis names the x quantity. It carried "peak head velocity, °/s"
         — the Y quantity — printed under the X axis, on the one chart whose
         whole argument is about velocity. That label is now above the y ticks
         where it belongs. -->
    <p class="lp-plot-xaxis" aria-hidden="true">
      <span>rep 1</span><span>${TRACE.length} consecutive reps</span><span>rep ${TRACE.length}</span>
    </p>
  </div>
  <ul class="lp-legend">
    <li><span class="lp-key lp-key-in" aria-hidden="true"></span>credited — inside the prescribed band</li>
    <li><span class="lp-key lp-key-out" aria-hidden="true"></span>refused — below the velocity floor</li>
    <li><span class="lp-key lp-key-q" aria-hidden="true"></span>refused — tracking unreliable, despite a good-looking number</li>
  </ul>`;
}

interface ReportRow {
  label: string;
  note: string;
  kind?: 'bar' | 'table' | 'body';
}

const REPORT_ROWS: readonly ReportRow[] = [
  { label: 'Delivered vs prescribed, per block', note: 'solid fill inside an outlined track', kind: 'bar' },
  { label: 'Refusal histogram', note: 'six rows — one per outcome', kind: 'table' },
  { label: 'Gaze tally', note: 'with chance = 25 % printed beside it' },
  { label: 'Symptom entries', note: "against the card's own stop-rule thresholds", kind: 'table' },
  { label: '“Why?” on every criterion', note: 'forced open by the print stylesheet' },
  { label: 'What this does not measure', note: 'at body size, never fine print', kind: 'body' },
];

/**
 * The printed page, as a wireframe. Plain HTML boxes rather than a screenshot,
 * because a screenshot of a report would carry numbers, and there is no session
 * whose numbers those would honestly be.
 */
export function reportFigure(): string {
  const rows = REPORT_ROWS.map(
    (r) => `<div class="lp-rp-row" data-kind="${r.kind ?? 'plain'}">
      <span class="lp-rp-label">${esc(r.label)}</span>
      <span class="lp-rp-note">${esc(r.note)}</span>
    </div>`,
  ).join('');

  return `<div class="lp-rp-page" role="img"
      aria-label="Wireframe of the one-page printed report: a header, a delivered-versus-prescribed bar per block, a six-row refusal histogram, a gaze tally with chance printed beside it, the symptom entries, a Why disclosure on every criterion, and the limitations at body size.">
    <div class="lp-rp-head">
      <span class="wordmark">Gimbal</span>
      <span class="lp-rp-note">session report · one letter page · monochrome-safe</span>
    </div>
    ${rows}
    <div class="lp-rp-foot">
      <span class="lp-rp-note">Not a diagnostic device. All processing happened in this browser; no data left this device.</span>
    </div>
  </div>`;
}
