import { NUMERIC_FIELD_IDS, type CardDraft, type NumericFieldId, type StageLabel } from './card.ts';

/**
 * The eight numbers published in README.md for evaluation, in one place.
 *
 * WHAT THIS IS, EXACTLY. It is an evaluation convenience with a label attached.
 * `/app` and `/app?demo` arrive filled with it; `/app?blank` is the empty card.
 * It is NOT a preset, NOT a recommendation, and — even though it is now what a
 * first-time visitor sees — NOT an origination of a prescription, because four
 * structural properties keep that true rather than merely stated:
 *
 *  1. `/app?blank` renders eight empty fields, and that route is reachable in
 *     one visible click from the pre-filled screen as well as from the landing
 *     page. The origination path did not go away when the default moved; an
 *     e2e assertion holds it there.
 *  2. These are the ONLY eight numbers in the application. There is no second
 *     source, no preset list, no "typical values" control — so a filled card can
 *     only ever have come through this one labelled route.
 *  3. This module has no path into `src/ui/screens/prescribe.ts`. The screen
 *     receives a draft as a prop and has no idea where it came from — which is
 *     what keeps check U-CARD's first limb (the screen imports no card data)
 *     structurally true.
 *  4. `SOURCE` below is what prints in the report's "Why?" disclosure on every
 *     one of the eight criteria. A report produced from this draft therefore
 *     says on its own face that its parameters were an example, not a
 *     clinician's — the disclosure travels with the artifact, not just with the
 *     screen that produced it.
 *
 * The clinician gate is deliberately NOT pre-ticked, and THAT is the limb that
 * carries claim C1 now that a filled form is the default. That checkbox is an
 * attestation by a human; filling in a number for someone is a convenience, and
 * ticking their attestation for them would be a lie. Nothing downstream — no
 * card, no session, no report — exists until a human ticks it.
 */

export const EXAMPLE_SOURCE =
  'EXAMPLE — published in this project README for evaluation. Not a clinical recommendation, ' +
  'and not a parameter any clinician wrote for the person who ran this session.';

export const EXAMPLE_STAGE: StageLabel = 'seated';

/** Identical to the table in README.md, field for field. */
export const EXAMPLE_VALUES: Record<NumericFieldId, number> = {
  frequencyBandLow: 1.7,
  frequencyBandHigh: 2.3,
  peakVelocityFloor: 150,
  peakVelocityCeiling: 350,
  // 60 seconds and one block make an evaluation run a minute rather than six.
  // Both are card fields, so choosing them is exactly the act the product is
  // built around.
  blockSeconds: 60,
  blockCount: 1,
  stopRuleBaselineRise: 3,
  stopRuleAbsoluteCeiling: 7,
};

/** The banner the Prescribe screen shows whenever these values are on screen. */
export const EXAMPLE_DRAFT_BANNER =
  'These eight values are an example, filled in for you so you can reach the measurement without a ' +
  'prescription in front of you. They are not a recommendation and no clinician wrote them for you. ' +
  'Overwrite any of them with your own — and Gimbal still cannot tick the box below for you.';

/** A complete draft, gate deliberately unticked. */
export function exampleDraft(): CardDraft {
  const values: Partial<Record<NumericFieldId, number>> = {};
  const sources: Partial<Record<NumericFieldId, string>> = {};
  for (const id of NUMERIC_FIELD_IDS) {
    values[id] = EXAMPLE_VALUES[id];
    sources[id] = EXAMPLE_SOURCE;
  }
  return { values, sources, stage: EXAMPLE_STAGE, gateAcknowledged: false };
}
