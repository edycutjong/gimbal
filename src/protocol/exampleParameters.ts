import { NUMERIC_FIELD_IDS, type CardDraft, type NumericFieldId, type StageLabel } from './card.ts';

/**
 * The eight numbers published in README.md for evaluation, in one place.
 *
 * WHAT THIS IS, EXACTLY. It is an evaluation convenience with a label attached,
 * reachable only from `/app?demo` and from the landing page's two explicit
 * "example prescription" buttons. It is NOT a preset, NOT a default, and NOT a
 * recommendation, and three structural properties keep that true rather than
 * merely stated:
 *
 *  1. `/app` with no query string still renders eight empty fields. The emptiness
 *     is the default and an e2e assertion holds it there.
 *  2. This module has no path into `src/ui/screens/prescribe.ts`. The screen
 *     receives a draft as a prop and has no idea where it came from — which is
 *     what keeps check U-CARD's first limb (the screen imports no card data)
 *     structurally true.
 *  3. `SOURCE` below is what prints in the report's "Why?" disclosure on every
 *     one of the eight criteria. A report produced from this draft therefore
 *     says on its own face that its parameters were an example, not a
 *     clinician's — the disclosure travels with the artifact, not just with the
 *     screen that produced it.
 *
 * The clinician gate is deliberately NOT pre-ticked. That checkbox is an
 * attestation by a human, and pre-ticking an attestation is the one shortcut
 * that would actually be dishonest.
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
  'Overwrite any of them, or open /app with no query string for the empty card the product actually ships.';

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
