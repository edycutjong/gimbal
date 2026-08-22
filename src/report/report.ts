import type { CycleOutcome } from '../dsp/types.ts';
import { ALL_OUTCOMES } from '../dsp/types.ts';
import type { PersistedSession } from '../store/session.ts';
import { binomialTailP, gazeDemonstrated, CHANCE } from '../optotype/trials.ts';
import { pauseSummary } from '../session/dose.ts';
import type { Sourced } from '../protocol/card.ts';

/**
 * The report model.
 *
 * Built as data first, rendered second, so the "every numeric criterion carries
 * a non-empty source" property is a checkable invariant over a model rather than
 * a promise about a template. `binomialP` is DERIVED here on render — never
 * persisted — so a stored file can never disagree with the test the report
 * prints.
 */

export interface Criterion {
  label: string;
  value: string;
  /** The `source` string from the protocol card. Non-empty, always. */
  source: string;
}

export interface BlockRow {
  index: number;
  prescribedSeconds: number;
  deliveredSeconds: number;
  ratio: number;
  cyclesAttempted: number;
  cyclesCredited: number;
  fHatHz: number;
  fHatBinWidthHz: number;
  gaze: { correct: number; total: number; chance: number; binomialP: number; demonstrated: boolean };
  pauseNote: string | null;
  interrupted: boolean;
}

export interface ReportModel {
  startedAt: string;
  cardId: string;
  appVersion: string;
  methodsRev: string;
  prescription: Criterion[];
  blocks: BlockRow[];
  totals: { prescribedSeconds: number; deliveredSeconds: number; ratio: number };
  /** SIX outcome rows: `ok` plus the five refusal reasons. */
  outcomes: { reason: CycleOutcome; count: number; share: number }[];
  symptom: { baseline: number; gates: { afterBlock: number; rating: number; ruling: string }[]; final: number | null };
  conditions: { medianFps: number; cameraLabel: string; resolution: string };
  audioOff: boolean;
  isExample: boolean;
  saturatedCycles: number;
}

const sourced = (label: string, value: string, field: Sourced<unknown>): Criterion => ({
  label,
  value,
  source: field.source,
});

export function buildReport(session: PersistedSession): ReportModel {
  const card = session.card;

  const prescription: Criterion[] = [
    sourced(
      'Frequency band',
      `${card.frequencyBand.value[0]}–${card.frequencyBand.value[1]} Hz`,
      card.frequencyBand,
    ),
    sourced('Peak velocity floor', `${card.peakVelocityFloor.value} °/s`, card.peakVelocityFloor),
    sourced('Peak velocity ceiling', `${card.peakVelocityCeiling.value} °/s`, card.peakVelocityCeiling),
    sourced('Block length', `${card.blockSeconds.value} s`, card.blockSeconds),
    sourced('Blocks', String(card.blockCount.value), card.blockCount),
    sourced(
      'Stop rule: rise over baseline',
      `${card.symptomStopRule.baselineRise.value} points`,
      card.symptomStopRule.baselineRise,
    ),
    sourced(
      'Stop rule: absolute ceiling',
      `${card.symptomStopRule.absoluteCeiling.value} points`,
      card.symptomStopRule.absoluteCeiling,
    ),
  ];

  const blocks: BlockRow[] = session.blocks.map((b) => {
    const p = binomialTailP(b.gaze.correct, b.gaze.total, b.gaze.chance);
    return {
      index: b.index,
      prescribedSeconds: b.prescribedSeconds,
      deliveredSeconds: b.deliveredSeconds,
      ratio: b.prescribedSeconds > 0 ? b.deliveredSeconds / b.prescribedSeconds : 0,
      cyclesAttempted: b.cyclesAttempted,
      cyclesCredited: b.cyclesCredited,
      fHatHz: b.fHatHz,
      fHatBinWidthHz: b.fHatBinWidthHz,
      gaze: {
        ...b.gaze,
        binomialP: p,
        demonstrated: gazeDemonstrated(b.gaze.correct, b.gaze.total),
      },
      pauseNote: pauseSummary(b.interruptions),
      interrupted: b.interruptions.some((i) => i.kind === 'interrupt'),
    };
  });

  const tally: Record<CycleOutcome, number> = {
    ok: 0,
    'too-slow': 0,
    'too-fast': 0,
    'off-cadence': 0,
    'low-confidence': 0,
    'face-lost': 0,
  };
  for (const b of session.blocks) {
    tally.ok += b.cyclesCredited;
    for (const [reason, n] of Object.entries(b.refusals)) tally[reason as CycleOutcome] += n;
  }
  const attempted = Object.values(tally).reduce((a, b) => a + b, 0);

  return {
    startedAt: session.startedAt,
    cardId: session.cardId,
    appVersion: session.appVersion,
    methodsRev: session.methodsRev,
    prescription,
    blocks,
    totals: session.totals,
    outcomes: ALL_OUTCOMES.map((reason) => ({
      reason,
      count: tally[reason],
      share: attempted > 0 ? tally[reason] / attempted : 0,
    })),
    symptom: session.symptom,
    conditions: {
      medianFps: session.device.medianFps,
      cameraLabel: session.device.cameraLabel,
      resolution: session.device.resolution,
    },
    audioOff: session.audioOff === true,
    isExample: session.provenance === 'example',
    saturatedCycles: session.blocks.reduce((a, b) => a + b.saturatedCycles, 0),
  };
}

/** Every numeric criterion on the report must resolve to a non-empty source. */
export function missingCitations(model: ReportModel): string[] {
  return model.prescription.filter((c) => !c.source || c.source.trim().length === 0).map((c) => c.label);
}

/**
 * The five arithmetic identities a clinical judge checks with mental arithmetic
 * in the ten seconds they spend on the page. Every one of them is asserted here
 * rather than hoped for.
 */
export function arithmeticProblems(model: ReportModel): string[] {
  const problems: string[] = [];

  const blockDelivered = model.blocks.reduce((a, b) => a + b.deliveredSeconds, 0);
  if (Math.abs(blockDelivered - model.totals.deliveredSeconds) > 0.05) {
    problems.push('block delivered seconds do not sum to the session total');
  }
  const blockPrescribed = model.blocks.reduce((a, b) => a + b.prescribedSeconds, 0);
  if (Math.abs(blockPrescribed - model.totals.prescribedSeconds) > 0.05) {
    problems.push('block prescribed seconds do not sum to the session total');
  }

  const credited = model.outcomes.find((o) => o.reason === 'ok')?.count ?? 0;
  const refused = model.outcomes.filter((o) => o.reason !== 'ok').reduce((a, o) => a + o.count, 0);
  const attempted = model.blocks.reduce((a, b) => a + b.cyclesAttempted, 0);
  const creditedFromBlocks = model.blocks.reduce((a, b) => a + b.cyclesCredited, 0);
  if (credited !== creditedFromBlocks) problems.push('credited cycles disagree between the histogram and the blocks');
  if (credited + refused !== attempted) problems.push('refusal counts do not sum to attempted minus credited');

  if (model.totals.prescribedSeconds > 0) {
    const ratio = model.totals.deliveredSeconds / model.totals.prescribedSeconds;
    if (Math.abs(ratio - model.totals.ratio) > 0.005) problems.push('the delivered ratio does not match the totals');
  }

  for (const b of model.blocks) {
    if (b.gaze.correct > b.gaze.total) problems.push(`block ${b.index + 1}: gaze correct exceeds gaze total`);
    if (b.gaze.chance !== CHANCE) problems.push(`block ${b.index + 1}: gaze chance is not 25 %`);
  }

  return problems;
}
