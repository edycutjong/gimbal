import { describe, it, expect } from 'vitest';
import { OUTER_UNITS, STROKE_UNITS, GAP_UNITS, orientationDegrees, landoltCSvg } from '../src/optotype/landoltC.ts';
import { ORIENTATIONS } from '../src/optotype/trials.ts';
import type { GapOrientation } from '../src/optotype/trials.ts';

/**
 * The optotype is GEOMETRY, not a glyph — so its correctness is checkable as
 * geometry. These read the emitted `d` attribute back out and assert the ring
 * proportions the discrimination task depends on, rather than diffing a blob of
 * markup that nobody can reason about.
 */
const CENTRE = OUTER_UNITS / 2;
const MEAN_RADIUS = (OUTER_UNITS - STROKE_UNITS) / 2;

interface Path {
  x1: number;
  y1: number;
  rx: number;
  ry: number;
  xAxisRotation: number;
  largeArc: number;
  sweep: number;
  x2: number;
  y2: number;
}

/** Parses `M x1 y1 A rx ry rot large sweep x2 y2` out of the rendered svg. */
function parsePath(svg: string): Path {
  const d = svg.match(/\sd="([^"]+)"/);
  if (!d) throw new Error(`no path data in: ${svg}`);
  const m = d[1]!
    .trim()
    .match(/^M\s+(\S+)\s+(\S+)\s+A\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/);
  if (!m) throw new Error(`unparseable path data: ${d[1]}`);
  const n = m.slice(1).map(Number) as [number, number, number, number, number, number, number, number, number];
  return {
    x1: n[0],
    y1: n[1],
    rx: n[2],
    ry: n[3],
    xAxisRotation: n[4],
    largeArc: n[5],
    sweep: n[6],
    x2: n[7],
    y2: n[8],
  };
}

describe('Landolt C geometry', () => {
  it('fixes the standard 5:1:1 proportions — outer diameter, stroke, gap', () => {
    expect(OUTER_UNITS).toBe(5);
    expect(STROKE_UNITS).toBe(1);
    expect(GAP_UNITS).toBe(1);
    // The mean radius is where the gap is measured, and it must be 2 units for
    // the gap to subtend exactly one stroke width.
    expect(MEAN_RADIUS).toBe(2);
  });

  it('rotates 90° per orientation step: 0 = gap right, 1 = down, 2 = left, 3 = up', () => {
    expect(orientationDegrees(0)).toBe(0);
    expect(orientationDegrees(1)).toBe(90);
    expect(orientationDegrees(2)).toBe(180);
    expect(orientationDegrees(3)).toBe(270);
  });

  it('emits a square viewBox of OUTER_UNITS and a single stroked arc, never a text glyph', () => {
    const svg = landoltCSvg(0);
    expect(svg).toContain('viewBox="0 0 5 5"');
    expect(svg).toContain('class="optotype"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('stroke-width="1"');
    // Butt caps: a round cap would eat into the gap and shrink it below one
    // stroke width, which is the one measurement the task rests on.
    expect(svg).toContain('stroke-linecap="butt"');
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('font');
    expect((svg.match(/<path/g) ?? []).length).toBe(1);
  });

  it('marks the optotype as a decorative image so the answer is never in the a11y tree', () => {
    const svg = landoltCSvg(2);
    expect(svg).toContain('role="img"');
    // "target", not "gap pointing left" — a screen reader must not hand over the
    // 4AFC answer.
    expect(svg).toContain('aria-label="target"');
    expect(svg).toContain('focusable="false"');
    expect(svg).not.toMatch(/aria-label="[^"]*(left|right|up|down)/i);
  });

  it('draws the arc endpoints exactly on the mean-radius circle about the centre', () => {
    const p = parsePath(landoltCSvg(0));
    expect(p.rx).toBe(MEAN_RADIUS);
    expect(p.ry).toBe(MEAN_RADIUS);
    const r1 = Math.hypot(p.x1 - CENTRE, p.y1 - CENTRE);
    const r2 = Math.hypot(p.x2 - CENTRE, p.y2 - CENTRE);
    expect(r1).toBeCloseTo(MEAN_RADIUS, 3);
    expect(r2).toBeCloseTo(MEAN_RADIUS, 3);
  });

  it('subtends a gap of exactly one stroke width of arc at the mean radius', () => {
    const p = parsePath(landoltCSvg(0));
    const a1 = Math.atan2(p.y1 - CENTRE, p.x1 - CENTRE);
    const a2 = Math.atan2(p.y2 - CENTRE, p.x2 - CENTRE);
    // The gap is the SHORT way round between the two endpoints.
    let gapRad = Math.abs(a1 - a2);
    if (gapRad > Math.PI) gapRad = 2 * Math.PI - gapRad;
    // arc length = r·θ = 2 · 0.5 = 1 unit = one stroke width. This is the whole
    // clinical property of the Landolt C.
    // Tolerance is set by the 4-dp rounding of the emitted coordinates, not by
    // the maths: the exact half-angle is GAP_UNITS / MEAN_RADIUS / 2 = 0.25 rad.
    expect(gapRad * MEAN_RADIUS).toBeCloseTo(GAP_UNITS, 4);
    expect(gapRad).toBeCloseTo(0.5, 4);
  });

  it('centres the gap on the +x axis, symmetric about the horizontal midline', () => {
    const p = parsePath(landoltCSvg(0));
    // Both endpoints sit on the right-hand side, mirrored across y = 2.5.
    expect(p.x1).toBeCloseTo(p.x2, 4);
    expect(p.x1).toBeGreaterThan(CENTRE);
    expect(p.y1 - CENTRE).toBeCloseTo(CENTRE - p.y2, 4);
    expect(p.y1).toBeGreaterThan(CENTRE);
    expect(p.y2).toBeLessThan(CENTRE);
  });

  it('takes the long way round the ring — large-arc and sweep flags both set', () => {
    const p = parsePath(landoltCSvg(1));
    expect(p.xAxisRotation).toBe(0);
    // largeArc = 1 keeps the stroke as the 331° annulus rather than the 29° gap.
    expect(p.largeArc).toBe(1);
    expect(p.sweep).toBe(1);
  });

  it('rounds coordinates to 4 decimal places so the markup is byte-stable', () => {
    const svg = landoltCSvg(0);
    expect(svg).toContain('d="M 4.4378 2.9948 A 2 2 0 1 1 4.4378 2.0052"');
    expect(landoltCSvg(0)).toBe(svg);
  });

  it('varies only the rotation across the four orientations — one geometry, four presentations', () => {
    const rendered = ORIENTATIONS.map((o) => landoltCSvg(o));
    const degrees = rendered.map((svg) => {
      const m = svg.match(/transform: rotate\((-?[\d.]+)deg\)/);
      if (!m) throw new Error(`no rotation in: ${svg}`);
      return Number(m[1]);
    });
    expect(degrees).toEqual([0, 90, 180, 270]);

    // Strip the rotation and every variant is byte-identical: a patient cannot
    // discriminate the four by anything except where the gap points.
    const stripped = rendered.map((svg) => svg.replace(/rotate\([^)]*\)/, 'rotate(X)'));
    expect(new Set(stripped).size).toBe(1);
    // ...and the four presentations are themselves all distinct.
    expect(new Set(rendered).size).toBe(4);
  });

  it('agrees with orientationDegrees for every orientation it renders', () => {
    for (const o of ORIENTATIONS) {
      expect(landoltCSvg(o)).toContain(`transform: rotate(${orientationDegrees(o)}deg)`);
    }
  });

  it('is pure — repeated calls with the same orientation return the identical string', () => {
    for (const o of [0, 1, 2, 3] as GapOrientation[]) {
      expect(landoltCSvg(o)).toBe(landoltCSvg(o));
    }
  });
});
