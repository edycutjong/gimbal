import type { ProtocolCard } from '../protocol/card.ts';
import { velocityCentre } from '../protocol/card.ts';

/**
 * Audio — the eyes-free channel, and why it is structural rather than a flourish.
 *
 * During the exercise the patient's eyes are on the optotype. They CANNOT look
 * at the dial. If the only feedback channel were visual, the interface would
 * have no channel to the user during the only six minutes that matter. Audio is
 * therefore the sole coaching path in the hero flow, and the ring is the
 * redundant channel rather than the load-bearing one.
 *
 * Zone state is encoded as a CONTINUOUS PARAMETER, not as an event: one
 * oscillator runs for the whole block and its `detune` is ramped as a function
 * of (peak ω − band centre). A 20–50 ms output-latency difference between
 * machines is completely inaudible inside a pitch ramp, whereas the same
 * difference is audible as jitter in a re-scheduled click train. Choosing a
 * latency-insensitive encoding removes cross-device audio sync from the risk
 * register rather than mitigating it.
 */

/** How far ahead of the audio clock events are queued. */
export const LOOKAHEAD_SEC = 0.1;
/** How often the queueing timer runs. The standard two-clock pattern. */
export const TIMER_INTERVAL_MS = 25;

/**
 * The pure half of the scheduler: given a clock and a period, emit event times
 * that are always in the future and always exactly one period apart.
 *
 * Separated from Web Audio so it can be unit-tested against a simulated clock
 * with injected jitter — which is the only way to assert "never schedules an
 * event in the past" without a browser.
 */
export class LookaheadScheduler {
  private nextEventTime: number;

  constructor(
    startTime: number,
    private periodSec: number,
    private readonly lookaheadSec = LOOKAHEAD_SEC,
  ) {
    this.nextEventTime = startTime;
  }

  setPeriod(periodSec: number): void {
    if (periodSec > 0) this.periodSec = periodSec;
  }

  get period(): number {
    return this.periodSec;
  }

  /**
   * Returns every event time due within the lookahead window. Period stability
   * is exact — each time is derived from the previous scheduled time, never
   * from the wall clock, so timer jitter cannot accumulate into drift.
   */
  pump(now: number): number[] {
    const due: number[] = [];
    // A clock that jumped forward (a stalled tab, a suspended context) must not
    // produce a burst of past-dated events.
    if (this.nextEventTime < now) {
      const missed = Math.ceil((now - this.nextEventTime) / this.periodSec);
      this.nextEventTime += missed * this.periodSec;
    }
    while (this.nextEventTime < now + this.lookaheadSec) {
      due.push(this.nextEventTime);
      this.nextEventTime += this.periodSec;
    }
    return due;
  }
}

/** Maximum pitch bend, in cents, at and beyond the edges of the band. */
export const MAX_DETUNE_CENTS = 700;

/**
 * Velocity → detune. Below the band the tone bends FLAT; above it, sharp; in
 * the band it centres.
 *
 * Monotonic in `peakOmega` and clamped at both ends, so a wildly wrong
 * measurement cannot produce a painful pitch. Direction of error is carried by
 * the direction of the bend — which costs no fixation at all — and never by hue.
 */
export function detuneCents(peakOmega: number, card: ProtocolCard): number {
  const centre = velocityCentre(card);
  const halfWidth = (card.peakVelocityCeiling.value - card.peakVelocityFloor.value) / 2;
  if (!(halfWidth > 0) || !Number.isFinite(peakOmega)) return 0;
  const normalised = (peakOmega - centre) / halfWidth;
  return Math.max(-MAX_DETUNE_CENTS, Math.min(MAX_DETUNE_CENTS, normalised * MAX_DETUNE_CENTS));
}

/** Base pitch of the zone tone. An arbitrary comfortable pitch, not a measurement. */
export const BASE_FREQUENCY_HZ = 220;

export interface AudioEngineOptions {
  /** Click period in seconds — one click per prescribed cycle. */
  periodSec: number;
  volume: number;
}

/**
 * The Web Audio graph. One `AudioContext`, one oscillator, one gain, one
 * generated click buffer. No `<audio>` elements, no media files, no decoding.
 *
 * The context is created and `resume()`d inside the Start click — the ONE place
 * the autoplay policy is handled.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private zoneGain: GainNode | null = null;
  private clickGain: GainNode | null = null;
  private clickBuffer: AudioBuffer | null = null;
  private scheduler: LookaheadScheduler | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastEarconAt = -Infinity;
  private muted = false;
  private volume = 0.5;

  get isRunning(): boolean {
    return this.ctx !== null && this.timer !== null;
  }

  get contextState(): string {
    return this.ctx?.state ?? 'closed';
  }

  /** Called from the Start click and from the setup screen's audio check. Nowhere else. */
  async start(opts: AudioEngineOptions): Promise<void> {
    this.volume = opts.volume;
    if (!this.ctx) {
      const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
      if (!Ctor) throw new Error('Web Audio is unavailable in this browser');
      this.ctx = new Ctor();
      this.clickBuffer = makeClickBuffer(this.ctx);

      this.zoneGain = this.ctx.createGain();
      this.zoneGain.gain.value = 0;
      this.zoneGain.connect(this.ctx.destination);

      this.osc = this.ctx.createOscillator();
      this.osc.type = 'sine';
      this.osc.frequency.value = BASE_FREQUENCY_HZ;
      this.osc.connect(this.zoneGain);
      this.osc.start();

      this.clickGain = this.ctx.createGain();
      this.clickGain.gain.value = this.volume;
      this.clickGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.scheduler = new LookaheadScheduler(this.ctx.currentTime + 0.05, opts.periodSec);
    this.applyGain();
    if (this.timer === null) {
      this.timer = setInterval(() => this.pump(), TIMER_INTERVAL_MS);
    }
  }

  setPeriod(periodSec: number): void {
    this.scheduler?.setPeriod(periodSec);
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyGain();
  }

  /**
   * `[ I can't use sound ]` mutes the graph and CHANGES NOTHING VISUAL — a
   * ring-luminance boost would breach the block screen's luminance-area budget,
   * and the report states the degradation in words instead of pretending
   * visual-only coaching is equivalent.
   */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  private applyGain(): void {
    if (!this.ctx || !this.zoneGain || !this.clickGain) return;
    const level = this.muted ? 0 : this.volume;
    const now = this.ctx.currentTime;
    this.zoneGain.gain.setTargetAtTime(level * 0.12, now, 0.05);
    this.clickGain.gain.setTargetAtTime(level, now, 0.02);
  }

  /** Ramped, never stepped — the bend is what carries the zone state. */
  setDetune(cents: number): void {
    if (!this.ctx || !this.osc) return;
    this.osc.detune.setTargetAtTime(cents, this.ctx.currentTime, 0.08);
  }

  /**
   * The refusal earcon: the existing click buffer replayed at 0.6× and −6 dB.
   * No new audio node, no media file, no decoding. This is the ONLY event in an
   * otherwise continuous design, and it is rate-limited to once per 2 s.
   */
  refusalEarcon(): void {
    if (!this.ctx || !this.clickBuffer || !this.clickGain || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastEarconAt < 2) return;
    this.lastEarconAt = now;
    const src = this.ctx.createBufferSource();
    src.buffer = this.clickBuffer;
    src.playbackRate.value = 0.6;
    const g = this.ctx.createGain();
    g.gain.value = 0.5; // −6 dB
    src.connect(g).connect(this.clickGain);
    src.start(now);
  }

  private pump(): void {
    if (!this.ctx || !this.scheduler || !this.clickBuffer || !this.clickGain) return;
    for (const t of this.scheduler.pump(this.ctx.currentTime)) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.clickBuffer;
      src.connect(this.clickGain);
      src.start(t);
    }
  }

  /** Suspends without tearing the graph down — a pause is resumable. */
  async suspend(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend();
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
      this.osc = null;
      this.zoneGain = null;
      this.clickGain = null;
      this.clickBuffer = null;
      this.scheduler = null;
    }
  }
}

/** A short filtered click, generated at init. Never a beep — hyperacusis is on the same symptom checklists. */
function makeClickBuffer(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sr * 0.03));
  const buffer = ctx.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);
  let lowpass = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sr;
    const envelope = Math.exp(-t * 90);
    const raw = Math.sin(2 * Math.PI * 900 * t) * envelope;
    lowpass += (raw - lowpass) * 0.25;
    data[i] = lowpass * 0.6;
  }
  return buffer;
}
