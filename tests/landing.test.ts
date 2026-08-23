import { describe, it, expect } from 'vitest';
import {
  TRACE,
  CREDITED_COUNT,
  OUTCOME_STOPS,
  CHAPTERS,
  deliveredAfter,
  ILLUSTRATION_CARD,
  REPLAY_SLOWDOWN,
} from '../src/landing/trace.ts';
import { ALL_OUTCOMES } from '../src/dsp/types.ts';
import { exampleDraft, EXAMPLE_VALUES, EXAMPLE_SOURCE } from '../src/protocol/exampleParameters.ts';
import { draftErrors, cardFromDraft } from '../src/protocol/card.ts';

/**
 * The landing page makes claims about the instrument in pictures. These are the
 * assertions that keep the pictures honest.
 */
describe('the landing page illustration', () => {
  it('takes every verdict from scoreCycle rather than asserting one', () => {
    // Nothing in src/landing/trace.ts writes a `credited` flag. The ten cycles
    // are built from the six drives scripts/bench.mjs asserts end-to-end, and
    // every `reason` below came back from `scoreCycle`.
    const reasons = TRACE.map((c) => c.reason);
    expect(reasons.filter((r) => r === 'too-slow').length).toBe(2);
    expect(reasons.filter((r) => r === 'low-confidence').length).toBe(1);
    expect(reasons.filter((r) => r === 'face-lost').length).toBe(1);
    expect(CREDITED_COUNT).toBe(4);
    expect(TRACE.length).toBe(10);
  });

  it('reaches all six gate outcomes, so the selector can step through the whole gate', () => {
    // `ALL_OUTCOMES` is imported rather than restated — exactly as bench.mjs
    // does it — so a seventh outcome added to the gate fails HERE rather than
    // quietly going unillustrated on the page that explains the gate.
    const reached = new Set(TRACE.map((c) => c.reason));
    expect([...reached].sort()).toEqual([...ALL_OUTCOMES].sort());

    // Every selector stop points at a cycle that ACTUALLY reached its outcome.
    // The index is found, never written, so a button cannot survive a reorder
    // of the trace pointing at the wrong repetition.
    expect(OUTCOME_STOPS.length).toBe(ALL_OUTCOMES.length);
    for (const stop of OUTCOME_STOPS) {
      expect(stop.index, `no cycle reaches ${stop.reason}`).toBeGreaterThanOrEqual(0);
      expect(TRACE[stop.index]?.reason).toBe(stop.reason);
    }
  });

  it('gives the two instrument refusals their own words, not a generic one', () => {
    // These two are the answer to the largest technical risk in the project —
    // head-pose fidelity at 2 Hz on a commodity webcam — and the answer is that
    // the instrument refuses to EMIT rather than smoothing. `too-slow` alone
    // reads as a bug; `too-slow` plus these reads as a policy, which is why
    // collapsing them into one "refused" string would publish the easy half.
    const doubted = TRACE.find((c) => c.reason === 'low-confidence');
    const blind = TRACE.find((c) => c.reason === 'face-lost');
    expect(doubted?.sentence).toBe('Rep not counted — tracking unreliable. Try more light.');
    expect(blind?.sentence).toBe('Rep not counted — your face left the frame.');
    expect(doubted?.sentence).not.toBe(blind?.sentence);
    // And the narration card names them differently too.
    expect(CHAPTERS['low-confidence'].title).not.toBe(CHAPTERS['face-lost'].title);
    for (const outcome of ALL_OUTCOMES) {
      expect(CHAPTERS[outcome].detail.length, `${outcome} has no narration`).toBeGreaterThan(40);
    }
  });

  it('refuses the good-looking number when the instrument does not trust itself', () => {
    const doubted = TRACE.find((c) => c.reason === 'low-confidence');
    expect(doubted).toBeDefined();
    // Squarely inside the prescribed band, and refused anyway. That is the whole
    // point of the second refusal reason: without it, a velocity gate alone
    // reads as a bug rather than as a policy.
    expect((doubted as (typeof TRACE)[number]).peakOmega).toBeGreaterThan(ILLUSTRATION_CARD.peakVelocityFloor.value);
    expect((doubted as (typeof TRACE)[number]).peakOmega).toBeLessThan(ILLUSTRATION_CARD.peakVelocityCeiling.value);
    expect((doubted as (typeof TRACE)[number]).credited).toBe(false);
  });

  it('credits exactly zero seconds for every refused cycle', () => {
    for (const c of TRACE) {
      if (!c.credited) expect(c.doseSeconds).toBe(0);
      else expect(c.doseSeconds).toBeGreaterThan(0);
    }
    // The dose numeral does not move across the first three cycles. That
    // sentence is the hero of the page, so it is a test.
    expect(deliveredAfter(3)).toBe(0);
    expect(deliveredAfter(TRACE.length)).toBeCloseTo(2.0, 9);
  });

  it('prints both numbers in every velocity refusal, never a bare verdict', () => {
    const slow = TRACE.find((c) => c.reason === 'too-slow');
    expect((slow as (typeof TRACE)[number]).sentence).toBe(
      'Rep not counted — too slow (below 150 °/s; measured 101 °/s).',
    );
    // And the ceiling refusal prints both of its numbers too, from the same
    // template — a refusal that named only the rule would be telling a patient
    // they failed without telling them by how much.
    const fast = TRACE.find((c) => c.reason === 'too-fast');
    expect((fast as (typeof TRACE)[number]).sentence).toBe(
      'Rep not counted — too fast (above 350 °/s; measured 377 °/s).',
    );
    // A credited cycle says nothing at all. In-zone is the resting state.
    expect((TRACE.find((c) => c.credited) as (typeof TRACE)[number]).sentence).toBe('');
  });

  it('states its replay speed rather than hiding it', () => {
    // Real cycles at this card's band centre last 500 ms; the page says 1/3.
    expect(REPLAY_SLOWDOWN).toBe(3);
  });
});

describe('the labelled example prescription', () => {
  it('fills all eight fields, and only those eight', () => {
    // The same numbers README.md publishes for evaluation. That the two agree is
    // check U-CARD's third limb, which greps the README table — a file read
    // belongs in the check registry, not in a unit test.
    expect(EXAMPLE_VALUES).toEqual({
      frequencyBandLow: 1.7,
      frequencyBandHigh: 2.3,
      peakVelocityFloor: 150,
      peakVelocityCeiling: 350,
      blockSeconds: 60,
      blockCount: 1,
      stopRuleBaselineRise: 3,
      stopRuleAbsoluteCeiling: 7,
    });
  });

  it('leaves the clinician attestation unticked', () => {
    const draft = exampleDraft();
    expect(draft.gateAcknowledged).toBe(false);
    // Which means the draft does NOT validate — Continue stays disabled until a
    // human ticks the box. Filling in a number is a convenience; ticking an
    // attestation on someone's behalf would be a lie.
    expect(draftErrors(draft).gate).toBeTruthy();
    expect(Object.keys(draftErrors(draft))).toEqual(['gate']);
  });

  it('labels every one of the eight criteria as an example on the printed report', () => {
    const card = cardFromDraft({ ...exampleDraft(), gateAcknowledged: true });
    const sources = [
      card.frequencyBand.source,
      card.peakVelocityFloor.source,
      card.peakVelocityCeiling.source,
      card.blockSeconds.source,
      card.blockCount.source,
      card.symptomStopRule.baselineRise.source,
      card.symptomStopRule.absoluteCeiling.source,
    ];
    for (const s of sources) expect(s).toBe(EXAMPLE_SOURCE);
    expect(EXAMPLE_SOURCE.startsWith('EXAMPLE')).toBe(true);
    // The disclosure travels onto paper with the artifact, not only on screen.
    expect(EXAMPLE_SOURCE).toContain('Not a clinical recommendation');
  });

  it('produces a card that validates once a human ticks the box', () => {
    const draft = { ...exampleDraft(), gateAcknowledged: true };
    expect(draftErrors(draft)).toEqual({});
    const card = cardFromDraft(draft);
    expect(card.enteredBy).toBe('patient-from-clinician-handout');
    expect(card.stage.selfAttested).toBe(true);
    expect(card.frequencyBand.value).toEqual([1.7, 2.3]);
  });
});
