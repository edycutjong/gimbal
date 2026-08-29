import { describe, it, expect } from 'vitest';
import {
  parseCard,
  cardFromDraft,
  draftErrors,
  emptyDraft,
  validateField,
  encodeRxLink,
  decodeRxLink,
  prescribedSeconds,
  bandCentreHz,
  velocityCentre,
  CardValidationError,
  FIELD_RANGES,
  NUMERIC_FIELD_IDS,
  NO_SOURCE_PINNED,
  STAGE_LABELS,
  type CardDraft,
} from '../src/protocol/card.ts';
import {
  EXAMPLE_SOURCE,
  EXAMPLE_STAGE,
  EXAMPLE_VALUES,
  EXAMPLE_DRAFT_BANNER,
  exampleDraft,
} from '../src/protocol/exampleParameters.ts';
import { testCard } from './helpers.ts';

const clone = (): Record<string, any> => JSON.parse(JSON.stringify(testCard()));

/** A draft that passes every check, so each test can spoil exactly one thing. */
function goodDraft(): CardDraft {
  return {
    values: {
      frequencyBandLow: 1.7,
      frequencyBandHigh: 2.3,
      peakVelocityFloor: 150,
      peakVelocityCeiling: 350,
      blockSeconds: 120,
      blockCount: 3,
      stopRuleBaselineRise: 3,
      stopRuleAbsoluteCeiling: 7,
    },
    sources: {},
    stage: 'seated',
    gateAcknowledged: true,
  };
}

describe('validateField — every rejection limb, each labelled a range check', () => {
  it('requires a value and rejects NaN with the same required message', () => {
    expect(validateField('blockSeconds', undefined)).toBe('Block length is required.');
    expect(validateField('blockSeconds', Number.NaN)).toBe('Block length is required.');
  });

  it('rejects a non-finite number distinctly from a missing one', () => {
    expect(validateField('blockSeconds', Number.POSITIVE_INFINITY)).toBe('Block length must be a number.');
    expect(validateField('blockSeconds', Number.NEGATIVE_INFINITY)).toBe('Block length must be a number.');
  });

  it('names the unit when the field has one, and omits it when it does not', () => {
    const withUnit = validateField('frequencyBandLow', 0.05);
    expect(withUnit).toBe(
      'Frequency band, low must be between 0.1 and 5 Hz — this is a range check, not a clinical recommendation.',
    );
    // blockCount carries an empty unit string, so no stray trailing space appears.
    const noUnit = validateField('blockCount', 20);
    expect(noUnit).toBe(
      'Blocks must be between 1 and 10 — this is a range check, not a clinical recommendation.',
    );
    expect(noUnit).not.toMatch(/10 {2,}—/);
  });

  it('rejects below the floor and above the ceiling of the range', () => {
    expect(validateField('peakVelocityFloor', 0.5)).toMatch(/must be between 1 and 600/);
    expect(validateField('peakVelocityFloor', 601)).toMatch(/must be between 1 and 600/);
    expect(validateField('peakVelocityFloor', FIELD_RANGES.peakVelocityFloor.min)).toBeNull();
    expect(validateField('peakVelocityFloor', FIELD_RANGES.peakVelocityFloor.max)).toBeNull();
  });

  it('requires blocks to be a whole number, but does not impose that on other fields', () => {
    expect(validateField('blockCount', 2.5)).toBe('Blocks must be a whole number.');
    expect(validateField('blockCount', 2)).toBeNull();
    expect(validateField('blockSeconds', 90.5)).toBeNull();
  });
});

describe('draftErrors — cross-field checks fire only once the fields themselves are sound', () => {
  it('accepts a complete, ordered draft with no errors at all', () => {
    expect(Object.keys(draftErrors(goodDraft()))).toEqual([]);
  });

  it('skips the band comparison while either edge is still missing', () => {
    const onlyLow = goodDraft();
    delete onlyLow.values.frequencyBandHigh;
    expect(draftErrors(onlyLow).frequencyBandHigh).toBe('Frequency band, high is required.');

    const onlyHigh = goodDraft();
    delete onlyHigh.values.frequencyBandLow;
    expect(draftErrors(onlyHigh).frequencyBandHigh).toBeUndefined();
  });

  it('does not overwrite a range error on either band edge with the ordering message', () => {
    const badLow = goodDraft();
    badLow.values.frequencyBandLow = 9;
    const lowErrors = draftErrors(badLow);
    expect(lowErrors.frequencyBandLow).toMatch(/range check/);
    expect(lowErrors.frequencyBandHigh).toBeUndefined();

    const badHigh = goodDraft();
    badHigh.values.frequencyBandHigh = 9;
    expect(draftErrors(badHigh).frequencyBandHigh).toMatch(/range check/);
  });

  it('rejects a band whose edges are equal or inverted', () => {
    const equal = goodDraft();
    equal.values.frequencyBandHigh = equal.values.frequencyBandLow;
    expect(draftErrors(equal).frequencyBandHigh).toBe(
      'Frequency band, high must be greater than the low edge.',
    );

    const inverted = goodDraft();
    inverted.values.frequencyBandLow = 3;
    inverted.values.frequencyBandHigh = 2;
    expect(draftErrors(inverted).frequencyBandHigh).toMatch(/greater than the low edge/);
  });

  it('skips the velocity comparison while either bound is still missing', () => {
    const onlyFloor = goodDraft();
    delete onlyFloor.values.peakVelocityCeiling;
    expect(draftErrors(onlyFloor).peakVelocityCeiling).toBe('Peak velocity ceiling is required.');

    const onlyCeiling = goodDraft();
    delete onlyCeiling.values.peakVelocityFloor;
    expect(draftErrors(onlyCeiling).peakVelocityCeiling).toBeUndefined();
  });

  it('does not overwrite a range error on either velocity bound with the ordering message', () => {
    const badFloor = goodDraft();
    badFloor.values.peakVelocityFloor = 900;
    const floorErrors = draftErrors(badFloor);
    expect(floorErrors.peakVelocityFloor).toMatch(/range check/);
    expect(floorErrors.peakVelocityCeiling).toBeUndefined();

    const badCeiling = goodDraft();
    badCeiling.values.peakVelocityCeiling = 900;
    expect(draftErrors(badCeiling).peakVelocityCeiling).toMatch(/range check/);
  });

  it('rejects a velocity window that is equal or inverted', () => {
    const equal = goodDraft();
    equal.values.peakVelocityCeiling = equal.values.peakVelocityFloor;
    expect(draftErrors(equal).peakVelocityCeiling).toBe(
      'Peak velocity ceiling must be greater than the floor.',
    );

    const inverted = goodDraft();
    inverted.values.peakVelocityFloor = 300;
    inverted.values.peakVelocityCeiling = 200;
    expect(draftErrors(inverted).peakVelocityCeiling).toMatch(/greater than the floor/);
  });

  it('demands a stage and an unticked gate independently of the numbers', () => {
    const noStage = goodDraft();
    noStage.stage = null;
    expect(draftErrors(noStage).stage).toBe('Choose the stage your clinician wrote down.');
    expect(draftErrors(noStage).gate).toBeUndefined();

    const noGate = goodDraft();
    noGate.gateAcknowledged = false;
    expect(draftErrors(noGate).gate).toBe('Confirm your clinician prescribed these exercises.');
    expect(draftErrors(noGate).stage).toBeUndefined();
  });
});

describe('cardFromDraft — sources are carried, trimmed, or replaced by the honest sentence', () => {
  it('carries a typed source through, trimmed', () => {
    const draft = goodDraft();
    draft.sources = { peakVelocityFloor: '  Handout, section 2  ' };
    const built = cardFromDraft(draft);
    expect(built.peakVelocityFloor.source).toBe('Handout, section 2');
    expect(built.blockCount.source).toBe(NO_SOURCE_PINNED);
  });

  it('treats a whitespace-only source as no source at all', () => {
    const draft = goodDraft();
    draft.sources = { blockSeconds: '   \t  ' };
    expect(cardFromDraft(draft).blockSeconds.source).toBe(NO_SOURCE_PINNED);
  });

  it('reports the offending field on the thrown error', () => {
    const draft = goodDraft();
    draft.values.blockCount = 99;
    try {
      cardFromDraft(draft);
      expect.unreachable('cardFromDraft should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CardValidationError);
      expect((err as CardValidationError).field).toBe('blockCount');
      expect((err as CardValidationError).name).toBe('CardValidationError');
    }
  });

  it('builds every field of a card whose validator then accepts it', () => {
    const draft = goodDraft();
    draft.stage = 'marching';
    const built = cardFromDraft(draft);
    expect(built).toEqual({
      schemaVersion: 1,
      exercise: 'vorx1-yaw',
      stage: { label: 'marching', selfAttested: true },
      frequencyBand: { value: [1.7, 2.3], source: NO_SOURCE_PINNED },
      peakVelocityFloor: { value: 150, source: NO_SOURCE_PINNED },
      peakVelocityCeiling: { value: 350, source: NO_SOURCE_PINNED },
      blockSeconds: { value: 120, source: NO_SOURCE_PINNED },
      blockCount: { value: 3, source: NO_SOURCE_PINNED },
      symptomStopRule: {
        baselineRise: { value: 3, source: NO_SOURCE_PINNED },
        absoluteCeiling: { value: 7, source: NO_SOURCE_PINNED },
      },
      enteredBy: 'patient-from-clinician-handout',
    });
    expect(() => parseCard(built)).not.toThrow();
  });

  it('carries a CardValidationError with no field when only the gate is unticked', () => {
    const draft = goodDraft();
    draft.gateAcknowledged = false;
    try {
      cardFromDraft(draft);
      expect.unreachable('cardFromDraft should have thrown');
    } catch (err) {
      expect((err as CardValidationError).message).toMatch(/Confirm your clinician/);
      expect((err as CardValidationError).field).toBe('gate');
    }
  });
});

describe('parseCard — every load-time rejection', () => {
  it('rejects a null and a non-object input', () => {
    expect(() => parseCard(null)).toThrow(/card is not an object/);
    expect(() => parseCard(42)).toThrow(/card is not an object/);
    expect(() => parseCard(undefined)).toThrow(/card is not an object/);
  });

  it('rejects an unknown schema version by name', () => {
    const bad = clone();
    bad.schemaVersion = 2;
    expect(() => parseCard(bad)).toThrow('unknown card schemaVersion: 2');
  });

  it('rejects a card not entered by a patient from a clinician handout', () => {
    const bad = clone();
    bad.enteredBy = 'gimbal';
    expect(() => parseCard(bad)).toThrow(/was not entered by a patient/);
  });

  it('rejects a missing stage and an unknown stage label', () => {
    const missing = clone();
    delete missing.stage;
    expect(() => parseCard(missing)).toThrow('unknown stage: undefined');

    const unknown = clone();
    unknown.stage = { label: 'cartwheeling', selfAttested: true };
    expect(() => parseCard(unknown)).toThrow('unknown stage: cartwheeling');
  });

  it('accepts every published stage label', () => {
    for (const label of STAGE_LABELS) {
      const c = clone();
      c.stage = { label, selfAttested: true };
      expect(parseCard(c).stage).toEqual({ label, selfAttested: true });
    }
  });

  it('rejects a sourced field that is absent, undefined-valued, or null-valued', () => {
    const absent = clone();
    delete absent.peakVelocityFloor;
    expect(() => parseCard(absent)).toThrow('card is missing required field: peakVelocityFloor');

    const undef = clone();
    undef.blockSeconds = { source: 'a handout' };
    expect(() => parseCard(undef)).toThrow('card is missing required field: blockSeconds');

    const nulled = clone();
    nulled.blockCount = { value: null, source: 'a handout' };
    expect(() => parseCard(nulled)).toThrow('card is missing required field: blockCount');
  });

  it('rejects a non-string source as firmly as an empty one', () => {
    const notAString = clone();
    notAString.symptomStopRule.absoluteCeiling = { value: 7, source: 7 };
    expect(() => parseCard(notAString)).toThrow(
      'numeric field has no source string: symptomStopRule.absoluteCeiling',
    );
  });

  it('rejects a frequency band that is not a two-element array', () => {
    const notArray = clone();
    notArray.frequencyBand.value = 2.0;
    expect(() => parseCard(notArray)).toThrow('frequencyBand must be [low, high]');

    const threeWide = clone();
    threeWide.frequencyBand.value = [1, 2, 3];
    expect(() => parseCard(threeWide)).toThrow('frequencyBand must be [low, high]');
  });

  it('rejects a band with a non-positive low edge as well as an inverted one', () => {
    const zeroLow = clone();
    zeroLow.frequencyBand.value = [0, 2.3];
    expect(() => parseCard(zeroLow)).toThrow('frequencyBand is out of range');

    const equalEdges = clone();
    equalEdges.frequencyBand.value = [2, 2];
    expect(() => parseCard(equalEdges)).toThrow('frequencyBand is out of range');
  });

  it('rejects a card with no stop rule at all', () => {
    const noRule = clone();
    delete noRule.symptomStopRule;
    expect(() => parseCard(noRule)).toThrow('card is missing required field: symptomStopRule');
  });

  it('rejects each stop-rule limb by its qualified name', () => {
    const noRise = clone();
    delete noRise.symptomStopRule.baselineRise;
    expect(() => parseCard(noRise)).toThrow(
      'card is missing required field: symptomStopRule.baselineRise',
    );

    const noCeiling = clone();
    delete noCeiling.symptomStopRule.absoluteCeiling;
    expect(() => parseCard(noCeiling)).toThrow(
      'card is missing required field: symptomStopRule.absoluteCeiling',
    );
  });

  it('normalises selfAttested to true and re-stamps the two closed enums', () => {
    const loose = clone();
    loose.stage.selfAttested = false;
    loose.extraneous = 'ignored';
    const parsed = parseCard(loose);
    expect(parsed.stage.selfAttested).toBe(true);
    expect(parsed.exercise).toBe('vorx1-yaw');
    expect(parsed.enteredBy).toBe('patient-from-clinician-handout');
    expect(parsed).not.toHaveProperty('extraneous');
  });
});

describe('#rx= codec', () => {
  it('decodes a payload with or without the #rx= prefix', () => {
    const card = testCard();
    const link = encodeRxLink(card);
    expect(decodeRxLink(link)).toEqual(card);
    expect(decodeRxLink(link.slice(4))).toEqual(card);
  });

  it('emits url-safe base64 with no padding', () => {
    // A source string engineered to force + and / into standard base64.
    const card = testCard();
    card.blockSeconds.source = 'ÿÿÿ????>>>~~~ handout §4';
    const link = encodeRxLink(card);
    expect(link.slice(4)).not.toMatch(/[+/=]/);
    expect(decodeRxLink(link).blockSeconds.source).toBe('ÿÿÿ????>>>~~~ handout §4');
  });

  it('runs a decoded card through the same load-time gate', () => {
    const bad = clone();
    bad.peakVelocityFloor.source = '';
    const link = encodeRxLink(bad as never);
    expect(() => decodeRxLink(link)).toThrow(/no source string/);
  });
});

describe('derived arithmetic — not clinical claims', () => {
  it('multiplies block length by block count', () => {
    expect(prescribedSeconds(testCard())).toBe(360);
    expect(prescribedSeconds(testCard({ blockSeconds: 60, blockCount: 1 }))).toBe(60);
  });

  it('takes the midpoint of the frequency band', () => {
    expect(bandCentreHz(testCard())).toBeCloseTo(2.0, 10);
    expect(bandCentreHz(testCard({ bandLo: 1, bandHi: 3 }))).toBe(2);
  });

  it('takes the midpoint of the velocity window', () => {
    expect(velocityCentre(testCard())).toBe(250);
    expect(velocityCentre(testCard({ floor: 100, ceiling: 500 }))).toBe(300);
  });
});

describe('the example parameters — an example, and labelled as one everywhere', () => {
  it('fills all eight numeric fields and nothing else', () => {
    const draft = exampleDraft();
    expect(Object.keys(draft.values).sort()).toEqual([...NUMERIC_FIELD_IDS].sort());
    for (const id of NUMERIC_FIELD_IDS) {
      expect(draft.values[id]).toBe(EXAMPLE_VALUES[id]);
      expect(draft.sources[id]).toBe(EXAMPLE_SOURCE);
    }
    expect(draft.stage).toBe(EXAMPLE_STAGE);
  });

  it('leaves the clinician gate unticked — the one thing Gimbal will not do for you', () => {
    const draft = exampleDraft();
    expect(draft.gateAcknowledged).toBe(false);
    const errors = draftErrors(draft);
    expect(Object.keys(errors)).toEqual(['gate']);
    expect(() => cardFromDraft(draft)).toThrow(/Confirm your clinician/);
  });

  it('becomes a valid card the moment a human ticks the gate, and carries the label onto it', () => {
    const draft = exampleDraft();
    draft.gateAcknowledged = true;
    const card = cardFromDraft(draft);
    expect(() => parseCard(card)).not.toThrow();
    expect(card.frequencyBand.source).toBe(EXAMPLE_SOURCE);
    expect(card.symptomStopRule.absoluteCeiling.source).toBe(EXAMPLE_SOURCE);
    expect(card.stage.label).toBe(EXAMPLE_STAGE);
  });

  it('returns a fresh draft each call, so editing one cannot leak into the next', () => {
    const a = exampleDraft();
    const b = exampleDraft();
    expect(a).not.toBe(b);
    expect(a.values).not.toBe(b.values);
    a.values.blockCount = 9;
    a.sources.blockCount = 'mutated';
    expect(b.values.blockCount).toBe(EXAMPLE_VALUES.blockCount);
    expect(b.sources.blockCount).toBe(EXAMPLE_SOURCE);
    expect(EXAMPLE_VALUES.blockCount).not.toBe(9);
  });

  it('says on its own face that it is an example, not a recommendation', () => {
    expect(EXAMPLE_SOURCE).toMatch(/^EXAMPLE — /);
    expect(EXAMPLE_SOURCE).toMatch(/[Nn]ot a clinical recommendation/);
    expect(EXAMPLE_DRAFT_BANNER).toMatch(/not a recommendation/);
    expect(EXAMPLE_DRAFT_BANNER).toMatch(/no clinician wrote them for you/);
  });

  it('publishes values that each survive their own field range check', () => {
    for (const id of NUMERIC_FIELD_IDS) {
      expect(validateField(id, EXAMPLE_VALUES[id])).toBeNull();
    }
  });

  it('is the only draft factory that fills anything — emptyDraft still fills nothing', () => {
    const empty = emptyDraft();
    expect(empty.values).toEqual({});
    expect(empty.sources).toEqual({});
    expect(empty.stage).toBeNull();
    expect(empty.gateAcknowledged).toBe(false);
  });
});
