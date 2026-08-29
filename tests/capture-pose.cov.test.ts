import { describe, it, expect } from 'vitest';
import {
  MIRROR_SIGN,
  MATRIX_LAYOUT,
  rotationBlock,
  normaliseRotation,
  decomposeRotation,
  poseFromMatrix,
  matrixForUserYaw,
  matrixFromAngles,
} from '../src/capture/pose.ts';

const DEG = Math.PI / 180;

/** Collapses -0 to +0 so signed zeros out of trigonometry do not break toEqual. */
const unsign = (v: number): number => v + 0;

/** Transposes a row-major 4x4 into column-major storage of the same transform. */
function transpose4(m: readonly number[]): number[] {
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) out[c * 4 + r] = m[r * 4 + c] as number;
  }
  return out;
}

describe('rotationBlock — payload validation', () => {
  it('rejects a payload shorter than 16 elements', () => {
    expect(() => rotationBlock(new Array(15).fill(0))).toThrow(
      /expected a 4x4 matrix payload, got length 15/,
    );
    expect(() => rotationBlock([])).toThrow(/got length 0/);
    // Float32Array is the type the landmarker actually hands over.
    expect(() => rotationBlock(new Float32Array(9))).toThrow(/got length 9/);
  });

  it('accepts exactly 16 and ignores trailing elements beyond 16', () => {
    const m = matrixFromAngles(0, 0, 0);
    // `+ 0` collapses the signed zeros trigonometry leaves behind (-1 * 0 === -0).
    expect(rotationBlock(m).map(unsign)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(rotationBlock([...m, 99, 99]).map(unsign)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});

describe('rotationBlock — layout', () => {
  // A payload whose 16 slots are distinguishable, so a layout mix-up cannot hide.
  const seq = Array.from({ length: 16 }, (_, i) => i);

  it('reads row-major by default, matching MATRIX_LAYOUT', () => {
    expect(MATRIX_LAYOUT).toBe('row-major');
    // rows 0..2, cols 0..2 of a 4-wide row-major buffer
    expect(rotationBlock(seq)).toEqual([0, 1, 2, 4, 5, 6, 8, 9, 10]);
    expect(rotationBlock(seq, 'row-major')).toEqual(rotationBlock(seq));
  });

  it('reads column-major when told to, transposing the block', () => {
    expect(rotationBlock(seq, 'column-major')).toEqual([0, 4, 8, 1, 5, 9, 2, 6, 10]);
  });

  it('column-major on a transposed payload recovers the same rotation as row-major', () => {
    const rowMajor = matrixFromAngles(23, -11, 7);
    const colMajor = transpose4(rowMajor);
    expect(rotationBlock(colMajor, 'column-major')).toEqual(rotationBlock(rowMajor, 'row-major'));
  });

  it('poseFromMatrix honours an explicit column-major layout', () => {
    const rowMajor = matrixForUserYaw(35, 12, -8);
    const colMajor = transpose4(rowMajor);
    const viaRow = poseFromMatrix(rowMajor);
    const viaCol = poseFromMatrix(colMajor, 'column-major');
    expect(viaCol.yaw).toBeCloseTo(viaRow.yaw, 12);
    expect(viaCol.pitch).toBeCloseTo(viaRow.pitch, 12);
    expect(viaCol.roll).toBeCloseTo(viaRow.roll, 12);
    expect(viaCol.yaw).toBeCloseTo(35, 10);
    expect(viaCol.pitch).toBeCloseTo(12, 10);
    expect(viaCol.roll).toBeCloseTo(-8, 10);
  });
});

describe('normaliseRotation', () => {
  it('scales each column to unit length', () => {
    const identityScaled = [3, 0, 0, 0, 3, 0, 0, 0, 3];
    expect(normaliseRotation(identityScaled)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('normalises columns independently when the scale is anisotropic', () => {
    // Columns scaled by 2, 5 and 0.5 respectively; each must come back to unit length.
    const r = [2, 0, 0, 0, 5, 0, 0, 0, 0.5];
    const out = normaliseRotation(r);
    expect(out).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    for (let c = 0; c < 3; c++) {
      expect(Math.hypot(out[c] as number, out[3 + c] as number, out[6 + c] as number)).toBeCloseTo(1, 12);
    }
  });

  it('does not mutate its input', () => {
    const r = [4, 0, 0, 0, 4, 0, 0, 0, 4];
    const copy = r.slice();
    normaliseRotation(r);
    expect(r).toEqual(copy);
  });

  it('returns the block UNCHANGED when the first column is degenerate', () => {
    const degenerate = [0, 0, 0, 0, 2, 0, 0, 0, 2];
    const out = normaliseRotation(degenerate);
    expect(out).toEqual(degenerate);
    expect(out).not.toBe(degenerate); // a copy, never the caller's array
  });

  it('abandons partial work when a LATER column is degenerate', () => {
    // Column 0 normalises cleanly, column 1 is degenerate. The contract is
    // "returns the block unchanged" — the half-normalised column 0 must not leak.
    const r = [2, 0, 0, 0, 0, 0, 0, 0, 2];
    expect(normaliseRotation(r)).toEqual(r);
    // ...and the same for a degenerate third column.
    const r3 = [2, 0, 0, 0, 2, 0, 0, 0, 0];
    expect(normaliseRotation(r3)).toEqual(r3);
  });

  it('treats an all-zero block as degenerate rather than producing NaNs', () => {
    const zeros = new Array(9).fill(0);
    const out = normaliseRotation(zeros);
    expect(out).toEqual(zeros);
    expect(out.some(Number.isNaN)).toBe(false);
  });

  it('refuses to repair a column just below the 1e-9 threshold', () => {
    // len === 1e-9 exactly: the guard is `len > 1e-9`, so this is degenerate.
    const atThreshold = [1e-9, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(normaliseRotation(atThreshold)).toEqual(atThreshold);

    // Just above the threshold it normalises instead.
    const aboveThreshold = [1e-8, 0, 0, 0, 1, 0, 0, 0, 1];
    const repaired = normaliseRotation(aboveThreshold);
    expect(repaired[0]).toBeCloseTo(1, 12);
    expect(repaired.slice(1)).toEqual([0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('propagates degeneracy through poseFromMatrix instead of hiding it', () => {
    const payload = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1];
    const pose = poseFromMatrix(payload);
    expect(pose.rotation).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    // Degenerate in, degenerate out — angles are all zero, no silent repair.
    expect(unsign(pose.yaw)).toBe(0);
    expect(unsign(pose.pitch)).toBe(0);
    expect(unsign(pose.roll)).toBe(0);
  });
});

describe('decomposeRotation — closed-form ground truth', () => {
  it('inverts matrixFromAngles across a grid of angles', () => {
    for (const yaw of [-60, -25, 0, 25, 60]) {
      for (const pitch of [-30, 0, 18]) {
        for (const roll of [-15, 0, 15]) {
          const block = rotationBlock(matrixFromAngles(yaw, pitch, roll));
          const got = decomposeRotation(block);
          expect(got.yaw).toBeCloseTo(yaw, 9);
          expect(got.pitch).toBeCloseTo(pitch, 9);
          expect(got.roll).toBeCloseTo(roll, 9);
        }
      }
    }
  });

  it('matches the documented analytic formulae element-for-element', () => {
    // r = [r00,r01,r02, r10,r11,r12, r20,r21,r22]; pitch = asin(-r12), yaw = atan2(r02,r22).
    const r = rotationBlock(matrixFromAngles(37, -21, 9));
    const expectedPitch = Math.asin(-(r[5] as number)) / DEG;
    const expectedYaw = Math.atan2(r[2] as number, r[8] as number) / DEG;
    const expectedRoll = Math.atan2(r[3] as number, r[4] as number) / DEG;
    const got = decomposeRotation(r);
    expect(got.pitch).toBeCloseTo(expectedPitch, 12);
    expect(got.yaw).toBeCloseTo(expectedYaw, 12);
    expect(got.roll).toBeCloseTo(expectedRoll, 12);
  });

  it('clamps the asin argument when r12 overshoots ±1 through float error', () => {
    // A slightly-unnormalised fit can make -r12 fall outside [-1, 1]; asin must
    // saturate at ±90° rather than return NaN.
    const over = [1, 0, 0, 0, 0, -1.0000000002, 0, 0, 1];
    expect(decomposeRotation(over).pitch).toBeCloseTo(90, 12);
    const under = [1, 0, 0, 0, 0, 1.0000000002, 0, 0, 1];
    expect(decomposeRotation(under).pitch).toBeCloseTo(-90, 12);
    expect(Number.isNaN(decomposeRotation(over).pitch)).toBe(false);
  });

  it('reaches the gimbal-lock singularity only at pitch = ±90°', () => {
    // Y-X-Z with yaw outermost: at pitch = -90 the yaw/roll axes collapse.
    const locked = rotationBlock(matrixFromAngles(0, 90, 0));
    expect(decomposeRotation(locked).pitch).toBeCloseTo(90, 9);
    // Yaw at ±90 is perfectly well conditioned — that is the point of the ordering.
    const yaw90 = rotationBlock(matrixFromAngles(90, 0, 0));
    expect(decomposeRotation(yaw90).yaw).toBeCloseTo(90, 9);
    expect(decomposeRotation(yaw90).pitch).toBeCloseTo(0, 12);
    expect(decomposeRotation(yaw90).roll).toBeCloseTo(0, 12);
  });
});

describe('matrixFromAngles / matrixForUserYaw', () => {
  it('emits a rigid 4x4: last column and last row are the affine identity', () => {
    const m = matrixFromAngles(41, -13, 22);
    expect(m).toHaveLength(16);
    expect(m[3]).toBe(0);
    expect(m[7]).toBe(0);
    expect(m[11]).toBe(0);
    expect(m.slice(12)).toEqual([0, 0, 0, 1]);
  });

  it('defaults rollDeg to zero', () => {
    expect(matrixFromAngles(30, 12)).toEqual(matrixFromAngles(30, 12, 0));
  });

  it('defaults pitchDeg and rollDeg to zero', () => {
    expect(matrixForUserYaw(30)).toEqual(matrixForUserYaw(30, 0, 0));
    expect(matrixForUserYaw(30, 5)).toEqual(matrixForUserYaw(30, 5, 0));
  });

  it('mirrors the user-frame yaw into the camera frame', () => {
    expect(matrixForUserYaw(30, 4, -6)).toEqual(matrixFromAngles(-30, 4, -6));
  });

  it('produces an orthonormal block with determinant +1', () => {
    const r = rotationBlock(matrixFromAngles(33, -27, 14));
    // Columns unit length and mutually orthogonal.
    for (let c = 0; c < 3; c++) {
      expect(Math.hypot(r[c] as number, r[3 + c] as number, r[6 + c] as number)).toBeCloseTo(1, 12);
    }
    const dot = (i: number, j: number) =>
      (r[i] as number) * (r[j] as number) +
      (r[3 + i] as number) * (r[3 + j] as number) +
      (r[6 + i] as number) * (r[6 + j] as number);
    expect(dot(0, 1)).toBeCloseTo(0, 12);
    expect(dot(0, 2)).toBeCloseTo(0, 12);
    expect(dot(1, 2)).toBeCloseTo(0, 12);

    // Cofactor expansion along the first row.
    const det =
      (r[0] as number) * ((r[4] as number) * (r[8] as number) - (r[5] as number) * (r[7] as number)) -
      (r[1] as number) * ((r[3] as number) * (r[8] as number) - (r[5] as number) * (r[6] as number)) +
      (r[2] as number) * ((r[3] as number) * (r[7] as number) - (r[4] as number) * (r[6] as number));
    expect(det).toBeCloseTo(1, 12);
  });

  it('matches the hand-derived R = Ry·Rx·Rz entries', () => {
    const yaw = 20;
    const pitch = -35;
    const roll = 11;
    const [cy, sy] = [Math.cos(yaw * DEG), Math.sin(yaw * DEG)];
    const [cp, sp] = [Math.cos(pitch * DEG), Math.sin(pitch * DEG)];
    const [cr, sr] = [Math.cos(roll * DEG), Math.sin(roll * DEG)];
    const r = rotationBlock(matrixFromAngles(yaw, pitch, roll));
    expect(r[0]).toBeCloseTo(cy * cr + sy * sp * sr, 12);
    expect(r[1]).toBeCloseTo(-cy * sr + sy * sp * cr, 12);
    expect(r[2]).toBeCloseTo(sy * cp, 12);
    expect(r[3]).toBeCloseTo(cp * sr, 12);
    expect(r[4]).toBeCloseTo(cp * cr, 12);
    expect(r[5]).toBeCloseTo(-sp, 12);
    expect(r[6]).toBeCloseTo(-sy * cr + cy * sp * sr, 12);
    expect(r[7]).toBeCloseTo(sy * sr + cy * sp * cr, 12);
    expect(r[8]).toBeCloseTo(cy * cp, 12);
  });
});

describe('poseFromMatrix — round trip', () => {
  it('uses the default layout when none is passed', () => {
    const m = matrixForUserYaw(45, 10, -5);
    expect(poseFromMatrix(m)).toEqual(poseFromMatrix(m, MATRIX_LAYOUT));
  });

  it('applies MIRROR_SIGN to yaw only, never to pitch or roll', () => {
    const pose = poseFromMatrix(matrixFromAngles(28, 16, -9));
    expect(pose.yaw).toBeCloseTo(MIRROR_SIGN * 28, 9);
    expect(pose.pitch).toBeCloseTo(16, 9);
    expect(pose.roll).toBeCloseTo(-9, 9);
  });

  it('returns the normalised rotation block it decomposed', () => {
    const scaled = matrixFromAngles(19, -8, 4).map((v, i) => (i % 4 === 3 || i >= 12 ? v : v * 7));
    const pose = poseFromMatrix(scaled);
    expect(pose.rotation).toHaveLength(9);
    for (let c = 0; c < 3; c++) {
      const len = Math.hypot(
        pose.rotation[c] as number,
        pose.rotation[3 + c] as number,
        pose.rotation[6 + c] as number,
      );
      expect(len).toBeCloseTo(1, 12);
    }
    expect(pose.yaw).toBeCloseTo(MIRROR_SIGN * 19, 9);
  });

  it('accepts a Float32Array payload, the landmarker’s real output type', () => {
    const pose = poseFromMatrix(Float32Array.from(matrixForUserYaw(40, 5)));
    expect(pose.yaw).toBeCloseTo(40, 4);
    expect(pose.pitch).toBeCloseTo(5, 4);
  });

  it('round-trips the full seated VORx1 sweep', () => {
    for (let userYaw = -60; userYaw <= 60; userYaw += 5) {
      expect(poseFromMatrix(matrixForUserYaw(userYaw)).yaw).toBeCloseTo(userYaw, 9);
    }
  });
});
