import { describe, it, expect } from 'vitest';
import {
  parseCard,
  cardFromDraft,
  draftErrors,
  emptyDraft,
  encodeRxLink,
  decodeRxLink,
  prescribedSeconds,
  NUMERIC_FIELD_IDS,
  NO_SOURCE_PINNED,
  CardValidationError,
} from '../src/protocol/card.ts';
import { testCard } from './helpers.ts';

const card = testCard();

describe('protocol card schema', () => {
  it('REJECTS a numeric field with no source string at load', () => {
    const bad = JSON.parse(JSON.stringify(card));
    bad.peakVelocityFloor.source = '';
    expect(() => parseCard(bad)).toThrow(/no source string/);
    const blank = JSON.parse(JSON.stringify(card));
    blank.symptomStopRule.baselineRise.source = '   ';
    expect(() => parseCard(blank)).toThrow(/no source string/);
  });

  it('rejects out-of-range values', () => {
    const inverted = JSON.parse(JSON.stringify(card));
    inverted.frequencyBand.value = [2.5, 1.5];
    expect(() => parseCard(inverted)).toThrow(/out of range/);
    const backwards = JSON.parse(JSON.stringify(card));
    backwards.peakVelocityCeiling.value = 10;
    expect(() => parseCard(backwards)).toThrow(/must exceed/);
  });

  it('rejects an unknown exercise id', () => {
    const bad = { ...JSON.parse(JSON.stringify(card)), exercise: 'vorx2-pitch' };
    expect(() => parseCard(bad)).toThrow(/unknown exercise id/);
  });

  it('round-trips a #rx= link byte-identically', () => {
    const link = encodeRxLink(card);
    expect(link.startsWith('#rx=')).toBe(true);
    expect(JSON.stringify(decodeRxLink(link))).toBe(JSON.stringify(card));
  });

  it('fails loudly on a missing required field rather than defaulting', () => {
    const missing = JSON.parse(JSON.stringify(card));
    delete missing.blockCount;
    expect(() => parseCard(missing)).toThrow(CardValidationError);
    expect(() => parseCard(missing)).toThrow(/missing required field: blockCount/);
  });

  it('ships zero defaults — an empty draft has eight errors plus stage and gate', () => {
    const draft = emptyDraft();
    expect(Object.keys(draft.values).length).toBe(0);
    const errors = draftErrors(draft);
    for (const id of NUMERIC_FIELD_IDS) expect(errors[id]).toBeTruthy();
    expect(errors.stage).toBeTruthy();
    expect(errors.gate).toBeTruthy();
    expect(() => cardFromDraft(draft)).toThrow(CardValidationError);
  });

  it('falls back to the honest sentence when no source is typed, never to a gesture', () => {
    const draft = emptyDraft();
    draft.gateAcknowledged = true;
    draft.stage = 'seated';
    draft.values = {
      frequencyBandLow: 1.7,
      frequencyBandHigh: 2.3,
      peakVelocityFloor: 150,
      peakVelocityCeiling: 350,
      blockSeconds: 120,
      blockCount: 3,
      stopRuleBaselineRise: 3,
      stopRuleAbsoluteCeiling: 7,
    };
    const built = cardFromDraft(draft);
    expect(built.peakVelocityFloor.source).toBe(NO_SOURCE_PINNED);
    expect(prescribedSeconds(built)).toBe(360);
    // And it survives its own validator.
    expect(() => parseCard(built)).not.toThrow();
  });
});
