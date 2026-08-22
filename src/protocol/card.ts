/**
 * The protocol card — the prescription gate as a data structure.
 *
 * `Sourced<T>` makes citation a TYPE-SYSTEM obligation rather than a copywriting
 * exercise: a criterion cannot reach the printed page without its citation
 * attached, because the object would not type-check. Where no published
 * parameter can be pinned, the `source` string is the honest sentence, not a
 * gesture at a literature.
 *
 * There is no code path that ORIGINATES a prescription, and that is structural
 * rather than asserted: `enteredBy` has exactly one member, the form ships zero
 * defaults and zero presets, and no sample card appears on screen.
 */

export interface Sourced<T> {
  value: T;
  /** MANDATORY, non-empty. Names a document and section, or states plainly that none could be pinned. */
  source: string;
}

export const NO_SOURCE_PINNED =
  'no published parameter could be pinned; this field is clinician-entry only.';

export type StageLabel = 'seated' | 'standing' | 'complex-background' | 'marching';

export const STAGE_LABELS: readonly StageLabel[] = [
  'seated',
  'standing',
  'complex-background',
  'marching',
];

export interface ProtocolCard {
  /** The CARD schema version. The SESSION schema is separate — see `src/store/session.ts`. */
  schemaVersion: 1;
  exercise: 'vorx1-yaw';
  stage: { label: StageLabel; selfAttested: true };
  /** Hz — [band low, band high]. */
  frequencyBand: Sourced<[number, number]>;
  /** °/s */
  peakVelocityFloor: Sourced<number>;
  /** °/s */
  peakVelocityCeiling: Sourced<number>;
  blockSeconds: Sourced<number>;
  blockCount: Sourced<number>;
  symptomStopRule: {
    /** points on a 0–10 scale */
    baselineRise: Sourced<number>;
    absoluteCeiling: Sourced<number>;
  };
  /** There is no other enum member. */
  enteredBy: 'patient-from-clinician-handout';
}

/** The eight sourced numeric fields the Prescribe form collects. Order matches the form. */
export const NUMERIC_FIELD_IDS = [
  'frequencyBandLow',
  'frequencyBandHigh',
  'peakVelocityFloor',
  'peakVelocityCeiling',
  'blockSeconds',
  'blockCount',
  'stopRuleBaselineRise',
  'stopRuleAbsoluteCeiling',
] as const;

export type NumericFieldId = (typeof NUMERIC_FIELD_IDS)[number];

/**
 * Range checks, labelled as range checks everywhere they appear. These are
 * NOT clinical recommendations — they are the bounds outside which the
 * instrument cannot measure or the arithmetic stops making sense.
 */
export const FIELD_RANGES: Record<NumericFieldId, { min: number; max: number; unit: string; label: string }> = {
  frequencyBandLow: { min: 0.1, max: 5, unit: 'Hz', label: 'Frequency band, low' },
  frequencyBandHigh: { min: 0.1, max: 5, unit: 'Hz', label: 'Frequency band, high' },
  peakVelocityFloor: { min: 1, max: 600, unit: '°/s', label: 'Peak velocity floor' },
  peakVelocityCeiling: { min: 1, max: 600, unit: '°/s', label: 'Peak velocity ceiling' },
  blockSeconds: { min: 10, max: 900, unit: 'sec', label: 'Block length' },
  blockCount: { min: 1, max: 10, unit: '', label: 'Blocks' },
  stopRuleBaselineRise: { min: 1, max: 10, unit: 'points', label: 'Stop rule: rise over baseline' },
  stopRuleAbsoluteCeiling: { min: 1, max: 10, unit: 'points', label: 'Stop rule: absolute ceiling' },
};

export interface CardDraft {
  values: Partial<Record<NumericFieldId, number>>;
  sources: Partial<Record<NumericFieldId, string>>;
  stage: StageLabel | null;
  gateAcknowledged: boolean;
}

export function emptyDraft(): CardDraft {
  // Zero defaults. Zero presets. No sample card. This emptiness is claim C1.
  return { values: {}, sources: {}, stage: null, gateAcknowledged: false };
}

export class CardValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: NumericFieldId,
  ) {
    super(message);
    this.name = 'CardValidationError';
  }
}

export function validateField(id: NumericFieldId, raw: number | undefined): string | null {
  const range = FIELD_RANGES[id];
  if (raw === undefined || Number.isNaN(raw)) return `${range.label} is required.`;
  if (!Number.isFinite(raw)) return `${range.label} must be a number.`;
  if (raw < range.min || raw > range.max) {
    return `${range.label} must be between ${range.min} and ${range.max}${range.unit ? ' ' + range.unit : ''} — this is a range check, not a clinical recommendation.`;
  }
  if (id === 'blockCount' && !Number.isInteger(raw)) return 'Blocks must be a whole number.';
  return null;
}

export function draftErrors(draft: CardDraft): Partial<Record<NumericFieldId | 'stage' | 'gate', string>> {
  const errors: Partial<Record<NumericFieldId | 'stage' | 'gate', string>> = {};
  for (const id of NUMERIC_FIELD_IDS) {
    const e = validateField(id, draft.values[id]);
    if (e) errors[id] = e;
  }
  const lo = draft.values.frequencyBandLow;
  const hi = draft.values.frequencyBandHigh;
  if (lo !== undefined && hi !== undefined && !errors.frequencyBandLow && !errors.frequencyBandHigh && lo >= hi) {
    errors.frequencyBandHigh = 'Frequency band, high must be greater than the low edge.';
  }
  const floor = draft.values.peakVelocityFloor;
  const ceiling = draft.values.peakVelocityCeiling;
  if (
    floor !== undefined &&
    ceiling !== undefined &&
    !errors.peakVelocityFloor &&
    !errors.peakVelocityCeiling &&
    floor >= ceiling
  ) {
    errors.peakVelocityCeiling = 'Peak velocity ceiling must be greater than the floor.';
  }
  if (!draft.stage) errors.stage = 'Choose the stage your clinician wrote down.';
  if (!draft.gateAcknowledged) errors.gate = 'Confirm your clinician prescribed these exercises.';
  return errors;
}

const sourceOf = (draft: CardDraft, id: NumericFieldId): string => {
  const s = draft.sources[id];
  return s && s.trim().length > 0 ? s.trim() : NO_SOURCE_PINNED;
};

/** Builds a card from a completed draft. Throws rather than defaulting — a card that defaults is a card that lies. */
export function cardFromDraft(draft: CardDraft): ProtocolCard {
  const errors = draftErrors(draft);
  const firstKey = Object.keys(errors)[0];
  if (firstKey) {
    throw new CardValidationError(errors[firstKey as keyof typeof errors] as string, firstKey as NumericFieldId);
  }
  const v = draft.values as Record<NumericFieldId, number>;
  return {
    schemaVersion: 1,
    exercise: 'vorx1-yaw',
    stage: { label: draft.stage as StageLabel, selfAttested: true },
    frequencyBand: {
      value: [v.frequencyBandLow, v.frequencyBandHigh],
      source: sourceOf(draft, 'frequencyBandLow'),
    },
    peakVelocityFloor: { value: v.peakVelocityFloor, source: sourceOf(draft, 'peakVelocityFloor') },
    peakVelocityCeiling: { value: v.peakVelocityCeiling, source: sourceOf(draft, 'peakVelocityCeiling') },
    blockSeconds: { value: v.blockSeconds, source: sourceOf(draft, 'blockSeconds') },
    blockCount: { value: v.blockCount, source: sourceOf(draft, 'blockCount') },
    symptomStopRule: {
      baselineRise: { value: v.stopRuleBaselineRise, source: sourceOf(draft, 'stopRuleBaselineRise') },
      absoluteCeiling: { value: v.stopRuleAbsoluteCeiling, source: sourceOf(draft, 'stopRuleAbsoluteCeiling') },
    },
    enteredBy: 'patient-from-clinician-handout',
  };
}

/**
 * Validates a card read from storage or from a fixture. A numeric field with an
 * empty `source` is REJECTED AT LOAD — this is the build gate as a runtime check.
 */
export function parseCard(input: unknown): ProtocolCard {
  const c = input as Partial<ProtocolCard>;
  if (!c || typeof c !== 'object') throw new CardValidationError('card is not an object');
  if (c.schemaVersion !== 1) throw new CardValidationError(`unknown card schemaVersion: ${String(c.schemaVersion)}`);
  if (c.exercise !== 'vorx1-yaw') throw new CardValidationError(`unknown exercise id: ${String(c.exercise)}`);
  if (c.enteredBy !== 'patient-from-clinician-handout') {
    throw new CardValidationError('card was not entered by a patient from a clinician handout');
  }
  if (!c.stage || !STAGE_LABELS.includes(c.stage.label)) {
    throw new CardValidationError(`unknown stage: ${String(c.stage?.label)}`);
  }

  const requireSourced = <T>(field: Sourced<T> | undefined, name: string): Sourced<T> => {
    if (!field || field.value === undefined || field.value === null) {
      throw new CardValidationError(`card is missing required field: ${name}`);
    }
    if (typeof field.source !== 'string' || field.source.trim().length === 0) {
      throw new CardValidationError(`numeric field has no source string: ${name}`);
    }
    return field;
  };

  const band = requireSourced(c.frequencyBand, 'frequencyBand');
  if (!Array.isArray(band.value) || band.value.length !== 2) {
    throw new CardValidationError('frequencyBand must be [low, high]');
  }
  const [lo, hi] = band.value as [number, number];
  if (!(lo > 0) || !(hi > lo)) throw new CardValidationError('frequencyBand is out of range');

  const floor = requireSourced(c.peakVelocityFloor, 'peakVelocityFloor');
  const ceiling = requireSourced(c.peakVelocityCeiling, 'peakVelocityCeiling');
  if (!(ceiling.value > floor.value)) {
    throw new CardValidationError('peakVelocityCeiling must exceed peakVelocityFloor');
  }
  const blockSeconds = requireSourced(c.blockSeconds, 'blockSeconds');
  const blockCount = requireSourced(c.blockCount, 'blockCount');
  if (!c.symptomStopRule) throw new CardValidationError('card is missing required field: symptomStopRule');
  const baselineRise = requireSourced(c.symptomStopRule.baselineRise, 'symptomStopRule.baselineRise');
  const absoluteCeiling = requireSourced(c.symptomStopRule.absoluteCeiling, 'symptomStopRule.absoluteCeiling');

  return {
    schemaVersion: 1,
    exercise: 'vorx1-yaw',
    stage: { label: c.stage.label, selfAttested: true },
    frequencyBand: band as Sourced<[number, number]>,
    peakVelocityFloor: floor,
    peakVelocityCeiling: ceiling,
    blockSeconds,
    blockCount,
    symptomStopRule: { baselineRise, absoluteCeiling },
    enteredBy: 'patient-from-clinician-handout',
  };
}

/**
 * `#rx=` prescription-link codec.
 *
 * SHOULD-tier and DELIBERATELY NOT WIRED to the Prescribe screen. The codec is
 * built and tested; the screen does not call it, because a link that fills the
 * eight fields is a path by which parameters arrive without the patient typing
 * them — and claim C1 (Gimbal has no path to originate a prescription) is
 * structural, not editorial. Wiring it is a decision for the feature freeze,
 * with the U-CARD check as the thing that would have to change.
 */
export function encodeRxLink(card: ProtocolCard): string {
  const json = JSON.stringify(card);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `#rx=${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

export function decodeRxLink(hash: string): ProtocolCard {
  const raw = hash.startsWith('#rx=') ? hash.slice(4) : hash;
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return parseCard(JSON.parse(new TextDecoder().decode(bytes)));
}

/** Total prescribed seconds. Arithmetic, not a clinical claim. */
export function prescribedSeconds(card: ProtocolCard): number {
  return card.blockSeconds.value * card.blockCount.value;
}

/** Band centre in Hz — used by the ring scale and the audio pitch map. */
export function bandCentreHz(card: ProtocolCard): number {
  const [lo, hi] = card.frequencyBand.value;
  return (lo + hi) / 2;
}

/** Velocity band centre in °/s. */
export function velocityCentre(card: ProtocolCard): number {
  return (card.peakVelocityFloor.value + card.peakVelocityCeiling.value) / 2;
}
