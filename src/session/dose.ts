import type { CycleOutcome, ScoredCycle } from '../dsp/types.ts';
import { REFUSAL_REASONS } from '../dsp/types.ts';

/**
 * Dose accumulation.
 *
 * Delivered dose is a COUNT — seconds of credited cycle time — which is why it
 * is exact by construction and why no confidence interval is quoted for it. A
 * refused cycle adds exactly 0.000 s. That is the entire integrity claim, and
 * it is one line of arithmetic.
 */

export interface Interruption {
  kind: 'pause' | 'interrupt';
  atSeconds: number;
  durationMs: number;
}

export function emptyRefusalTally(): Record<CycleOutcome, number> {
  return {
    ok: 0,
    'too-slow': 0,
    'too-fast': 0,
    'off-cadence': 0,
    'low-confidence': 0,
    'face-lost': 0,
  };
}

export class DoseAccumulator {
  private deliveredMs = 0;
  private readonly tally = emptyRefusalTally();
  readonly cycles: ScoredCycle[] = [];
  readonly interruptions: Interruption[] = [];

  add(cycle: ScoredCycle): void {
    this.cycles.push(cycle);
    this.tally[cycle.reason] += 1;
    if (cycle.credited) this.deliveredMs += cycle.periodMs;
  }

  recordPause(atSeconds: number, durationMs: number): void {
    this.interruptions.push({ kind: 'pause', atSeconds, durationMs });
  }

  recordInterrupt(atSeconds: number): void {
    this.interruptions.push({ kind: 'interrupt', atSeconds, durationMs: 0 });
  }

  /** Seconds of credited cycle time. Never negative. */
  get deliveredSeconds(): number {
    return Math.max(0, this.deliveredMs / 1000);
  }

  get attempted(): number {
    return this.cycles.length;
  }

  get credited(): number {
    return this.tally.ok;
  }

  get refused(): number {
    return this.attempted - this.credited;
  }

  /** Five refusal reasons. `ok` is the credited case, not a refusal. */
  refusals(): Record<Exclude<CycleOutcome, 'ok'>, number> {
    const out = {} as Record<Exclude<CycleOutcome, 'ok'>, number>;
    for (const r of REFUSAL_REASONS) {
      if (r === 'ok') continue;
      out[r as Exclude<CycleOutcome, 'ok'>] = this.tally[r];
    }
    return out;
  }

  outcomes(): Record<CycleOutcome, number> {
    return { ...this.tally };
  }

  get pausedMs(): number {
    return this.interruptions.filter((i) => i.kind === 'pause').reduce((a, i) => a + i.durationMs, 0);
  }

  get pauseCount(): number {
    return this.interruptions.filter((i) => i.kind === 'pause').length;
  }

  get interrupted(): boolean {
    return this.interruptions.some((i) => i.kind === 'interrupt');
  }

  /** Saturated cycles are refused, never clipped — this is the count the report prints. */
  get saturatedCycles(): number {
    return this.cycles.filter((c) => c.saturated).length;
  }

  peakVelocities(): number[] {
    return this.cycles.map((c) => c.peakOmega);
  }
}

/**
 * Block elapsed time EXCLUDING paused intervals. A pause is not therapy time and
 * must not silently inflate the denominator the delivered ratio is read against.
 */
export function elapsedExcludingPauses(wallClockMs: number, interruptions: readonly Interruption[]): number {
  const paused = interruptions.filter((i) => i.kind === 'pause').reduce((a, i) => a + i.durationMs, 0);
  return Math.max(0, wallClockMs - paused);
}

/** "paused N× (S s)" — derived from the interruption list, never stored twice. */
export function pauseSummary(interruptions: readonly Interruption[]): string | null {
  const pauses = interruptions.filter((i) => i.kind === 'pause');
  if (pauses.length === 0) return null;
  const seconds = Math.round(pauses.reduce((a, i) => a + i.durationMs, 0) / 1000);
  return `paused ${pauses.length}× (${seconds} s)`;
}
