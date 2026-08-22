import type { CycleOutcome } from '../dsp/types.ts';

/**
 * Two live regions, with strict discipline.
 *
 * The ring is `aria-hidden="true"` — an SVG whose attributes change 30 times a
 * second is hostile to assistive technology — and its information is carried
 * entirely by the polite status region IN WORDS. That is a deliberate choice,
 * not an omission, and it is why the status region exists at all.
 *
 * Rules that keep this usable rather than a firehose:
 *   · text is rewritten only on STATE CHANGE, at most once per 2 s
 *   · identical strings are never re-announced
 *   · refusals COALESCE: three consecutive `too-slow` refusals announce once as
 *     "3 reps not counted — too slow."
 */
export const ANNOUNCE_FLOOR_MS = 2000;

export class LiveRegions {
  private lastText = '';
  private lastAtMs = -Infinity;
  private pendingReason: CycleOutcome | null = null;
  private pendingCount = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly status: HTMLElement,
    private readonly alert: HTMLElement,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Polite: zone state changes, refusals, screen changes, setup verdicts. */
  say(text: string, force = false): void {
    const t = this.now();
    if (!force && (text === this.lastText || t - this.lastAtMs < ANNOUNCE_FLOOR_MS)) return;
    this.lastText = text;
    this.lastAtMs = t;
    this.status.textContent = text;
  }

  /**
   * Assertive, and reserved for EXACTLY TWO events: the `end-session` stop-rule
   * outcome, and sustained tracking loss. Nothing else may use this region.
   */
  alertOnly(event: 'end-session' | 'tracking-lost', text: string): void {
    void event;
    this.alert.textContent = text;
  }

  /** Refusals coalesce over the 2 s floor rather than announcing one per cycle. */
  announceRefusal(reason: CycleOutcome, phrase: string): void {
    if (reason === 'ok') return;
    if (this.pendingReason === reason) {
      this.pendingCount += 1;
    } else {
      this.flush();
      this.pendingReason = reason;
      this.pendingCount = 1;
    }
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => this.flush(phrase), ANNOUNCE_FLOOR_MS);
    }
  }

  private flush(phrase?: string): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.pendingReason || this.pendingCount === 0) return;
    const label = phrase ?? this.pendingReason;
    const text =
      this.pendingCount === 1
        ? `1 rep not counted — ${label}.`
        : `${this.pendingCount} reps not counted — ${label}.`;
    this.status.textContent = text;
    this.lastText = text;
    this.lastAtMs = this.now();
    this.pendingReason = null;
    this.pendingCount = 0;
  }

  reset(): void {
    this.flush();
    this.lastText = '';
    this.lastAtMs = -Infinity;
    this.status.textContent = '';
    this.alert.textContent = '';
  }
}
