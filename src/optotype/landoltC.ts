import type { GapOrientation } from './trials.ts';

/**
 * The Landolt C, drawn as SVG GEOMETRY and never as a font glyph.
 *
 * A font-rendered "C" varies with typeface, hinting and rasteriser, which would
 * make the verification task inconsistent across machines. Drawn geometry does
 * not — and it frees the display font as a purely aesthetic choice with no
 * clinical consequence.
 *
 * Standard proportions: outer diameter 5 units, stroke 1 unit, gap 1 unit.
 */
export const OUTER_UNITS = 5;
export const STROKE_UNITS = 1;
export const GAP_UNITS = 1;

/** Degrees of rotation per orientation: 0 = gap right, 1 = down, 2 = left, 3 = up. */
export function orientationDegrees(o: GapOrientation): number {
  return o * 90;
}

/**
 * Builds the annulus as a single stroked arc. The gap subtends one stroke width
 * at the ring's mean radius, which is what makes the gap the same visual size as
 * the stroke — the property the whole task depends on.
 */
export function landoltCSvg(orientation: GapOrientation): string {
  const size = OUTER_UNITS;
  const c = size / 2;
  const meanRadius = (OUTER_UNITS - STROKE_UNITS) / 2; // 2 units
  const gapAngle = (GAP_UNITS / meanRadius) * (180 / Math.PI); // ≈ 28.6°
  const half = gapAngle / 2;

  const start = half;
  const end = 360 - half;
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const x1 = c + meanRadius * Math.cos(rad(start));
  const y1 = c + meanRadius * Math.sin(rad(start));
  const x2 = c + meanRadius * Math.cos(rad(end));
  const y2 = c + meanRadius * Math.sin(rad(end));

  return `<svg class="optotype" viewBox="0 0 ${size} ${size}" role="img" aria-label="target" focusable="false" style="transform: rotate(${orientationDegrees(orientation)}deg)">
  <path d="M ${x1.toFixed(4)} ${y1.toFixed(4)} A ${meanRadius} ${meanRadius} 0 1 1 ${x2.toFixed(4)} ${y2.toFixed(4)}"
        fill="none" stroke="currentColor" stroke-width="${STROKE_UNITS}" stroke-linecap="butt" />
</svg>`;
}
