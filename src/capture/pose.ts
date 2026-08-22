/**
 * Head pose from the facial transformation matrix.
 *
 * `FaceLandmarker` does not merely emit landmarks: with
 * `outputFacialTransformationMatrixes` it fits the canonical face model to the
 * detected landmarks and returns a 4×4 transform. That matrix's upper-left 3×3
 * block IS the rotation — already solved, already temporally coherent in VIDEO
 * mode, with no camera intrinsics, no chessboard, no PnP solve and no OpenCV.
 *
 * Angles are extracted as intrinsic Tait–Bryan angles in Y–X–Z order, yaw
 * outermost:
 *
 *   pitch θ = asin( −R[1][2] )
 *   yaw   ψ = atan2( R[0][2], R[2][2] )
 *
 * WHY YAW-OUTERMOST: the singularity of this ordering — gimbal lock, which is
 * where the codename comes from — sits at pitch = ±90°, a head tipped fully
 * back, which is unreachable during seated VORx1 and would be refused by the
 * plausibility term anyway. A pitch-outermost ordering would put the singularity
 * at yaw = ±90°, inside the range the exercise actually sweeps. The ordering is
 * a measurement decision, not a convention.
 */

/**
 * The preview is mirrored for the user (`transform: scaleX(-1)`), which inverts
 * the sign of yaw. THE SIGN CORRECTION LIVES HERE AND NOWHERE ELSE. A unit test
 * asserts that a synthesised rightward head turn yields positive yaw.
 */
export const MIRROR_SIGN = -1;

/**
 * Layout of the 16-element matrix payload.
 *
 * Row/column-major layout and handedness of the MediaPipe matrix are PINNED BY
 * TEST AND BY THE D3 TRACKING SPIKE, not assumed from documentation — this is
 * precisely the class of claim that gets punished when it is asserted rather
 * than checked. If the spike shows the other layout, this constant changes and
 * nothing else does.
 */
export type MatrixLayout = 'row-major' | 'column-major';
export const MATRIX_LAYOUT: MatrixLayout = 'row-major';

export interface HeadPose {
  /** degrees, mirror-corrected. Positive = the user turned to their right. */
  yaw: number;
  /** degrees. */
  pitch: number;
  /** degrees. */
  roll: number;
  /** Row-major 3×3 rotation block, scale-normalised. */
  rotation: number[];
}

const RAD_TO_DEG = 180 / Math.PI;

/** Extracts the upper-left 3×3 block from a 16-element 4×4 payload, as row-major. */
export function rotationBlock(data: ArrayLike<number>, layout: MatrixLayout = MATRIX_LAYOUT): number[] {
  if (data.length < 16) throw new Error(`expected a 4x4 matrix payload, got length ${data.length}`);
  const at = (row: number, col: number): number =>
    layout === 'row-major' ? (data[row * 4 + col] as number) : (data[col * 4 + row] as number);
  return [at(0, 0), at(0, 1), at(0, 2), at(1, 0), at(1, 1), at(1, 2), at(2, 0), at(2, 1), at(2, 2)];
}

/**
 * Normalises each column to unit length, removing uniform scale so the block is
 * a rotation. Returns the block unchanged if a column is degenerate — the
 * residual is what the quality score reads, and silently repairing a degenerate
 * fit would hide exactly the condition the refusal exists to catch.
 */
export function normaliseRotation(r: readonly number[]): number[] {
  const out = r.slice();
  for (let c = 0; c < 3; c++) {
    const a = out[c] as number;
    const b = out[3 + c] as number;
    const d = out[6 + c] as number;
    const len = Math.hypot(a, b, d);
    if (!(len > 1e-9)) return r.slice();
    out[c] = a / len;
    out[3 + c] = b / len;
    out[6 + c] = d / len;
  }
  return out;
}

/** Tait–Bryan Y–X–Z decomposition of a row-major 3×3 rotation, in degrees, before mirroring. */
export function decomposeRotation(r: readonly number[]): { yaw: number; pitch: number; roll: number } {
  const r02 = r[2] as number;
  const r12 = r[5] as number;
  const r22 = r[8] as number;
  const r10 = r[3] as number;
  const r11 = r[4] as number;

  const pitch = Math.asin(Math.max(-1, Math.min(1, -r12)));
  const yaw = Math.atan2(r02, r22);
  const roll = Math.atan2(r10, r11);
  return { yaw: yaw * RAD_TO_DEG, pitch: pitch * RAD_TO_DEG, roll: roll * RAD_TO_DEG };
}

/**
 * The one public entry point. Everything upstream of here is a matrix;
 * everything downstream is degrees with the mirror already handled.
 */
export function poseFromMatrix(data: ArrayLike<number>, layout: MatrixLayout = MATRIX_LAYOUT): HeadPose {
  const rotation = normaliseRotation(rotationBlock(data, layout));
  const { yaw, pitch, roll } = decomposeRotation(rotation);
  return { yaw: MIRROR_SIGN * yaw, pitch, roll, rotation };
}

/**
 * Builds the matrix the landmarker emits when the USER turns their head to their
 * own right by `userYawDeg`.
 *
 * The camera sees the mirror of the user's motion, which is the whole reason
 * `MIRROR_SIGN` exists. Composing this helper with `poseFromMatrix` is what the
 * sign unit test asserts: a rightward head turn must come out POSITIVE, and it
 * must not double-invert.
 */
export function matrixForUserYaw(userYawDeg: number, pitchDeg = 0, rollDeg = 0): number[] {
  return matrixFromAngles(-userYawDeg, pitchDeg, rollDeg);
}

/** Builds a row-major 4×4 rigid transform from raw camera-frame Y–X–Z Tait–Bryan angles. */
export function matrixFromAngles(yawDeg: number, pitchDeg: number, rollDeg: number = 0): number[] {
  const y = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const r = (rollDeg * Math.PI) / 180;

  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cp = Math.cos(p);
  const sp = Math.sin(p);
  const cr = Math.cos(r);
  const sr = Math.sin(r);

  // R = Ry * Rx * Rz, matching the Y-X-Z decomposition above.
  const m = [
    cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp,
    cp * sr, cp * cr, -sp,
    -sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp,
  ];

  return [
    m[0] as number, m[1] as number, m[2] as number, 0,
    m[3] as number, m[4] as number, m[5] as number, 0,
    m[6] as number, m[7] as number, m[8] as number, 0,
    0, 0, 0, 1,
  ];
}
