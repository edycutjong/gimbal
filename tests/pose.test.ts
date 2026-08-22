import { describe, it, expect } from 'vitest';
import { poseFromMatrix, matrixForUserYaw, matrixFromAngles, MIRROR_SIGN } from '../src/capture/pose.ts';
import { orthonormalityResidual } from '../src/dsp/quality.ts';

describe('yaw sign and the mirror correction', () => {
  it('yields POSITIVE yaw for a rightward head turn', () => {
    expect(poseFromMatrix(matrixForUserYaw(30)).yaw).toBeCloseTo(30, 6);
    expect(poseFromMatrix(matrixForUserYaw(-30)).yaw).toBeCloseTo(-30, 6);
  });

  it('does not double-invert — the mirrored preview is corrected exactly once', () => {
    // The correction lives in one place. Applying it to a raw camera-frame
    // matrix flips the sign once and only once.
    const raw = matrixFromAngles(30, 0, 0);
    expect(poseFromMatrix(raw).yaw).toBeCloseTo(MIRROR_SIGN * 30, 6);
    expect(MIRROR_SIGN).toBe(-1);
  });

  it('is independent of roll across the range the exercise sweeps', () => {
    for (const roll of [-20, -10, 0, 10, 20]) {
      expect(poseFromMatrix(matrixForUserYaw(25, 0, roll)).yaw).toBeCloseTo(25, 6);
    }
  });

  it('recovers pitch, and keeps the singularity out of the yaw sweep', () => {
    expect(poseFromMatrix(matrixForUserYaw(0, 15)).pitch).toBeCloseTo(15, 6);
    // Yaw stays well-conditioned at ±60°, which brackets seated VORx1.
    expect(poseFromMatrix(matrixForUserYaw(60, 10)).yaw).toBeCloseTo(60, 5);
  });

  it('normalises uniform scale out of the rotation block', () => {
    const scaled = matrixForUserYaw(30).map((v, i) => (i % 4 === 3 || i >= 12 ? v : v * 2.5));
    const pose = poseFromMatrix(scaled);
    expect(pose.yaw).toBeCloseTo(30, 6);
    expect(orthonormalityResidual(pose.rotation)).toBeLessThan(1e-9);
  });
});
