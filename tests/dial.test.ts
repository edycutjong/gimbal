import { describe, it, expect } from 'vitest';
import { arcAngleDeg, markerAngleDeg, markerRotationDeg } from '../src/ui/dial.ts';

/**
 * The ring's two moving parts have to point at the same thing.
 *
 * The live arc says "you are here right now"; the committed marker says "this
 * cycle scored here, and this is the number that went in the report". If those
 * two disagree, every sentence the product makes about the marker is false — and
 * they DID disagree, by exactly 135°, because the element-level rotation that
 * puts the prescribed band at twelve o'clock was being counted twice.
 *
 * This is asserted arithmetically rather than by screenshot: the geometry is
 * pure, and a pure test cannot rot when a stylesheet moves.
 */
describe('dial geometry', () => {
  it('places the committed marker exactly on the arc tip, at every tenth', () => {
    for (let i = 0; i <= 10; i++) {
      const f = i / 10;
      // Modulo a full turn — 405° and 45° are the same place on a dial.
      const arc = ((arcAngleDeg(f) % 360) + 360) % 360;
      const marker = ((markerAngleDeg(f) % 360) + 360) % 360;
      expect(marker, `fraction ${f}`).toBeCloseTo(arc, 9);
    }
  });

  it('puts zero at the start of the sweep and the maximum at its end', () => {
    // 135° clockwise from three o'clock is half past seven; 405° is half past
    // four. A 270° sweep between them is centred on twelve o'clock.
    expect(arcAngleDeg(0)).toBe(135);
    expect(arcAngleDeg(1)).toBe(405);
    expect(markerRotationDeg(0)).toBe(-270);
    expect(markerRotationDeg(1)).toBe(0);
  });

  it('centres the prescribed band on twelve o’clock for the published example card', () => {
    // Floor 150 and ceiling 350 against a ring maximum of 2 x the band centre.
    const max = (150 + 350);
    const centre = (arcAngleDeg(150 / max) + arcAngleDeg(350 / max)) / 2;
    expect(centre % 360).toBeCloseTo(270, 9); // 270 deg clockwise from 3 o'clock
  });
});
