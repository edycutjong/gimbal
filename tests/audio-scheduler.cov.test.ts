import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AudioEngine,
  LookaheadScheduler,
  detuneCents,
  BASE_FREQUENCY_HZ,
  MAX_DETUNE_CENTS,
  LOOKAHEAD_SEC,
  TIMER_INTERVAL_MS,
} from '../src/audio/scheduler.ts';
import { testCard } from './helpers.ts';

/**
 * A substitute Web Audio graph, defined here in `tests/` because neither node
 * nor jsdom implements `AudioContext`. It is not a behavioural pretence: every
 * node RECORDS the automation it was handed — target value, the audio-clock
 * time it was scheduled for, and the time constant — so the assertions below
 * are made against the scheduled parameter automation itself rather than
 * against "the function was called".
 */

interface AutomationEvent {
  readonly value: number;
  readonly time: number;
  readonly timeConstant: number;
}

class RecordingParam {
  value = 0;
  readonly automation: AutomationEvent[] = [];
  setTargetAtTime(value: number, time: number, timeConstant: number): void {
    this.automation.push({ value, time, timeConstant });
  }
}

class RecordingNode {
  readonly outputs: RecordingNode[] = [];
  connect<T extends RecordingNode>(destination: T): T {
    this.outputs.push(destination);
    return destination;
  }
}

class RecordingGain extends RecordingNode {
  readonly gain = new RecordingParam();
}

class RecordingOscillator extends RecordingNode {
  type = '';
  readonly frequency = new RecordingParam();
  readonly detune = new RecordingParam();
  readonly startTimes: number[] = [];
  start(when = 0): void {
    this.startTimes.push(when);
  }
}

/** One click. `when` is the scheduled time; `at` is the clock when it was queued. */
interface ScheduledClick {
  readonly when: number;
  readonly at: number;
}

class RecordingBufferSource extends RecordingNode {
  buffer: unknown = null;
  readonly playbackRate = new RecordingParam();
  constructor(private readonly ctx: RecordingContext) {
    super();
  }
  start(when: number): void {
    this.ctx.clicks.push({ when, at: this.ctx.currentTime });
  }
}

class RecordingBuffer {
  readonly channels: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(i: number): Float32Array {
    return this.channels[i] as Float32Array;
  }
}

class RecordingContext extends RecordingNode {
  static instances: RecordingContext[] = [];
  /** Read by the constructor so a test can decide the pre-gesture state. */
  static initialState: 'running' | 'suspended' = 'running';
  static initialSampleRate = 48000;

  currentTime = 0;
  state: 'running' | 'suspended' | 'closed';
  readonly sampleRate: number;
  readonly destination = new RecordingNode();
  readonly gains: RecordingGain[] = [];
  readonly oscillators: RecordingOscillator[] = [];
  readonly sources: RecordingBufferSource[] = [];
  readonly buffers: RecordingBuffer[] = [];
  readonly clicks: ScheduledClick[] = [];
  readonly resume = vi.fn(async (): Promise<void> => {
    this.state = 'running';
  });
  readonly suspend = vi.fn(async (): Promise<void> => {
    this.state = 'suspended';
  });
  readonly close = vi.fn(async (): Promise<void> => {
    this.state = 'closed';
  });

  constructor() {
    super();
    this.state = RecordingContext.initialState;
    this.sampleRate = RecordingContext.initialSampleRate;
    RecordingContext.instances.push(this);
  }

  createGain(): RecordingGain {
    const g = new RecordingGain();
    this.gains.push(g);
    return g;
  }
  createOscillator(): RecordingOscillator {
    const o = new RecordingOscillator();
    this.oscillators.push(o);
    return o;
  }
  createBufferSource(): RecordingBufferSource {
    const s = new RecordingBufferSource(this);
    this.sources.push(s);
    return s;
  }
  createBuffer(channels: number, length: number, sampleRate: number): RecordingBuffer {
    const b = new RecordingBuffer(channels, length, sampleRate);
    this.buffers.push(b);
    return b;
  }
}

type GlobalWithAudio = { AudioContext?: typeof AudioContext };

function installContext(): void {
  (globalThis as GlobalWithAudio).AudioContext =
    RecordingContext as unknown as typeof AudioContext;
}

function uninstallContext(): void {
  delete (globalThis as GlobalWithAudio).AudioContext;
}

/** The single live context an engine created. */
function ctxOf(): RecordingContext {
  const ctx = RecordingContext.instances[RecordingContext.instances.length - 1];
  if (!ctx) throw new Error('no context was constructed');
  return ctx;
}

/** Runs the engine's real timer against an audio clock that advances with it. */
function runClock(ctx: RecordingContext, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    ctx.currentTime += TIMER_INTERVAL_MS / 1000;
    vi.advanceTimersByTime(TIMER_INTERVAL_MS);
  }
}

beforeEach(() => {
  RecordingContext.instances = [];
  RecordingContext.initialState = 'running';
  RecordingContext.initialSampleRate = 48000;
  installContext();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  uninstallContext();
});

const card = testCard(); // floor 150, ceiling 350 => centre 250, half-width 100

describe('LookaheadScheduler — period changes and a caller-supplied window', () => {
  it('adopts a positive period and ignores a zero or negative one', () => {
    const s = new LookaheadScheduler(0, 0.5);
    expect(s.period).toBe(0.5);

    s.setPeriod(0.25);
    expect(s.period).toBe(0.25);
    s.setPeriod(0);
    expect(s.period).toBe(0.25);
    s.setPeriod(-1);
    expect(s.period).toBe(0.25);

    // The adopted period is the one the emitted times actually use.
    const emitted: number[] = [];
    for (let clock = 0; clock < 2; clock += 0.025) emitted.push(...s.pump(clock));
    expect(emitted.length).toBeGreaterThan(4);
    for (let i = 1; i < emitted.length; i++) {
      expect((emitted[i] as number) - (emitted[i - 1] as number)).toBeCloseTo(0.25, 12);
    }
  });

  it('queues a full window ahead when the lookahead is widened explicitly', () => {
    const wide = new LookaheadScheduler(0, 0.1, 0.55);
    const due = wide.pump(0);
    expect(due.length).toBe(6);
    due.forEach((t, i) => expect(t).toBeCloseTo(i * 0.1, 12));

    const narrow = new LookaheadScheduler(0, 0.1);
    expect(narrow.pump(0).length).toBe(Math.ceil(LOOKAHEAD_SEC / 0.1));
  });
});

describe('detuneCents — degenerate band and non-finite measurement', () => {
  it('returns no bend when the band has no width', () => {
    const flat = testCard({ floor: 250, ceiling: 250 });
    expect(detuneCents(50, flat)).toBe(0);
    expect(detuneCents(250, flat)).toBe(0);
    expect(detuneCents(9999, flat)).toBe(0);
  });

  it('returns no bend for a non-finite peak velocity', () => {
    expect(detuneCents(Number.NaN, card)).toBe(0);
    expect(detuneCents(Number.POSITIVE_INFINITY, card)).toBe(0);
    expect(detuneCents(Number.NEGATIVE_INFINITY, card)).toBe(0);
  });
});

describe('AudioEngine — graph construction', () => {
  it('refuses to start when the browser has no Web Audio', async () => {
    uninstallContext();
    const engine = new AudioEngine();
    await expect(engine.start({ periodSec: 0.5, volume: 0.5 })).rejects.toThrow(
      'Web Audio is unavailable in this browser',
    );
    expect(engine.isRunning).toBe(false);
    expect(engine.contextState).toBe('closed');
  });

  it('reports closed and not-running before the start gesture', () => {
    const engine = new AudioEngine();
    expect(engine.isRunning).toBe(false);
    expect(engine.contextState).toBe('closed');
  });

  it('builds one oscillator, two gains and a generated click buffer', async () => {
    const engine = new AudioEngine();
    await engine.start({ periodSec: 0.5, volume: 0.4 });
    const ctx = ctxOf();

    expect(engine.isRunning).toBe(true);
    expect(engine.contextState).toBe('running');

    const osc = ctx.oscillators[0] as RecordingOscillator;
    expect(ctx.oscillators.length).toBe(1);
    expect(osc.type).toBe('sine');
    expect(osc.frequency.value).toBe(BASE_FREQUENCY_HZ);
    expect(osc.startTimes).toEqual([0]);

    // zone gain first (built silent), click gain second (built at volume).
    const [zoneGain, clickGain] = ctx.gains as [RecordingGain, RecordingGain];
    expect(ctx.gains.length).toBe(2);
    expect(zoneGain.gain.value).toBe(0);
    expect(clickGain.gain.value).toBe(0.4);
    expect(osc.outputs).toEqual([zoneGain]);
    expect(zoneGain.outputs).toEqual([ctx.destination]);
    expect(clickGain.outputs).toEqual([ctx.destination]);

    // One 30 ms mono click, generated — no media file, no decoding.
    const buffer = ctx.buffers[0] as RecordingBuffer;
    expect(ctx.buffers.length).toBe(1);
    expect(buffer.numberOfChannels).toBe(1);
    expect(buffer.length).toBe(Math.floor(48000 * 0.03));
    const data = buffer.getChannelData(0);
    // A decaying transient: it starts at silence, peaks early, and has decayed
    // to near nothing by the end. A beep would not.
    const peak = Math.max(...Array.from(data, Math.abs));
    const peakIndex = Array.from(data, Math.abs).indexOf(peak);
    expect(data[0]).toBe(0);
    expect(peak).toBeGreaterThan(0.05);
    expect(peakIndex).toBeLessThan(data.length / 4);
    expect(Math.abs(data[data.length - 1] as number)).toBeLessThan(peak * 0.05);

    await engine.stop();
  });

  it('generates at least one sample even at an absurdly low sample rate', async () => {
    RecordingContext.initialSampleRate = 8;
    const engine = new AudioEngine();
    await engine.start({ periodSec: 0.5, volume: 0.5 });
    expect((ctxOf().buffers[0] as RecordingBuffer).length).toBe(1);
    await engine.stop();
  });

  it('resumes a context that the autoplay policy left suspended', async () => {
    RecordingContext.initialState = 'suspended';
    const engine = new AudioEngine();
    await engine.start({ periodSec: 0.5, volume: 0.5 });
    const ctx = ctxOf();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(ctx.state).toBe('running');
    await engine.stop();
  });

  it('does not resume, rebuild the graph or double the timer on a second start', async () => {
    const engine = new AudioEngine();
    await engine.start({ periodSec: 0.5, volume: 0.5 });
    const ctx = ctxOf();
    await engine.start({ periodSec: 0.25, volume: 0.5 });

    expect(RecordingContext.instances.length).toBe(1);
    expect(ctx.oscillators.length).toBe(1);
    expect(ctx.gains.length).toBe(2);
    expect(ctx.resume).not.toHaveBeenCalled();

    // A doubled timer would emit each click twice; the times stay unique.
    runClock(ctx, 60);
    const times = ctx.clicks.map((c) => c.when);
    expect(new Set(times).size).toBe(times.length);
    await engine.stop();
  });
});

describe('AudioEngine — gain automation is ramped, never stepped', () => {
  it('ramps zone and click gain to the volume with their own time constants', async () => {
    const engine = new AudioEngine();
    await engine.start({ periodSec: 0.5, volume: 0.5 });
    const ctx = ctxOf();
    const [zoneGain, clickGain] = ctx.gains as [RecordingGain, RecordingGain];

    expect(zoneGain.gain.automation).toEqual([{ value: 0.5 * 0.12, time: 0, timeConstant: 0.05 }]);
    expect(clickGain.gain.automation).toEqual([{ value: 0.5, time: 0, timeConstant: 0.02 }]);

    ctx.currentTime = 3;
    engine.setVolume(0.25);
    expect(zoneGain.gain.automation.at(-1)).toEqual({
      value: 0.25 * 0.12,
      time: 3,
      timeConstant: 0.05,
    });
    expect(clickGain.gain.automation.at(-1)).toEqual({ value: 0.25, time: 3, timeConstant: 0.02 });

    // Clamped at both ends: no gain above unity, none below silence.
    engine.setVolume(4);
    expect(clickGain.gain.automation.at(-1)?.value).toBe(1);
    expect(zoneGain.gain.automation.at(-1)?.value).toBeCloseTo(0.12, 12);
    engine.setVolume(-2);
    expect(clickGain.gain.automation.at(-1)?.value).toBe(0);
    expect(zoneGain.gain.automation.at(-1)?.value).toBe(0);

    await engine.stop();
  });

  it('mutes to zero and restores the prior volume, changing nothing else', async () => {
    const engine = new AudioEngine();
    await engine.start({ periodSec: 0.5, volume: 0.8 });
    const ctx = ctxOf();
    const [zoneGain, clickGain] = ctx.gains as [RecordingGain, RecordingGain];

    engine.setMuted(true);
    expect(zoneGain.gain.automation.at(-1)?.value).toBe(0);
    expect(clickGain.gain.automation.at(-1)?.value).toBe(0);

    engine.setMuted(false);
    expect(zoneGain.gain.automation.at(-1)?.value).toBeCloseTo(0.8 * 0.12, 12);
    expect(clickGain.gain.automation.at(-1)?.value).toBe(0.8);

    await engine.stop();
  });

  it('accepts volume and mute changes before the graph exists', () => {
    const engine = new AudioEngine();
    engine.setVolume(0.9);
    engine.setMuted(true);
    engine.setMuted(false);
    expect(RecordingContext.instances.length).toBe(0);
    expect(engine.isRunning).toBe(false);
  });

  it('starts at the volume that was set before the graph existed', async () => {
    const engine = new AudioEngine();
    engine.setVolume(0.3);
    await engine.start({ periodSec: 0.5, volume: 0.3 });
    const [, clickGain] = ctxOf().gains as [RecordingGain, RecordingGain];
    expect(clickGain.gain.value).toBe(0.3);
    await engine.stop();
  });
});

describe('AudioEngine — the bend carries the zone state', () => {
  it('does nothing before the oscillator exists', () => {
    const engine = new AudioEngine();
    engine.setDetune(300);
    expect(RecordingContext.instances.length).toBe(0);
  });

  it('bends flat below the band, centres inside it and bends sharp above it', async () => {
    const engine = new AudioEngine();
    await engine.start({ periodSec: 0.5, volume: 0.5 });
    const ctx = ctxOf();
    const osc = ctx.oscillators[0] as RecordingOscillator;

    // A peak velocity sweeping out of the bottom of the band, through it, and
    // out of the top: the tone must follow monotonically and clamp at the edges.
    const sweep = [50, 150, 200, 250, 300, 350, 900];
    sweep.forEach((omega, i) => {
      ctx.currentTime = i;
      engine.setDetune(detuneCents(omega, card));
    });

    expect(osc.detune.automation.map((a) => a.value)).toEqual([
      -MAX_DETUNE_CENTS,
      -MAX_DETUNE_CENTS,
      -MAX_DETUNE_CENTS / 2,
      0,
      MAX_DETUNE_CENTS / 2,
      MAX_DETUNE_CENTS,
      MAX_DETUNE_CENTS,
    ]);
    // Every bend is scheduled at the audio clock, and ramped, never stepped.
    expect(osc.detune.automation.map((a) => a.time)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(osc.detune.automation.every((a) => a.timeConstant === 0.08)).toBe(true);
    expect(osc.detune.value).toBe(0); // never assigned directly

    await engine.stop();
  });
});

describe('AudioEngine — the click train', () => {
  it('schedules clicks one period apart, always ahead of the clock', async () => {
    const engine = new AudioEngine();
    await engine.start({ periodSec: 0.5, volume: 0.5 });
    const ctx = ctxOf();
    runClock(ctx, 200); // 5 s of audio clock

    expect(ctx.clicks.length).toBeGreaterThan(8);
    // The first click lands 50 ms after the start gesture — the deliberate
    // offset that keeps it out of the past.
    expect((ctx.clicks[0] as ScheduledClick).when).toBeCloseTo(0.05, 12);
    for (let i = 1; i < ctx.clicks.length; i++) {
      const prev = (ctx.clicks[i - 1] as ScheduledClick).when;
      const now = (ctx.clicks[i] as ScheduledClick).when;
      expect(now - prev).toBeCloseTo(0.5, 12);
    }
    for (const click of ctx.clicks) {
      expect(click.when).toBeGreaterThanOrEqual(click.at);
      expect(click.when).toBeLessThan(click.at + LOOKAHEAD_SEC + 1e-9);
    }
    // Every click is one source off the shared buffer, routed through the click
    // gain — no new node type, no media file.
    const buffer = ctx.buffers[0] as RecordingBuffer;
    const clickGain = ctx.gains[1] as RecordingGain;
    expect(ctx.sources.length).toBe(ctx.clicks.length);
    for (const src of ctx.sources) {
      expect(src.buffer).toBe(buffer);
      expect(src.outputs).toEqual([clickGain]);
    }

    await engine.stop();
  });

  it('changes the click period mid-block without dropping the train', async () => {
    const engine = new AudioEngine();
    await engine.start({ periodSec: 1, volume: 0.5 });
    const ctx = ctxOf();
    runClock(ctx, 120); // 3 s at one click per second
    const slow = ctx.clicks.length;
    expect(slow).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < slow; i++) {
      const prev = (ctx.clicks[i - 1] as ScheduledClick).when;
      const now = (ctx.clicks[i] as ScheduledClick).when;
      expect(now - prev).toBeCloseTo(1, 12);
    }

    engine.setPeriod(0.25);
    runClock(ctx, 120); // 3 s at four clicks per second
    const fast = ctx.clicks.slice(slow);
    expect(fast.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < fast.length; i++) {
      const prev = (fast[i - 1] as ScheduledClick).when;
      const now = (fast[i] as ScheduledClick).when;
      expect(now - prev).toBeCloseTo(0.25, 12);
    }

    await engine.stop();
  });

  it('ignores a period change made before the block starts', async () => {
    const engine = new AudioEngine();
    engine.setPeriod(0.25); // no scheduler yet — must not throw
    await engine.start({ periodSec: 0.5, volume: 0.5 });
    const ctx = ctxOf();
    runClock(ctx, 100);
    expect(ctx.clicks.length).toBeGreaterThan(2);
    for (let i = 1; i < ctx.clicks.length; i++) {
      const prev = (ctx.clicks[i - 1] as ScheduledClick).when;
      const now = (ctx.clicks[i] as ScheduledClick).when;
      expect(now - prev).toBeCloseTo(0.5, 12); // the start option won
    }
    await engine.stop();
  });

  it('queues nothing when the pump runs without a graph', () => {
    const engine = new AudioEngine();
    (engine as unknown as { pump(): void }).pump();
    expect(RecordingContext.instances.length).toBe(0);
  });
});

describe('AudioEngine — the refusal earcon', () => {
  it('is silent before the graph exists', () => {
    const engine = new AudioEngine();
    engine.refusalEarcon();
    expect(RecordingContext.instances.length).toBe(0);
  });

  it('replays the click buffer at 0.6x and -6 dB through the click gain', async () => {
    const engine = new AudioEngine();
    await engine.start({ periodSec: 0.5, volume: 0.5 });
    const ctx = ctxOf();
    ctx.currentTime = 10;
    const before = ctx.sources.length;

    engine.refusalEarcon();

    expect(ctx.sources.length).toBe(before + 1);
    const src = ctx.sources[before] as RecordingBufferSource;
    expect(src.buffer).toBe(ctx.buffers[0]);
    expect(src.playbackRate.value).toBe(0.6);
    // src -> a fresh -6 dB gain -> the click gain. No new node type.
    const attenuator = src.outputs[0] as RecordingGain;
    expect(attenuator).toBe(ctx.gains[2]);
    expect(attenuator.gain.value).toBe(0.5);
    expect(attenuator.outputs).toEqual([ctx.gains[1]]);
    // Fired now, not scheduled into the click train's future.
    expect((ctx.clicks.at(-1) as ScheduledClick).when).toBe(10);

    await engine.stop();
  });

  it('is rate-limited to once per two seconds', async () => {
    const engine = new AudioEngine();
    await engine.start({ periodSec: 0.5, volume: 0.5 });
    const ctx = ctxOf();
    ctx.currentTime = 10;
    const before = ctx.sources.length;

    engine.refusalEarcon();
    ctx.currentTime = 11.5;
    engine.refusalEarcon(); // inside the window — suppressed
    expect(ctx.sources.length).toBe(before + 1);

    ctx.currentTime = 12.5;
    engine.refusalEarcon(); // 2.5 s after the last one — allowed
    expect(ctx.sources.length).toBe(before + 2);

    await engine.stop();
  });

  it('is silent while muted, and the rate limiter does not advance', async () => {
    const engine = new AudioEngine();
    await engine.start({ periodSec: 0.5, volume: 0.5 });
    const ctx = ctxOf();
    ctx.currentTime = 10;
    const before = ctx.sources.length;

    engine.setMuted(true);
    engine.refusalEarcon();
    expect(ctx.sources.length).toBe(before);

    engine.setMuted(false);
    engine.refusalEarcon(); // same instant, but nothing was consumed
    expect(ctx.sources.length).toBe(before + 1);

    await engine.stop();
  });
});

describe('AudioEngine — suspend and stop', () => {
  it('suspends without tearing the graph down, and resumes the same nodes', async () => {
    const engine = new AudioEngine();
    await engine.start({ periodSec: 0.5, volume: 0.5 });
    const ctx = ctxOf();
    runClock(ctx, 100);
    const during = ctx.clicks.length;
    expect(during).toBeGreaterThan(0);

    await engine.suspend();
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
    expect(engine.isRunning).toBe(false);
    expect(engine.contextState).toBe('suspended');

    runClock(ctx, 100);
    expect(ctx.clicks.length).toBe(during); // the timer really stopped

    await engine.start({ periodSec: 0.5, volume: 0.5 });
    expect(RecordingContext.instances.length).toBe(1);
    expect(ctx.oscillators.length).toBe(1);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    runClock(ctx, 100);
    expect(ctx.clicks.length).toBeGreaterThan(during);

    await engine.stop();
  });

  it('is idempotent: a second suspend touches neither the timer nor the context', async () => {
    const engine = new AudioEngine();
    await engine.start({ periodSec: 0.5, volume: 0.5 });
    const ctx = ctxOf();
    await engine.suspend();
    await engine.suspend();
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
    await engine.stop();
  });

  it('suspends nothing when there is no context at all', async () => {
    const engine = new AudioEngine();
    await engine.suspend();
    expect(RecordingContext.instances.length).toBe(0);
    expect(engine.isRunning).toBe(false);
  });

  it('closes the context and releases every node on stop', async () => {
    const engine = new AudioEngine();
    await engine.start({ periodSec: 0.5, volume: 0.5 });
    const ctx = ctxOf();
    runClock(ctx, 60);
    const during = ctx.clicks.length;

    await engine.stop();
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(engine.isRunning).toBe(false);
    expect(engine.contextState).toBe('closed');

    // Nothing survives the teardown: no timer, no earcon, no bend, no gain.
    runClock(ctx, 60);
    engine.refusalEarcon();
    engine.setDetune(400);
    engine.setVolume(1);
    engine.setPeriod(0.1);
    expect(ctx.clicks.length).toBe(during);
    expect(ctx.sources.length).toBe(during);
    expect((ctx.oscillators[0] as RecordingOscillator).detune.automation.length).toBe(0);
  });

  it('is idempotent: a second stop closes nothing twice', async () => {
    const engine = new AudioEngine();
    await engine.start({ periodSec: 0.5, volume: 0.5 });
    const ctx = ctxOf();
    await engine.stop();
    await engine.stop();
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it('starts a brand new context after a stop', async () => {
    const engine = new AudioEngine();
    await engine.start({ periodSec: 0.5, volume: 0.5 });
    await engine.stop();
    await engine.start({ periodSec: 0.5, volume: 0.5 });
    expect(RecordingContext.instances.length).toBe(2);
    expect(engine.isRunning).toBe(true);
    await engine.stop();
  });
});
