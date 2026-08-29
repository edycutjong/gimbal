// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LiveRegions, ANNOUNCE_FLOOR_MS } from '../src/ui/live.ts';
import type { CycleOutcome } from '../src/dsp/types.ts';

/**
 * The accessibility contract, asserted as behaviour rather than as a comment:
 *
 *   · the ring is `aria-hidden` and carries NO information of its own — every
 *     thing it shows must arrive at the polite `role="status"` region in words
 *   · `role="alert"` (assertive) is reserved for exactly two events
 *   · announcements are floored at 2 s, deduplicated, and refusals coalesce
 *
 * These tests are written so that loosening the discipline in `live.ts` breaks
 * them: the assertive region is checked to stay EMPTY across the whole polite
 * surface of the API, not merely checked to be non-empty for its two events.
 */

/** The real markup shape: a hidden ring plus the two live regions beside it. */
function mountRegions(): { status: HTMLElement; alert: HTMLElement; ring: SVGElement } {
  document.body.innerHTML = `
    <svg id="ring" aria-hidden="true"><circle r="10"></circle></svg>
    <p id="live-status" role="status" aria-live="polite" aria-atomic="true"></p>
    <p id="live-alert" role="alert" aria-live="assertive" aria-atomic="true"></p>
  `;
  const status = document.getElementById('live-status') as HTMLElement;
  const alert = document.getElementById('live-alert') as HTMLElement;
  const ring = document.getElementById('ring') as unknown as SVGElement;
  return { status, alert, ring };
}

/** A clock we drive by hand, so the 2 s floor is tested rather than waited on. */
function clock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

let status: HTMLElement;
let alert: HTMLElement;
let ring: SVGElement;

beforeEach(() => {
  vi.useFakeTimers();
  ({ status, alert, ring } = mountRegions());
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('the two-region discipline', () => {
  it('mounts a polite status region next to an aria-hidden ring', () => {
    expect(ring.getAttribute('aria-hidden')).toBe('true');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
  });

  it('carries the ring information in words on the POLITE region only', () => {
    const c = clock(1_000);
    const live = new LiveRegions(status, alert, c.now);

    // What the ring draws, said in words: zone, velocity, credit.
    live.say('In zone. 210 degrees per second. 12 reps counted.');

    expect(status.textContent).toBe('In zone. 210 degrees per second. 12 reps counted.');
    // The ring itself never gains text — it stays a decorative, hidden graphic.
    expect(ring.textContent).toBe('');
    // And the assertive region is untouched by an ordinary state change.
    expect(alert.textContent).toBe('');
  });

  it('reserves the assertive region for exactly two events', () => {
    const c = clock(0);
    const live = new LiveRegions(status, alert, c.now);

    live.alertOnly('end-session', 'Session ended — symptom stop rule.');
    expect(alert.textContent).toBe('Session ended — symptom stop rule.');
    // An alert does not also write the polite region.
    expect(status.textContent).toBe('');

    c.advance(ANNOUNCE_FLOOR_MS);
    live.alertOnly('tracking-lost', 'Face lost. Recentre in the frame.');
    expect(alert.textContent).toBe('Face lost. Recentre in the frame.');
    expect(status.textContent).toBe('');
  });

  it('never writes the assertive region from any polite path', () => {
    const c = clock(0);
    const live = new LiveRegions(status, alert, c.now);

    live.say('Setup complete.');
    c.advance(ANNOUNCE_FLOOR_MS);
    live.say('Block 1 of 3.', true);
    live.announceRefusal('too-slow', 'too slow');
    vi.advanceTimersByTime(ANNOUNCE_FLOOR_MS);

    expect(status.textContent).toBe('1 rep not counted — too slow.');
    expect(alert.textContent).toBe('');
  });
});

describe('say()', () => {
  it('announces the first string immediately', () => {
    const c = clock(5_000);
    const live = new LiveRegions(status, alert, c.now);

    live.say('Out of zone — speed up.');

    expect(status.textContent).toBe('Out of zone — speed up.');
  });

  it('suppresses a repeat of the identical string even after the floor', () => {
    const c = clock(0);
    const live = new LiveRegions(status, alert, c.now);

    live.say('In zone.');
    c.advance(ANNOUNCE_FLOOR_MS * 10);
    live.say('In zone.');
    expect(status.textContent).toBe('In zone.');

    // Proof the suppression happened at the guard, not merely looked the same:
    // a hand-edit of the node is not overwritten by the suppressed call.
    status.textContent = 'MUTATED';
    live.say('In zone.');
    expect(status.textContent).toBe('MUTATED');
  });

  it('suppresses a DIFFERENT string inside the 2 s floor', () => {
    const c = clock(0);
    const live = new LiveRegions(status, alert, c.now);

    live.say('In zone.');
    c.advance(ANNOUNCE_FLOOR_MS - 1);
    live.say('Out of zone.');
    expect(status.textContent).toBe('In zone.');

    // Exactly at the floor it is allowed through.
    c.advance(1);
    live.say('Out of zone.');
    expect(status.textContent).toBe('Out of zone.');
  });

  it('force=true overrides both the dedup and the floor, and re-arms them', () => {
    const c = clock(0);
    const live = new LiveRegions(status, alert, c.now);

    live.say('Block 1 of 3.');
    status.textContent = '';
    // Same string, zero elapsed time — both guards would normally refuse.
    live.say('Block 1 of 3.', true);
    expect(status.textContent).toBe('Block 1 of 3.');

    // The forced call still stamped lastAtMs, so the floor applies after it.
    c.advance(ANNOUNCE_FLOOR_MS - 1);
    live.say('Block 2 of 3.');
    expect(status.textContent).toBe('Block 1 of 3.');
  });

  it('falls back to Date.now() when no clock is injected', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const live = new LiveRegions(status, alert);

    live.say('Ready.');
    expect(status.textContent).toBe('Ready.');

    // The default clock is the real timeline: advancing it past the floor lets
    // the next string through, which only works if `now` read Date.now().
    live.say('Ready to start.');
    expect(status.textContent).toBe('Ready.');

    vi.setSystemTime(new Date('2026-01-01T00:00:03Z'));
    live.say('Ready to start.');
    expect(status.textContent).toBe('Ready to start.');
  });
});

describe('announceRefusal()', () => {
  it('ignores the `ok` outcome entirely — no text, no timer', () => {
    const c = clock(0);
    const live = new LiveRegions(status, alert, c.now);

    live.announceRefusal('ok', 'counted');
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(ANNOUNCE_FLOOR_MS * 2);
    expect(status.textContent).toBe('');
  });

  it('announces a single refusal in the singular after the floor', () => {
    const c = clock(0);
    const live = new LiveRegions(status, alert, c.now);

    live.announceRefusal('too-slow', 'too slow');
    // Nothing is said yet — the announcement waits out the floor.
    expect(status.textContent).toBe('');

    vi.advanceTimersByTime(ANNOUNCE_FLOOR_MS);
    expect(status.textContent).toBe('1 rep not counted — too slow.');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('coalesces three identical refusals into one plural announcement', () => {
    const c = clock(0);
    const live = new LiveRegions(status, alert, c.now);

    live.announceRefusal('too-slow', 'too slow');
    live.announceRefusal('too-slow', 'too slow');
    live.announceRefusal('too-slow', 'too slow');
    // One timer for all three: the second and third reuse the pending one.
    expect(vi.getTimerCount()).toBe(1);
    expect(status.textContent).toBe('');

    vi.advanceTimersByTime(ANNOUNCE_FLOOR_MS);
    expect(status.textContent).toBe('3 reps not counted — too slow.');
  });

  it('flushes the pending run with the RAW reason when the reason changes', () => {
    const c = clock(0);
    const live = new LiveRegions(status, alert, c.now);

    live.announceRefusal('too-slow', 'too slow');
    live.announceRefusal('too-slow', 'too slow');
    // A different reason cuts the run short and announces it immediately,
    // labelled with the outcome itself because no phrase is at hand.
    live.announceRefusal('too-fast', 'too fast');
    expect(status.textContent).toBe('2 reps not counted — too-slow.');

    // The changed reason then starts a fresh, freshly-armed run.
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(ANNOUNCE_FLOOR_MS);
    expect(status.textContent).toBe('1 rep not counted — too fast.');
  });

  it('lets a coalesced announcement suppress an identical say() afterwards', () => {
    const c = clock(0);
    const live = new LiveRegions(status, alert, c.now);

    live.announceRefusal('off-cadence', 'off cadence');
    live.announceRefusal('off-cadence', 'off cadence');
    vi.advanceTimersByTime(ANNOUNCE_FLOOR_MS);
    expect(status.textContent).toBe('2 reps not counted — off cadence.');

    // flush() stamped lastText/lastAtMs, so the same words are not repeated.
    status.textContent = 'MUTATED';
    c.advance(ANNOUNCE_FLOOR_MS * 5);
    live.say('2 reps not counted — off cadence.');
    expect(status.textContent).toBe('MUTATED');
  });

  it('handles every refusal reason and never the assertive region', () => {
    const reasons: CycleOutcome[] = [
      'too-slow',
      'too-fast',
      'off-cadence',
      'low-confidence',
      'face-lost',
    ];
    const c = clock(0);

    for (const reason of reasons) {
      const live = new LiveRegions(status, alert, c.now);
      live.announceRefusal(reason, reason);
      vi.advanceTimersByTime(ANNOUNCE_FLOOR_MS);
      expect(status.textContent).toBe(`1 rep not counted — ${reason}.`);
      expect(alert.textContent).toBe('');
      live.reset();
    }
  });
});

describe('reset()', () => {
  it('clears both regions and the dedup memory', () => {
    const c = clock(0);
    const live = new LiveRegions(status, alert, c.now);

    live.say('In zone.');
    live.alertOnly('tracking-lost', 'Face lost.');
    expect(status.textContent).toBe('In zone.');

    live.reset();
    expect(status.textContent).toBe('');
    expect(alert.textContent).toBe('');

    // lastAtMs went back to -Infinity and lastText to '': the very same string
    // is sayable again immediately, with no floor to wait out.
    live.say('In zone.');
    expect(status.textContent).toBe('In zone.');
  });

  it('flushes a pending refusal run before clearing, cancelling its timer', () => {
    const c = clock(0);
    const live = new LiveRegions(status, alert, c.now);

    live.announceRefusal('low-confidence', 'face not clear enough');
    live.announceRefusal('low-confidence', 'face not clear enough');
    expect(vi.getTimerCount()).toBe(1);

    live.reset();
    // The pending run was flushed into the region and then cleared by reset,
    // and its timer was cancelled rather than left to fire into a dead region.
    expect(status.textContent).toBe('');
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(ANNOUNCE_FLOOR_MS * 2);
    expect(status.textContent).toBe('');
  });

  it('is a no-op on the pending state when nothing is pending', () => {
    const c = clock(0);
    const live = new LiveRegions(status, alert, c.now);

    live.reset();
    live.reset();
    expect(status.textContent).toBe('');
    expect(alert.textContent).toBe('');
    expect(vi.getTimerCount()).toBe(0);

    // Still fully functional afterwards.
    live.announceRefusal('face-lost', 'face out of frame');
    vi.advanceTimersByTime(ANNOUNCE_FLOOR_MS);
    expect(status.textContent).toBe('1 rep not counted — face out of frame.');
  });
});
