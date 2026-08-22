import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { FrameClock } from '../capture/camera.ts';
import { poseFromMatrix } from '../capture/pose.ts';
import { readResult } from '../capture/landmarker.ts';
import { VelocityStream } from '../dsp/stream.ts';
import { CycleSegmenter } from '../dsp/segment.ts';
import { dominantFrequency, FFT_SIZE } from '../dsp/fft.ts';
import { frameQuality, orthonormalityResidual } from '../dsp/quality.ts';
import { scoreCycle } from '../dsp/score.ts';
import { INSTRUMENT_LIMITS, deadbandDegPerSec, minSampleRateHz } from '../dsp/limits.ts';
import type { ScoredCycle } from '../dsp/types.ts';
import { peakOmegaFor, peakAccelFor } from '../dsp/velocity.ts';
import { DoseAccumulator } from './dose.ts';
import { TrialScheduler, type GapOrientation } from '../optotype/trials.ts';
import type { ProtocolCard } from '../protocol/card.ts';
import { bandCentreHz } from '../protocol/card.ts';

/**
 * One block of the exercise: the 30 Hz loop, on the main thread.
 *
 * Everything here runs once per camera frame in well under a millisecond of
 * Gimbal's own code — model inference dominates. The FFT is the one step that
 * does NOT run per frame: it runs once per 8.53 s window and feeds arithmetic
 * (the bias-correction gain), not a chart.
 *
 * The risk this design accepts is that a main-thread stall shows up as a dropped
 * frame. That is not silently absorbed: dropped frames are visible to the
 * cadence term of the quality score and can refuse a cycle. The architecture
 * converts the risk into a REFUSAL rather than into a wrong number.
 */

export interface BlockFrameState {
  tMs: number;
  omega: number;
  /** Seconds of credited cycle time so far, this block. */
  deliveredSeconds: number;
  elapsedMs: number;
  facePresent: boolean;
  quality: number;
  optotypeShown: GapOrientation | null;
  optotypeWindowOpen: boolean;
}

export interface BlockResult {
  index: number;
  prescribedSeconds: number;
  dose: DoseAccumulator;
  trials: TrialScheduler;
  fHatMedian: number;
  effectiveFpsMedian: number;
  interrupted: boolean;
}

export interface BlockCallbacks {
  onFrame?: (s: BlockFrameState) => void;
  onCycle?: (c: ScoredCycle) => void;
  onOptotype?: (event: 'present' | 'timeout', shown: GapOrientation | null) => void;
  onPause?: (paused: boolean) => void;
  onFinish?: (r: BlockResult) => void;
}

export type BlockEndReason = 'complete' | 'interrupted';

export class BlockRunner {
  private clock: FrameClock;
  private readonly stream = new VelocityStream();
  private readonly segmenter: CycleSegmenter;
  private readonly dose = new DoseAccumulator();
  private trials: TrialScheduler;
  private readonly fHats: number[] = [];
  private readonly omegaWindow: number[] = [];
  private framesSinceFft = 0;

  private startTMs = NaN;
  private elapsedMs = 0;
  private pausedAtMs = NaN;
  private lastFrameTMs = NaN;
  private running = false;
  private paused = false;
  private finished = false;
  private faceMissingSinceMs = NaN;

  private readonly targetIntervalMs: number;
  private readonly plausibleAccel: number;
  private readonly prescribedMs: number;

  constructor(
    private readonly opts: {
      index: number;
      video: HTMLVideoElement;
      landmarker: FaceLandmarker;
      card: ProtocolCard;
      callbacks: BlockCallbacks;
      rand?: () => number;
    },
  ) {
    const card = opts.card;
    const bandHi = card.frequencyBand.value[1];
    this.targetIntervalMs = 1000 / minSampleRateHz(bandHi);
    // Peak plausible acceleration for the prescribed motion, from ω = 2πfA:
    // the amplitude implied by the card's own ceiling at its own band centre.
    const impliedAmplitude = card.peakVelocityCeiling.value / (2 * Math.PI * bandCentreHz(card));
    this.plausibleAccel = peakAccelFor(bandCentreHz(card), impliedAmplitude);
    this.prescribedMs = card.blockSeconds.value * 1000;

    this.segmenter = new CycleSegmenter({
      deadbandDegPerSec: deadbandDegPerSec(card.peakVelocityFloor.value),
      fHat: bandCentreHz(card),
      limits: INSTRUMENT_LIMITS,
    });
    this.trials = new TrialScheduler(0, opts.rand);
    this.clock = new FrameClock(opts.video, (t) => this.onFrame(t.tMs, t.intervalMs));
  }

  /** Peak velocity the card's own numbers imply — used only for the ring scale. */
  get ringMax(): number {
    return Math.max(
      this.opts.card.peakVelocityCeiling.value * 1.3,
      peakOmegaFor(bandCentreHz(this.opts.card), 25),
    );
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.finished = false;
    this.clock.start();
  }

  /** `Space`, `visibilitychange`, or sustained face-loss. A pause is RESUMABLE. */
  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.pausedAtMs = performance.now();
    this.opts.callbacks.onPause?.(true);
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (Number.isFinite(this.pausedAtMs)) {
      this.dose.recordPause(this.elapsedMs / 1000, performance.now() - this.pausedAtMs);
    }
    this.pausedAtMs = NaN;
    this.lastFrameTMs = NaN;
    this.opts.callbacks.onPause?.(false);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** `Esc`, or an `end-session` stop-rule outcome. There is NO mid-block resume after an interruption. */
  interrupt(): void {
    if (!this.running) return;
    this.dose.recordInterrupt(this.elapsedMs / 1000);
    this.finish('interrupted');
  }

  answer(orientation: GapOrientation): boolean {
    if (!this.running || this.paused) return false;
    return this.trials.answer(orientation, this.elapsedMs);
  }

  private finish(reason: BlockEndReason): void {
    if (this.finished) return;
    this.finished = true;
    this.running = false;
    this.clock.stop();
    const fHatMedian = this.fHats.length > 0 ? [...this.fHats].sort((a, b) => a - b)[this.fHats.length >> 1]! : NaN;
    this.opts.callbacks.onFinish?.({
      index: this.opts.index,
      prescribedSeconds: this.opts.card.blockSeconds.value,
      dose: this.dose,
      trials: this.trials,
      fHatMedian,
      effectiveFpsMedian: this.clock.effectiveFps(),
      interrupted: reason === 'interrupted',
    });
  }

  private onFrame(tMs: number, intervalMs: number): void {
    if (!this.running || this.finished) return;
    if (!Number.isFinite(this.startTMs)) this.startTMs = tMs;

    if (this.paused) {
      this.lastFrameTMs = tMs;
      return;
    }

    // Elapsed time accumulates from MEASURED frame deltas, so a paused gap is
    // excluded by construction rather than subtracted afterwards.
    if (Number.isFinite(this.lastFrameTMs)) {
      const delta = tMs - this.lastFrameTMs;
      if (delta > 0 && delta < 1000) this.elapsedMs += delta;
    }
    this.lastFrameTMs = tMs;

    // MediaPipe VIDEO mode requires strictly increasing timestamps.
    const detection = this.opts.landmarker.detectForVideo(this.opts.video, performance.now());
    const { facePresent, matrix } = readResult(detection);

    let quality = 0;
    let omega = NaN;

    if (facePresent && matrix.length >= 16) {
      this.faceMissingSinceMs = NaN;
      const pose = poseFromMatrix(matrix);
      const sample = this.stream.push(tMs, pose.yaw);
      if (sample) {
        omega = sample.omega;
        quality = frameQuality({
          facePresent: true,
          frameIntervalMs: Number.isFinite(intervalMs) ? intervalMs : this.targetIntervalMs,
          targetIntervalMs: this.targetIntervalMs,
          fitResidual: orthonormalityResidual(pose.rotation),
          angularAccel: sample.accel,
          plausibleAccel: this.plausibleAccel,
        });

        this.omegaWindow.push(sample.omega);
        if (this.omegaWindow.length > FFT_SIZE) this.omegaWindow.shift();
        this.framesSinceFft += 1;
        // 50 % overlap: a new estimate every half window.
        if (this.omegaWindow.length === FFT_SIZE && this.framesSinceFft >= FFT_SIZE / 2) {
          this.framesSinceFft = 0;
          const fps = this.clock.effectiveFps();
          if (Number.isFinite(fps)) {
            const est = dominantFrequency(this.omegaWindow, fps, { minHz: 0.4, maxHz: 5 });
            if (est.frequencyHz !== null) {
              this.fHats.push(est.frequencyHz);
              this.segmenter.setFHat(est.frequencyHz);
            }
          }
        }

        const cycle = this.segmenter.push({
          tMs,
          omega: sample.omega,
          quality,
          facePresent: true,
        });
        if (cycle) {
          const verdict = scoreCycle(cycle, this.opts.card, INSTRUMENT_LIMITS);
          const scored: ScoredCycle = { ...cycle, credited: verdict.credited, reason: verdict.reason };
          this.dose.add(scored);
          this.opts.callbacks.onCycle?.(scored);
        }
      }
    } else {
      // A zero-face frame sets q = 0 and flags the cycle `face-lost`.
      this.segmenter.push({ tMs, omega: 0, quality: 0, facePresent: false });
      if (!Number.isFinite(this.faceMissingSinceMs)) this.faceMissingSinceMs = tMs;
      // Sustained out-of-frame pauses the block rather than accumulating refusals.
      if (tMs - this.faceMissingSinceMs > 3000) this.pause();
    }

    const trialEvent = this.trials.tick(this.elapsedMs);
    if (trialEvent) this.opts.callbacks.onOptotype?.(trialEvent, this.trials.shown);

    this.opts.callbacks.onFrame?.({
      tMs,
      omega,
      deliveredSeconds: this.dose.deliveredSeconds,
      elapsedMs: this.elapsedMs,
      facePresent,
      quality,
      optotypeShown: this.trials.shown,
      optotypeWindowOpen: this.trials.windowOpen,
    });

    if (this.elapsedMs >= this.prescribedMs) this.finish('complete');
  }
}
