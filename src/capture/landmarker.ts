import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

/**
 * `FaceLandmarker`, configured for one job: the rigid orientation of the skull
 * relative to the camera, during oscillation at the prescribed frequency.
 *
 * The decisive feature is `outputFacialTransformationMatrixes`. The task does
 * not merely emit landmarks — it fits the canonical face model to them and
 * returns a 4×4 transform whose upper-left 3×3 block IS the rotation. Already
 * solved, already temporally coherent in VIDEO mode, with no camera intrinsics,
 * no chessboard, no PnP solve and no OpenCV.
 *
 * HONEST NOTE, recorded before anyone finds it: the 478-landmark mesh includes
 * 10 iris landmarks (indices 468–477). Gimbal reads NONE of them. Iris tracking
 * is refused by design — the Landolt C task replaces it — and the code path that
 * would use them does not exist. Availability is not usage.
 */

/** Same-origin, content-addressed, committed. No CDN, so "zero third-party requests" is true rather than aspirational. */
export const MODEL_PATH = '/model/face_landmarker.64184e22.task';
export const WASM_PATH = '/model';

export interface LandmarkerResult {
  facePresent: boolean;
  /** Row-major 4×4, 16 elements — empty when no face was detected. */
  matrix: number[];
}

export interface CreateOptions {
  /** Forced to CPU by the verification harness: headless WebGL is the flaky part, and the DSP is unchanged by the choice. */
  delegate?: 'GPU' | 'CPU';
}

export async function createLandmarker(opts: CreateOptions = {}): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_PATH,
      delegate: opts.delegate ?? 'GPU',
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    // Blendshapes OFF: Gimbal never draws the mesh and never reads an expression.
    // This is the opposite of the canonical MediaPipe sample, deliberately.
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
    // Thresholds we SET. Not values we READ — the JS API exposes no per-detection
    // confidence, which is why `quality.ts` builds q from observables instead.
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

/**
 * The GPU delegate is feature-detected and then VALIDATED BY THE FPS GATE rather
 * than trusted — on some machines the WebGL path is slower than CPU, and the
 * setup check catches that without special-casing hardware.
 */
export async function createLandmarkerWithFallback(): Promise<{ landmarker: FaceLandmarker; delegate: 'GPU' | 'CPU' }> {
  try {
    return { landmarker: await createLandmarker({ delegate: 'GPU' }), delegate: 'GPU' };
  } catch {
    return { landmarker: await createLandmarker({ delegate: 'CPU' }), delegate: 'CPU' };
  }
}

export function readResult(result: {
  facialTransformationMatrixes?: { data: number[] | Float32Array }[];
  faceLandmarks?: unknown[];
}): LandmarkerResult {
  const m = result.facialTransformationMatrixes?.[0];
  const hasFace = (result.faceLandmarks?.length ?? 0) > 0 && m !== undefined;
  return {
    facePresent: hasFace,
    matrix: hasFace ? Array.from(m.data) : [],
  };
}
