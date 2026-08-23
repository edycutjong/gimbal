import type { ProtocolCard } from '../protocol/card.ts';
import { velocityCentre } from '../protocol/card.ts';

/**
 * The velocity ring.
 *
 * A LARGE CONCENTRIC RING AROUND THE OPTOTYPE, because any feedback meant to be
 * used during motion must cost no fixation: acuity falls steeply with
 * eccentricity, so text and small shape away from the fixation point require a
 * saccade to read, while the periphery resolves luminance, size and gross
 * position well. The ring is read from the periphery without leaving the target.
 *
 * The ring is nonetheless the REDUNDANT channel. Sound carries no eccentricity
 * penalty — hearing has no fovea to leave — so the tone is the load-bearing one.
 *
 * Scale: a 270° sweep from −135° (0 °/s) through 0° at 12 o'clock to +135°
 * (2 × the card's velocity band centre). The prescribed band therefore lands
 * CENTRED ON 12 O'CLOCK, which is the position peripheral vision localises best
 * and which reads instantly as "the marker belongs at the top". Below-band
 * errors sit on the left arc, above-band on the right.
 *
 * The whole element is `aria-hidden`: its information is carried in words by the
 * polite status region.
 */

const SWEEP_FRACTION = 0.75; // 270° of 360°
const SWEEP_DEG = 360 * SWEEP_FRACTION;

/**
 * Where the ARC's `f` point lands, in screen degrees clockwise from three
 * o'clock. A `<circle>` dasharray begins at three o'clock (0°) and runs
 * clockwise; `svg.ring` then carries `rotate(135deg)` from screen.css.
 */
export function arcAngleDeg(fraction: number): number {
  return 135 + fraction * SWEEP_DEG;
}

/**
 * The element-level rotation that puts the committed tick on the arc's `f`
 * point. The tick is authored at the element's own twelve o'clock — 270° in the
 * same convention — and inherits the same 135° element rotation, so the two
 * cancel to `f·270 − 270`.
 *
 * These two functions exist as a PAIR so that a unit test can assert they agree
 * without a DOM. They disagreed by exactly 135° until 2026-08-23, which put the
 * committed marker — the one number the patient is meant to learn to trust —
 * a fifth of a turn away from the velocity it was reporting.
 */
export function markerRotationDeg(fraction: number): number {
  return -SWEEP_DEG + fraction * SWEEP_DEG;
}

/** Where the tick ends up on screen, given `markerRotationDeg`. */
export function markerAngleDeg(fraction: number): number {
  return 270 + markerRotationDeg(fraction) + 135;
}

export interface DialElements {
  svg: SVGSVGElement;
  track: SVGCircleElement;
  band: SVGCircleElement;
  live: SVGCircleElement;
  marker: SVGLineElement;
}

export function createDial(card: ProtocolCard): { html: string; max: number } {
  const max = velocityCentre(card) * 2;
  const r = 42;
  const c = 2 * Math.PI * r;
  const arc = c * SWEEP_FRACTION;

  const frac = (v: number): number => Math.max(0, Math.min(1, v / max));
  const bandStart = frac(card.peakVelocityFloor.value) * arc;
  const bandLen = (frac(card.peakVelocityCeiling.value) - frac(card.peakVelocityFloor.value)) * arc;

  // The track is `--edge`, the decorative-rule token, not `--surface-2`. On the
  // warm-paper palette `--surface-2` (#fbf8f2) against `--surface-1` (#f6f2ea)
  // is a 1.03:1 difference, so the unfilled part of the sweep simply did not
  // exist in Light: the ring appeared to be nothing but its prescribed band.
  return {
    max,
    html: `<svg class="ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <circle class="ring-track" cx="50" cy="50" r="${r}" fill="none"
          stroke="var(--edge)" stroke-width="6"
          stroke-dasharray="${arc.toFixed(3)} ${c.toFixed(3)}" stroke-linecap="butt" />
  <circle class="ring-band" cx="50" cy="50" r="${r}" fill="none"
          stroke="var(--edge-strong)" stroke-width="6"
          stroke-dasharray="0 ${bandStart.toFixed(3)} ${bandLen.toFixed(3)} ${c.toFixed(3)}" />
  <circle class="ring-live" cx="50" cy="50" r="${r}" fill="none"
          stroke="var(--zone-out)" stroke-width="6"
          stroke-dasharray="0 ${c.toFixed(3)}" stroke-linecap="butt" />
  <line class="ring-marker" x1="50" y1="${50 - r - 5}" x2="50" y2="${50 - r + 8}"
        stroke="var(--refused)" stroke-width="2.5" opacity="0" />
</svg>`,
  };
}

export class Dial {
  private readonly arc: number;
  private readonly circumference: number;
  private lastLiveWrite = 0;

  constructor(
    private readonly els: DialElements,
    private readonly max: number,
    /** Under reduced motion the live arc updates discretely at 10 Hz instead of tweening. */
    private readonly reducedMotion: boolean,
  ) {
    const r = Number(els.live.getAttribute('r') ?? 42);
    this.circumference = 2 * Math.PI * r;
    this.arc = this.circumference * SWEEP_FRACTION;
    if (!reducedMotion) els.live.style.transition = 'stroke-dasharray 100ms linear';
  }

  private fraction(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, Math.abs(v) / this.max));
  }

  /** ONE attribute write per frame. No innerHTML in the loop, ever. */
  setLive(omega: number, inBand: boolean, nowMs: number): void {
    if (this.reducedMotion && nowMs - this.lastLiveWrite < 100) return;
    this.lastLiveWrite = nowMs;
    const len = this.fraction(omega) * this.arc;
    this.els.live.setAttribute('stroke-dasharray', `${len.toFixed(3)} ${this.circumference.toFixed(3)}`);
    this.els.live.setAttribute('stroke', inBand ? 'var(--zone-in)' : 'var(--zone-out)');
  }

  /**
   * The committed marker shows the cycle's BIAS-CORRECTED peak — the number that
   * was actually scored. So the marker, not the arc, is what the patient learns
   * to trust, and the report's numbers come from the marker's series.
   */
  setCommitted(peakOmega: number, credited: boolean): void {
    // −270, not −135.
    //
    // The tick is authored pointing at the element's own twelve o'clock, and the
    // whole `svg.ring` then carries a further `rotate(135deg)` from screen.css so
    // that the arc — which a `<circle>` dasharray starts at three o'clock — has
    // its prescribed band centred on the top. Subtracting 135 here left that
    // element rotation counted twice, and the committed marker sat 135° round
    // from the velocity it was reporting: at 0 °/s it pointed at the middle of
    // the band, and at band centre it pointed at half past four.
    //
    // `markerRotationDeg` and `arcAngleDeg` are a tested pair — see
    // tests/dial.test.ts, which asserts they agree at every tenth.
    const angle = markerRotationDeg(this.fraction(peakOmega));
    this.els.marker.setAttribute('transform', `rotate(${angle.toFixed(2)} 50 50)`);
    this.els.marker.setAttribute('stroke', credited ? 'var(--zone-in)' : 'var(--refused)');
    this.els.marker.setAttribute('opacity', '1');
    this.els.band.setAttribute('stroke', credited ? 'var(--zone-in)' : 'var(--edge-strong)');
  }

  /** Paused: the ring dims to --edge and HOLDS its last committed value. */
  setPaused(paused: boolean): void {
    this.els.live.setAttribute('stroke', paused ? 'var(--edge)' : 'var(--zone-out)');
  }
}

export function bindDial(root: ParentNode): DialElements | null {
  const svg = root.querySelector<SVGSVGElement>('svg.ring');
  const track = root.querySelector<SVGCircleElement>('.ring-track');
  const band = root.querySelector<SVGCircleElement>('.ring-band');
  const live = root.querySelector<SVGCircleElement>('.ring-live');
  const marker = root.querySelector<SVGLineElement>('.ring-marker');
  if (!svg || !track || !band || !live || !marker) return null;
  return { svg, track, band, live, marker };
}
