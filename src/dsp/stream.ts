import { savitzkyGolayPoint, DEFAULT_SG_WINDOW } from './smooth.ts';
import { centralDifference } from './velocity.ts';

/**
 * The per-frame angle → velocity path, as a small stateful stream.
 *
 * Order matters and is the rule the whole DSP design comes from: SMOOTH THE
 * QUANTITY THAT IS NOISY (the angle), DIFFERENTIATE WITH THE OPERATOR WHOSE BIAS
 * IS A CLOSED-FORM EXPRESSION, THEN CORRECT THAT BIAS EXPLICITLY.
 *
 * LATENCY, stated rather than hidden: a symmetric 5-point Savitzky–Golay costs
 * 2 frames and the 3-point central difference costs 1 more, so ω is reported
 * 3 frames — about 100 ms at 30 fps — behind the head that produced it. One
 * sweep at 2 Hz is 250 ms, so the audio coaching still lands inside the same
 * head turn. Widening the smoothing window is the D3 AMBER remedy, and it moves
 * this number, which is why the number is computed rather than asserted.
 */
export interface VelocitySample {
  /** ms — the camera timestamp the velocity is attributed to. */
  tMs: number;
  /** °/s, un-corrected. The bias correction is applied per CYCLE, not per frame. */
  omega: number;
  /** °/s² — used by the kinematic plausibility term. */
  accel: number;
  /** degrees — the smoothed angle at that instant. */
  smoothedYaw: number;
}

export class VelocityStream {
  private rawYaw: number[] = [];
  private rawT: number[] = [];
  private smoothYaw: number[] = [];
  private smoothT: number[] = [];
  private lastOmega = NaN;
  private lastOmegaT = NaN;

  constructor(private readonly window: number = DEFAULT_SG_WINDOW) {}

  get latencyFrames(): number {
    return ((this.window - 1) >> 1) + 1;
  }

  reset(): void {
    this.rawYaw = [];
    this.rawT = [];
    this.smoothYaw = [];
    this.smoothT = [];
    this.lastOmega = NaN;
    this.lastOmegaT = NaN;
  }

  /** Returns a velocity sample once enough frames have accumulated, else `null`. */
  push(tMs: number, yaw: number): VelocitySample | null {
    this.rawYaw.push(yaw);
    this.rawT.push(tMs);
    if (this.rawYaw.length > this.window) {
      this.rawYaw.shift();
      this.rawT.shift();
    }
    if (this.rawYaw.length < this.window) return null;

    const centre = (this.window - 1) >> 1;
    this.smoothYaw.push(savitzkyGolayPoint(this.rawYaw, this.window));
    this.smoothT.push(this.rawT[centre] as number);
    if (this.smoothYaw.length > 3) {
      this.smoothYaw.shift();
      this.smoothT.shift();
    }
    if (this.smoothYaw.length < 3) return null;

    const omega = centralDifference(
      this.smoothYaw[2] as number,
      this.smoothYaw[0] as number,
      this.smoothT[2] as number,
      this.smoothT[0] as number,
    );
    const t = this.smoothT[1] as number;

    let accel = 0;
    if (Number.isFinite(this.lastOmega) && t > this.lastOmegaT) {
      accel = (omega - this.lastOmega) / ((t - this.lastOmegaT) / 1000);
    }
    this.lastOmega = omega;
    this.lastOmegaT = t;

    return { tMs: t, omega, accel, smoothedYaw: this.smoothYaw[1] as number };
  }
}
